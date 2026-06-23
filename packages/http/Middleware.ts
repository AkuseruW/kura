import { BaseException } from "../core/BaseException";
import { parseRequestBody, requestMayHaveBody } from "./Body";
import { applyMiddlewares } from "./MiddlewareStack";
import type { Context } from "./Server";

export type Middleware = (
	ctx: Context,
	next: () => Promise<Response>,
) => Response | Promise<Response>;

export type MiddlewareHandler = (ctx: Context) => Response | Promise<Response>;

export class MiddlewarePipeline {
	private middlewares: Middleware[] = [];

	use(middleware: Middleware): this {
		this.middlewares.push(middleware);
		return this;
	}

	async run(ctx: Context, handler: () => Promise<Response>): Promise<Response> {
		let index = 0;
		const next = async (): Promise<Response> => {
			const middleware = this.middlewares[index++];
			if (middleware) {
				return middleware(ctx, next);
			}
			return handler();
		};
		return next();
	}

	toHandler(handler: MiddlewareHandler): MiddlewareHandler {
		return applyMiddlewares(handler, this.middlewares);
	}
}

export type BodyLimitOptions = {
	readonly maxBytes: number;
};

export type RequestTimeoutOptions = {
	readonly ms: number;
};

export class RequestBodyLimitException extends BaseException {
	constructor(readonly maxBytes: number) {
		super(
			`Request body exceeds the configured limit of ${maxBytes} bytes`,
			"E_REQUEST_BODY_TOO_LARGE",
			413,
		);
	}
}

export class RequestTimeoutException extends BaseException {
	constructor(readonly ms: number) {
		super(
			`Request exceeded the configured timeout of ${ms}ms`,
			"E_REQUEST_TIMEOUT",
			408,
		);
	}
}

export const BodyLimit = (options: BodyLimitOptions): Middleware => {
	const maxBytes = positiveInteger("maxBytes", options.maxBytes);

	return async (ctx, next) => {
		const contentLength = parseContentLength(
			ctx.request.headers.get("content-length"),
		);

		if (contentLength !== undefined && contentLength > maxBytes) {
			throw new RequestBodyLimitException(maxBytes);
		}

		if (ctx.request.body) {
			ctx.request = withLimitedBody(ctx.request, maxBytes);
		}

		return next();
	};
};

export const RequestTimeout = (options: RequestTimeoutOptions): Middleware => {
	const ms = positiveInteger("ms", options.ms);

	return async (ctx, next) => {
		const controller = new AbortController();
		ctx.timeoutSignal = controller.signal;

		let timeout: ReturnType<typeof setTimeout> | undefined;
		const response = Promise.resolve().then(next);
		const timeoutResponse = new Promise<Response>((_resolve, reject) => {
			timeout = setTimeout(() => {
				controller.abort(new RequestTimeoutException(ms));
				reject(new RequestTimeoutException(ms));
			}, ms);
		});

		try {
			return await Promise.race([response, timeoutResponse]);
		} finally {
			if (timeout) {
				clearTimeout(timeout);
			}
		}
	};
};

export const BodyParser: Middleware = async (ctx, next) => {
	if (requestMayHaveBody(ctx.request)) {
		await parseRequestBody(ctx, { parseText: false });
	}

	return next();
};

export type CorsOrigin =
	| string
	| readonly string[]
	| ((origin: string) => boolean);

export type CorsOptions = {
	readonly origin?: CorsOrigin;
	readonly methods?: readonly string[];
	readonly allowedHeaders?: readonly string[];
	readonly headers?: readonly string[];
	readonly exposedHeaders?: readonly string[];
	readonly credentials?: boolean;
	readonly maxAge?: number;
	readonly allowWildcardWithCredentials?: boolean;
};

export const Cors = (options: CorsOptions = {}): Middleware => {
	const origin = options.origin ?? "*";
	if (
		options.credentials === true &&
		!options.allowWildcardWithCredentials &&
		originAllowsWildcard(origin)
	) {
		throw new Error(
			"CORS credentials cannot be used with wildcard origins. Configure explicit origins or set allowWildcardWithCredentials.",
		);
	}

	const methods = options.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE"];
	const headers = options.allowedHeaders ??
		options.headers ?? ["Content-Type", "Authorization"];
	const exposedHeaders = options.exposedHeaders ?? [];
	const methodsHeader = methods.join(", ");
	const headersHeader = headers.join(", ");
	const exposedHeadersHeader = exposedHeaders.join(", ");

	return async (ctx, next) => {
		const requestOrigin = ctx.request.headers.get("origin");
		const allowedOrigin = resolveCorsOrigin(origin, requestOrigin);

		if (isCorsPreflight(ctx.request)) {
			if (!allowedOrigin) {
				return new Response(null, { status: 403 });
			}

			const response = new Response(null, { status: 204 });
			applyCorsHeaders(response.headers, {
				allowedOrigin,
				credentials: options.credentials,
				exposedHeadersHeader,
				headersHeader,
				maxAge: options.maxAge,
				methodsHeader,
			});
			return response;
		}

		const response = await next();
		if (allowedOrigin) {
			applyCorsHeaders(response.headers, {
				allowedOrigin,
				credentials: options.credentials,
				exposedHeadersHeader,
				headersHeader,
				maxAge: options.maxAge,
				methodsHeader,
			});
		}
		return response;
	};
};

function isCorsPreflight(request: Request): boolean {
	return (
		request.method === "OPTIONS" &&
		request.headers.has("origin") &&
		request.headers.has("access-control-request-method")
	);
}

function resolveCorsOrigin(
	origin: CorsOrigin,
	requestOrigin: string | null,
): string | null {
	if (origin === "*") {
		return "*";
	}

	if (typeof origin === "string") {
		return requestOrigin && requestOrigin !== origin ? null : origin;
	}

	if (!requestOrigin) {
		return null;
	}

	if (typeof origin === "function") {
		return origin(requestOrigin) ? requestOrigin : null;
	}

	return origin.includes(requestOrigin) ? requestOrigin : null;
}

function originAllowsWildcard(origin: CorsOrigin): boolean {
	if (origin === "*") {
		return true;
	}

	return Array.isArray(origin) && origin.includes("*");
}

function applyCorsHeaders(
	headers: Headers,
	options: {
		readonly allowedOrigin: string;
		readonly credentials?: boolean;
		readonly exposedHeadersHeader: string;
		readonly headersHeader: string;
		readonly maxAge?: number;
		readonly methodsHeader: string;
	},
): void {
	headers.set("Access-Control-Allow-Origin", options.allowedOrigin);
	headers.set("Access-Control-Allow-Methods", options.methodsHeader);
	headers.set("Access-Control-Allow-Headers", options.headersHeader);

	if (options.credentials) {
		headers.set("Access-Control-Allow-Credentials", "true");
	}

	if (options.exposedHeadersHeader) {
		headers.set("Access-Control-Expose-Headers", options.exposedHeadersHeader);
	}

	if (options.maxAge !== undefined) {
		headers.set("Access-Control-Max-Age", String(options.maxAge));
	}

	if (options.allowedOrigin !== "*") {
		appendVary(headers, "Origin");
	}
}

function appendVary(headers: Headers, value: string): void {
	const current = headers.get("Vary");
	if (!current) {
		headers.set("Vary", value);
		return;
	}

	const values = current.split(",").map((item) => item.trim().toLowerCase());
	if (!values.includes(value.toLowerCase())) {
		headers.set("Vary", `${current}, ${value}`);
	}
}

export const RequestId: Middleware = async (ctx, next) => {
	const id = crypto.randomUUID();
	ctx.requestId = id;
	const response = await next();
	response.headers.set("X-Request-Id", id);
	return response;
};

function withLimitedBody(request: Request, maxBytes: number): Request {
	if (!request.body) {
		return request;
	}

	return new Request(request, {
		body: limitBodyStream(request.body, maxBytes),
	});
}

function limitBodyStream(
	body: ReadableStream<Uint8Array>,
	maxBytes: number,
): ReadableStream<Uint8Array> {
	let bytesRead = 0;

	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				bytesRead += chunk.byteLength;

				if (bytesRead > maxBytes) {
					controller.error(new RequestBodyLimitException(maxBytes));
					return;
				}

				controller.enqueue(chunk);
			},
		}),
	);
}

function parseContentLength(value: string | null): number | undefined {
	if (value === null) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function positiveInteger(name: string, value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${name} must be a positive integer`);
	}

	return value;
}

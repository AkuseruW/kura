import { formDataToObject, parseRequestFormData } from "./Body";
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
		const middlewares = [...this.middlewares];
		if (middlewares.length === 0) {
			return handler;
		}

		return async (ctx) => {
			let index = 0;
			const next = async (): Promise<Response> => {
				const middleware = middlewares[index++];
				if (middleware) {
					return middleware(ctx, next);
				}
				return handler(ctx);
			};
			return next();
		};
	}
}

export const BodyParser: Middleware = async (ctx, next) => {
	if (ctx.request.method === "GET" || ctx.request.method === "HEAD") {
		return next();
	}

	const contentType = ctx.request.headers.get("content-type");
	if (contentType?.includes("application/json")) {
		ctx.body = await ctx.request.json();
	} else if (contentType?.includes("multipart/form-data")) {
		const formData = await parseRequestFormData(ctx.request, contentType);
		ctx.formData = formData;
		ctx.body = formDataToObject(formData);
	} else if (contentType?.includes("application/x-www-form-urlencoded")) {
		const formData = await parseRequestFormData(ctx.request, contentType);
		ctx.formData = formData;
		ctx.body = formDataToObject(formData);
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
	readonly headers?: readonly string[];
	readonly credentials?: boolean;
	readonly maxAge?: number;
};

export const Cors = (options: CorsOptions = {}): Middleware => {
	const origin = options.origin ?? "*";
	const methods = options.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE"];
	const headers = options.headers ?? ["Content-Type", "Authorization"];
	const methodsHeader = methods.join(", ");
	const headersHeader = headers.join(", ");

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

function applyCorsHeaders(
	headers: Headers,
	options: {
		readonly allowedOrigin: string;
		readonly credentials?: boolean;
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

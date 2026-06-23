import { timingSafeEqual } from "node:crypto";
import { BaseException } from "../core/BaseException";
import { parseRequestBody, requestMayHaveBody } from "./Body";
import { readCookie, serializeCookie } from "./Cookie";
import { ForbiddenException, TooManyRequestsException } from "./ErrorHandler";
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

export type SecurityHeadersHstsOptions = {
	readonly enabled?: boolean;
	readonly includeSubDomains?: boolean;
	readonly maxAge?: number;
	readonly preload?: boolean;
};

export type SecurityHeadersContentSecurityPolicy =
	| string
	| {
			readonly directives: Readonly<Record<string, readonly string[]>>;
	  };

export type SecurityHeadersOptions = {
	readonly contentSecurityPolicy?: false | SecurityHeadersContentSecurityPolicy;
	readonly contentTypeOptions?: false | "nosniff";
	readonly crossOriginOpenerPolicy?: false | string;
	readonly enabled?: boolean;
	readonly frameOptions?: false | "deny" | "sameorigin";
	readonly headers?: Readonly<Record<string, string | false | undefined>>;
	readonly hsts?: false | SecurityHeadersHstsOptions;
	readonly referrerPolicy?: false | string;
};

export type RateLimitKeyResolver = (ctx: Context) => string | Promise<string>;

export type RateLimitSkip = (ctx: Context) => boolean | Promise<boolean>;

export type RateLimitState = {
	readonly limit: number;
	readonly remaining: number;
	readonly resetAt: Date;
	readonly retryAfter: number;
	readonly exceeded: boolean;
};

export type RateLimitStoreOptions = {
	readonly limit: number;
	readonly now: Date;
	readonly windowMs: number;
};

export interface RateLimitStore {
	hit(key: string, options: RateLimitStoreOptions): RateLimitState;
	reset?(key: string): void;
}

export type RateLimitOptions = {
	readonly enabled?: boolean;
	readonly headers?: boolean;
	readonly key?: RateLimitKeyResolver;
	readonly limit: number;
	readonly skip?: RateLimitSkip;
	readonly store?: RateLimitStore;
	readonly windowMs: number;
};

export type CsrfExceptRoute =
	| string
	| RegExp
	| ((ctx: Context) => boolean | Promise<boolean>);

export type CsrfProtectionOptions = {
	readonly cookieName?: string;
	readonly except?: readonly CsrfExceptRoute[];
	readonly fieldNames?: readonly string[];
	readonly headerName?: string;
	readonly methods?: readonly string[];
	readonly path?: string;
	readonly sameSite?: "lax" | "strict" | "none";
	readonly secure?: boolean;
	readonly tokenLength?: number;
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

export class MemoryRateLimitStore implements RateLimitStore {
	private readonly windows = new Map<
		string,
		{
			count: number;
			resetAt: number;
		}
	>();

	hit(key: string, options: RateLimitStoreOptions): RateLimitState {
		const now = options.now.getTime();
		const existing = this.windows.get(key);
		const window =
			existing && existing.resetAt > now
				? existing
				: {
						count: 0,
						resetAt: now + options.windowMs,
					};

		window.count += 1;
		this.windows.set(key, window);

		const remaining = Math.max(0, options.limit - window.count);
		const retryAfter = Math.max(0, Math.ceil((window.resetAt - now) / 1000));

		return {
			exceeded: window.count > options.limit,
			limit: options.limit,
			remaining,
			resetAt: new Date(window.resetAt),
			retryAfter,
		};
	}

	reset(key: string): void {
		this.windows.delete(key);
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

export const SecurityHeaders = (
	options: SecurityHeadersOptions = {},
): Middleware => {
	return async (_ctx, next) => {
		const response = await next();

		if (options.enabled === false) {
			return response;
		}

		applySecurityHeaders(response.headers, options);
		return response;
	};
};

export const RateLimit = (options: RateLimitOptions): Middleware => {
	const limit = positiveInteger("limit", options.limit);
	const windowMs = positiveInteger("windowMs", options.windowMs);
	const store = options.store ?? new MemoryRateLimitStore();
	const headersEnabled = options.headers ?? true;

	return async (ctx, next) => {
		if (options.enabled === false || (await options.skip?.(ctx))) {
			return next();
		}

		const key = await resolveRateLimitKey(ctx, options.key);
		const state = store.hit(key, {
			limit,
			now: new Date(),
			windowMs,
		});
		const headers: Record<string, string> = headersEnabled
			? rateLimitHeaders(state)
			: {};

		if (state.exceeded) {
			throw new TooManyRequestsException("Too many requests", {
				headers,
			});
		}

		const response = await next();
		for (const [name, value] of Object.entries(headers)) {
			response.headers.set(name, value);
		}
		return response;
	};
};

export const CsrfProtection = (
	options: CsrfProtectionOptions = {},
): Middleware => {
	const cookieName = options.cookieName ?? "kura-csrf-token";
	const headerName = (options.headerName ?? "x-csrf-token").toLowerCase();
	const fieldNames = options.fieldNames ?? ["_csrf", "csrfToken"];
	const methods = new Set(
		(options.methods ?? ["POST", "PUT", "PATCH", "DELETE"]).map((method) =>
			method.toUpperCase(),
		),
	);
	const tokenLength = positiveInteger("tokenLength", options.tokenLength ?? 32);

	return async (ctx, next) => {
		if (await shouldSkipCsrf(ctx, options.except ?? [])) {
			return next();
		}

		const existingToken = readCookie(
			ctx.request.headers.get("cookie"),
			cookieName,
		);
		const csrfToken = existingToken ?? createCsrfToken(tokenLength);
		ctx.setState("csrfToken", csrfToken);

		if (methods.has(ctx.request.method.toUpperCase())) {
			const submittedToken = readSubmittedCsrfToken(ctx, {
				fieldNames,
				headerName,
			});

			if (
				!existingToken ||
				!submittedToken ||
				!timingSafeStringEqual(existingToken, submittedToken)
			) {
				throw new ForbiddenException("Invalid CSRF token", {
					code: "E_INVALID_CSRF_TOKEN",
				});
			}
		}

		const response = await next();

		if (!existingToken) {
			response.headers.append(
				"Set-Cookie",
				serializeCookie(cookieName, csrfToken, {
					httpOnly: false,
					path: options.path ?? "/",
					sameSite: options.sameSite ?? "lax",
					secure: options.secure ?? false,
				}),
			);
		}

		return response;
	};
};

function applySecurityHeaders(
	headers: Headers,
	options: SecurityHeadersOptions,
): void {
	setHeaderIfEnabled(
		headers,
		"X-Content-Type-Options",
		options.contentTypeOptions ?? "nosniff",
		serializeContentTypeOptions,
	);
	setHeaderIfEnabled(
		headers,
		"X-Frame-Options",
		options.frameOptions ?? "deny",
		serializeFrameOptions,
	);
	setHeaderIfEnabled(
		headers,
		"Referrer-Policy",
		options.referrerPolicy ?? "no-referrer",
		(value) => value,
	);
	setHeaderIfEnabled(
		headers,
		"Cross-Origin-Opener-Policy",
		options.crossOriginOpenerPolicy ?? "same-origin",
		(value) => value,
	);

	const hsts = serializeHsts(options.hsts);
	if (hsts) {
		headers.set("Strict-Transport-Security", hsts);
	}

	const contentSecurityPolicy = serializeContentSecurityPolicy(
		options.contentSecurityPolicy,
	);
	if (contentSecurityPolicy) {
		headers.set("Content-Security-Policy", contentSecurityPolicy);
	}

	for (const [name, value] of Object.entries(options.headers ?? {})) {
		if (value === false || value === undefined) {
			headers.delete(name);
		} else {
			headers.set(name, value);
		}
	}
}

function setHeaderIfEnabled(
	headers: Headers,
	name: string,
	value: string | false,
	serialize: (value: string) => string,
): void {
	if (value === false) {
		return;
	}

	headers.set(name, serialize(value));
}

function serializeContentTypeOptions(value: string): string {
	if (value !== "nosniff") {
		throw new Error("contentTypeOptions must be nosniff when enabled.");
	}

	return value;
}

function serializeFrameOptions(value: string): string {
	if (value !== "deny" && value !== "sameorigin") {
		throw new Error("frameOptions must be deny or sameorigin when enabled.");
	}

	return value === "deny" ? "DENY" : "SAMEORIGIN";
}

function serializeHsts(options: SecurityHeadersOptions["hsts"]): string | null {
	if (!options || options.enabled === false) {
		return null;
	}

	const values = [
		`max-age=${positiveInteger("hsts.maxAge", options.maxAge ?? 31_536_000)}`,
	];

	if (options.includeSubDomains ?? true) {
		values.push("includeSubDomains");
	}

	if (options.preload) {
		values.push("preload");
	}

	return values.join("; ");
}

function serializeContentSecurityPolicy(
	value: SecurityHeadersOptions["contentSecurityPolicy"],
): string | null {
	if (!value) {
		return null;
	}

	if (typeof value === "string") {
		return value;
	}

	return Object.entries(value.directives)
		.map(([directive, sources]) => {
			if (sources.length === 0) {
				return directive;
			}

			return `${directive} ${sources.join(" ")}`;
		})
		.join("; ");
}

async function resolveRateLimitKey(
	ctx: Context,
	resolver: RateLimitKeyResolver | undefined,
): Promise<string> {
	if (resolver) {
		return resolver(ctx);
	}

	const forwardedFor = firstForwardedValue(
		ctx.request.headers.get("x-forwarded-for"),
	);
	const realIp = ctx.request.headers.get("x-real-ip");

	if (forwardedFor) {
		return `ip:${forwardedFor}`;
	}

	if (realIp) {
		return `ip:${realIp}`;
	}

	return `origin:${new URL(ctx.request.url).origin}`;
}

function firstForwardedValue(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const first = value.split(",")[0]?.trim();
	return first && first.length > 0 ? first : null;
}

function rateLimitHeaders(state: RateLimitState): Record<string, string> {
	const headers: Record<string, string> = {
		"RateLimit-Limit": String(state.limit),
		"RateLimit-Remaining": String(state.remaining),
		"RateLimit-Reset": String(state.retryAfter),
	};

	if (state.exceeded) {
		headers["Retry-After"] = String(state.retryAfter);
	}

	return headers;
}

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

async function shouldSkipCsrf(
	ctx: Context,
	except: readonly CsrfExceptRoute[],
): Promise<boolean> {
	if (except.length === 0) {
		return false;
	}

	const pathname = new URL(ctx.request.url).pathname;

	for (const entry of except) {
		if (typeof entry === "string" && entry === pathname) {
			return true;
		}

		if (entry instanceof RegExp && entry.test(pathname)) {
			return true;
		}

		if (typeof entry === "function" && (await entry(ctx))) {
			return true;
		}
	}

	return false;
}

function readSubmittedCsrfToken(
	ctx: Context,
	options: {
		readonly fieldNames: readonly string[];
		readonly headerName: string;
	},
): string | null {
	const headerToken = ctx.request.headers.get(options.headerName);

	if (headerToken) {
		return headerToken;
	}

	for (const fieldName of options.fieldNames) {
		const value = ctx.input(fieldName);
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	return null;
}

function createCsrfToken(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

function timingSafeStringEqual(left: string, right: string): boolean {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);

	if (leftBytes.byteLength !== rightBytes.byteLength) {
		return false;
	}

	return timingSafeEqual(leftBytes, rightBytes);
}

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

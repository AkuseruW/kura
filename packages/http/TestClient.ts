import { AssertionError, deepStrictEqual, strictEqual } from "node:assert";
import { BaseException } from "../core/BaseException";
import type { Router } from "./Router";
import type { Context } from "./Server";

export type TestClientHandler = (ctx: Context) => Response | Promise<Response>;

export type TestClientTarget = Router | TestClientHandler;
export type TestHeadersInit = NonNullable<RequestInit["headers"]>;
export type TestBodyInit = NonNullable<RequestInit["body"]>;

export type TestQueryValue = string | number | boolean | null | undefined;
export type TestCookieValue = string | number | boolean;
export type TestFormValue = TestQueryValue;

export interface TestClientOptions {
	readonly baseUrl?: string;
	readonly headers?: TestHeadersInit;
	readonly cookies?: Record<string, TestCookieValue>;
}

export interface TestRequestOptions {
	readonly headers?: TestHeadersInit;
	readonly query?: Record<string, TestQueryValue>;
	readonly cookies?: Record<string, TestCookieValue>;
	readonly body?: TestBodyInit;
	readonly json?: unknown;
	readonly form?: Record<string, TestFormValue | readonly TestFormValue[]>;
	readonly auth?: Context["auth"] | null;
}

export interface TestLoginOptions {
	readonly guard?: string;
	readonly sessionId?: string;
	readonly cookieName?: string;
	readonly sessionCookie?: boolean;
	readonly token?: string;
	readonly claims?: Record<string, unknown>;
}

export interface TestSessionOptions {
	readonly cookieName?: string;
}

export function createTestClient(
	target: TestClientTarget,
	options: TestClientOptions = {},
): TestClient {
	return new TestClient(target, options);
}

export class TestClient {
	private readonly handler: TestClientHandler;
	private readonly baseUrl: string;
	private readonly headers: Headers;
	private readonly cookies = new Map<string, string>();
	private auth: Context["auth"];
	private sessionCookieName = "kura_session";

	constructor(target: TestClientTarget, options: TestClientOptions = {}) {
		this.handler = isRouter(target) ? handlerFromRouter(target) : target;
		this.baseUrl = options.baseUrl ?? "http://localhost";
		this.headers = new Headers(options.headers);

		for (const [name, value] of Object.entries(options.cookies ?? {})) {
			this.cookies.set(name, String(value));
		}
	}

	loginAs(user: unknown, options: TestLoginOptions = {}): this {
		const sessionId = options.sessionId ?? "test-session";
		this.sessionCookieName = options.cookieName ?? this.sessionCookieName;
		this.auth = {
			guard: options.guard ?? "test",
			user,
			sessionId,
			token: options.token,
			claims: options.claims,
		};

		if (options.sessionCookie !== false) {
			this.withCookie(this.sessionCookieName, sessionId);
		}

		return this;
	}

	logout(options: TestSessionOptions = {}): this {
		this.auth = undefined;
		this.cookies.delete(options.cookieName ?? this.sessionCookieName);

		return this;
	}

	withSession(sessionId: string, options: TestSessionOptions = {}): this {
		this.sessionCookieName = options.cookieName ?? this.sessionCookieName;
		this.withCookie(this.sessionCookieName, sessionId);

		return this;
	}

	withCookie(name: string, value: TestCookieValue): this {
		this.cookies.set(name, String(value));

		return this;
	}

	clearCookie(name: string): this {
		this.cookies.delete(name);

		return this;
	}

	cookie(name: string): string | null {
		return this.cookies.get(name) ?? null;
	}

	async get(
		path: string,
		options: TestRequestOptions = {},
	): Promise<TestResponse> {
		return this.request("GET", path, options);
	}

	async post(
		path: string,
		body?: unknown,
		options: TestRequestOptions = {},
	): Promise<TestResponse> {
		return this.request("POST", path, mergePostBody(body, options));
	}

	async request(
		method: string,
		path: string,
		options: TestRequestOptions = {},
	): Promise<TestResponse> {
		const request = new Request(this.resolveUrl(path, options.query), {
			method,
			headers: this.resolveHeaders(options),
			body: resolveBody(options),
		});
		const ctx: Context = { request };
		const auth =
			options.auth === null ? undefined : (options.auth ?? this.auth);

		if (auth) {
			ctx.auth = { ...auth };
		}

		const response = await this.dispatch(ctx);
		this.storeResponseCookies(response.headers);

		return new TestResponse(response);
	}

	private async dispatch(ctx: Context): Promise<Response> {
		try {
			return await this.handler(ctx);
		} catch (error) {
			if (error instanceof BaseException) {
				return new Response(
					JSON.stringify({ code: error.code, error: error.message }),
					{
						status: error.status,
						headers: { "Content-Type": "application/json" },
					},
				);
			}

			return new Response("Internal Server Error", { status: 500 });
		}
	}

	private resolveUrl(
		path: string,
		query: Record<string, TestQueryValue> | undefined,
	): string {
		const url = new URL(path, this.baseUrl);

		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== null && value !== undefined) {
				url.searchParams.set(key, String(value));
			}
		}

		return url.toString();
	}

	private resolveHeaders(options: TestRequestOptions): Headers {
		const headers = new Headers(this.headers);

		for (const [name, value] of new Headers(options.headers).entries()) {
			headers.set(name, value);
		}

		if (options.json !== undefined && !headers.has("Content-Type")) {
			headers.set("Content-Type", "application/json");
		}

		if (options.form !== undefined && !headers.has("Content-Type")) {
			headers.set("Content-Type", "application/x-www-form-urlencoded");
		}

		const cookies = new Map(this.cookies);
		for (const [name, value] of Object.entries(options.cookies ?? {})) {
			cookies.set(name, String(value));
		}

		if (cookies.size > 0) {
			const existingCookieHeader = headers.get("cookie");
			const cookieHeader = formatCookieHeader(cookies);
			headers.set(
				"Cookie",
				existingCookieHeader
					? `${existingCookieHeader}; ${cookieHeader}`
					: cookieHeader,
			);
		}

		return headers;
	}

	private storeResponseCookies(headers: Headers): void {
		for (const value of readSetCookieHeaders(headers)) {
			const cookie = parseSetCookie(value);
			if (!cookie) {
				continue;
			}

			if (cookie.expired) {
				this.cookies.delete(cookie.name);
			} else {
				this.cookies.set(cookie.name, cookie.value);
			}
		}
	}
}

export class TestResponse {
	constructor(readonly response: Response) {}

	get status(): number {
		return this.response.status;
	}

	get headers(): Headers {
		return this.response.headers;
	}

	ok(): boolean {
		return this.response.ok;
	}

	header(name: string): string | null {
		return this.response.headers.get(name);
	}

	cookie(name: string): string | null {
		for (const value of readSetCookieHeaders(this.response.headers)) {
			const cookie = parseSetCookie(value);
			if (cookie?.name === name) {
				return cookie.value;
			}
		}

		return null;
	}

	async text(): Promise<string> {
		return this.response.clone().text();
	}

	async json<T = unknown>(): Promise<T> {
		return (await this.response.clone().json()) as T;
	}

	assertStatus(status: number): this {
		strictEqual(
			this.status,
			status,
			`Expected response status ${status}, received ${this.status}`,
		);

		return this;
	}

	assertHeader(name: string, value: string): this {
		const actual = this.header(name);
		strictEqual(
			actual,
			value,
			`Expected response header [${name}] to be [${value}], received [${actual}]`,
		);

		return this;
	}

	assertRedirect(url: string): this {
		if (!isRedirectStatus(this.status)) {
			throw new AssertionError({
				message: `Expected response to be a redirect, received status ${this.status}`,
				actual: this.status,
				expected: redirectStatuses,
				operator: "includes",
			});
		}

		return this.assertHeader("Location", url);
	}

	async assertJson(expected: unknown): Promise<this> {
		let actual: unknown;
		try {
			actual = await this.json();
		} catch {
			throw new AssertionError({
				message: "Expected response body to be valid JSON",
				actual: await this.text(),
				expected,
				operator: "JSON.parse",
				stackStartFn: this.assertJson,
			});
		}

		deepStrictEqual(actual, expected, "Expected response JSON to match");

		return this;
	}
}

function handlerFromRouter(router: Router): TestClientHandler {
	return (ctx) => router.dispatch(ctx);
}

function mergePostBody(
	body: unknown,
	options: TestRequestOptions,
): TestRequestOptions {
	if (body === undefined) {
		return options;
	}

	if (isBodyInit(body)) {
		return { ...options, body };
	}

	return { ...options, json: body };
}

function resolveBody(options: TestRequestOptions): TestBodyInit | undefined {
	const bodyKinds = [
		options.body !== undefined,
		options.json !== undefined,
		options.form !== undefined,
	].filter(Boolean).length;

	if (bodyKinds > 1) {
		throw new Error("Test request accepts only one of body, json, or form");
	}

	if (options.body !== undefined) {
		return options.body;
	}

	if (options.json !== undefined) {
		return JSON.stringify(options.json);
	}

	if (options.form !== undefined) {
		const form = new URLSearchParams();
		for (const [key, value] of Object.entries(options.form)) {
			const values = Array.isArray(value) ? value : [value];
			for (const item of values) {
				if (item !== null && item !== undefined) {
					form.append(key, String(item));
				}
			}
		}
		return form;
	}

	return undefined;
}

function isBodyInit(value: unknown): value is TestBodyInit {
	return (
		typeof value === "string" ||
		value instanceof Blob ||
		value instanceof FormData ||
		value instanceof URLSearchParams ||
		value instanceof ArrayBuffer ||
		value instanceof ReadableStream
	);
}

function formatCookieHeader(cookies: Map<string, string>): string {
	return [...cookies.entries()]
		.map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
		.join("; ");
}

type ParsedSetCookie = {
	readonly name: string;
	readonly value: string;
	readonly expired: boolean;
};

function parseSetCookie(value: string): ParsedSetCookie | null {
	const [pair, ...attributes] = value.split(";").map((part) => part.trim());
	const [name, ...rawValue] = pair?.split("=") ?? [];

	if (!name) {
		return null;
	}

	const maxAge = attributes.find((attribute) =>
		attribute.toLowerCase().startsWith("max-age="),
	);
	const expired = maxAge?.split("=")[1] === "0";

	return {
		name,
		value: safeDecode(rawValue.join("=")),
		expired,
	};
}

function readSetCookieHeaders(headers: Headers): string[] {
	if (hasGetSetCookie(headers)) {
		return headers.getSetCookie();
	}

	const value = headers.get("set-cookie");
	return value ? splitCombinedSetCookie(value) : [];
}

type HeadersWithSetCookie = Headers & {
	getSetCookie(): string[];
};

function hasGetSetCookie(headers: Headers): headers is HeadersWithSetCookie {
	const candidate = headers as { getSetCookie?: unknown };

	return typeof candidate.getSetCookie === "function";
}

function splitCombinedSetCookie(value: string): string[] {
	return value.split(/,(?=\s*[^;,]+=)/).map((part) => part.trim());
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

const redirectStatuses = [301, 302, 303, 307, 308] as const;

function isRedirectStatus(status: number): boolean {
	return redirectStatuses.includes(status as (typeof redirectStatuses)[number]);
}

function isRouter(value: TestClientTarget): value is Router {
	return typeof value === "object" && value !== null && "match" in value;
}

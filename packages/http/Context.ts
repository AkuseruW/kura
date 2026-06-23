import type { RequestBodyType } from "./Body";
import { parseRequestBody } from "./Body";
import {
	type UploadedFile,
	uploadedFileFromEntry,
	uploadedFilesFromEntries,
} from "./Upload";

export type RequestFormData = Awaited<
	ReturnType<typeof Bun.readableStreamToFormData>
>;
export type RequestFormDataEntry = NonNullable<
	ReturnType<RequestFormData["get"]>
>;

export type ValidatedRouteData = {
	params?: unknown;
	query?: unknown;
	headers?: unknown;
	cookies?: unknown;
	body?: unknown;
};

export type AuthContext = {
	guard: string;
	user?: unknown;
	sessionId?: string;
	token?: string;
	claims?: Record<string, unknown>;
};

export type ContextState = Map<string, unknown>;

export type ContextCore = {
	request: Request;
	params?: Record<string, string>;
	body?: unknown;
	bodyType?: RequestBodyType;
	formData?: RequestFormData;
	rawBody?: string;
	validated?: ValidatedRouteData;
	requestId?: string;
	timeoutSignal?: AbortSignal;
	auth?: AuthContext;
	state?: ContextState;
};

export type ContextInit = Omit<Partial<ContextCore>, "request" | "state"> & {
	readonly state?: ContextState | Record<string, unknown>;
};

export type Context = Omit<ContextCore, "state"> & {
	state: ContextState;
	param(): Record<string, string>;
	param(name: string): string | null;
	param(name: string, defaultValue: string): string;
	query(): Record<string, string | string[]>;
	query(name: string): string | null;
	query(name: string, defaultValue: string): string;
	queries(): Record<string, string[]>;
	queries(name: string): string[];
	header(): Record<string, string>;
	header(name: string): string | null;
	header(name: string, defaultValue: string): string;
	cookie(): Record<string, string>;
	cookie(name: string): string | null;
	cookie(name: string, defaultValue: string): string;
	parseBody<T = unknown>(): Promise<T | undefined>;
	file(name: string): Promise<UploadedFile | null>;
	files(name: string): Promise<UploadedFile[]>;
	bodyValue<T = unknown>(): T | undefined;
	bodyValue<T>(defaultValue: T): T;
	raw(): string | null;
	input<T = unknown>(key: string): T | undefined;
	input<T>(key: string, defaultValue: T): T;
	all(): Record<string, unknown>;
	validatedData(): ValidatedRouteData | undefined;
	validatedData<T = unknown>(source: keyof ValidatedRouteData): T | undefined;
	validatedParams<T = unknown>(): T | undefined;
	validatedQuery<T = unknown>(): T | undefined;
	validatedHeaders<T = unknown>(): T | undefined;
	validatedCookies<T = unknown>(): T | undefined;
	validatedBody<T = unknown>(): T | undefined;
	getState<T = unknown>(key: string): T | undefined;
	getState<T>(key: string, defaultValue: T): T;
	setState(key: string, value: unknown): void;
	hasState(key: string): boolean;
	deleteState(key: string): boolean;
};

type MutableContext = ContextCore &
	Partial<Omit<Context, keyof ContextCore | "state">> & {
		state?: ContextState;
	};

export function createContext(
	request: Request,
	init: ContextInit = {},
): Context {
	const { state, ...values } = init;
	return ensureContext({
		...values,
		request,
		state: normalizeState(state),
	});
}

export function ensureContext(ctx: Context | ContextCore): Context {
	if (hasContextHelpers(ctx)) {
		return ctx;
	}

	const mutable = ctx as MutableContext;
	mutable.state = normalizeState(mutable.state);
	mutable.param = ((name?: string, defaultValue?: string) =>
		name === undefined
			? { ...(mutable.params ?? {}) }
			: (mutable.params?.[name] ?? defaultValue ?? null)) as Context["param"];
	mutable.query = ((name?: string, defaultValue?: string) => {
		const searchParams = new URL(mutable.request.url).searchParams;

		if (name === undefined) {
			return searchParamsToObject(searchParams);
		}

		return searchParams.get(name) ?? defaultValue ?? null;
	}) as Context["query"];
	mutable.queries = ((name?: string) => {
		const searchParams = new URL(mutable.request.url).searchParams;

		if (name === undefined) {
			return searchParamsToArrays(searchParams);
		}

		return searchParams.getAll(name);
	}) as Context["queries"];
	mutable.header = ((name?: string, defaultValue?: string) => {
		if (name === undefined) {
			return headersToObject(mutable.request.headers);
		}

		return mutable.request.headers.get(name) ?? defaultValue ?? null;
	}) as Context["header"];
	mutable.cookie = ((name?: string, defaultValue?: string) => {
		const cookies = cookiesToObject(mutable.request.headers.get("cookie"));

		if (name === undefined) {
			return cookies;
		}

		return cookies[name] ?? defaultValue ?? null;
	}) as Context["cookie"];
	mutable.parseBody = async <T>() =>
		(await parseRequestBody(mutable as Context)) as T | undefined;
	mutable.file = async (name: string) => {
		await parseRequestBody(mutable as Context);
		return uploadedFileFromEntry(name, mutable.formData?.get(name) ?? null);
	};
	mutable.files = async (name: string) => {
		await parseRequestBody(mutable as Context);
		return uploadedFilesFromEntries(name, mutable.formData?.getAll(name) ?? []);
	};
	mutable.bodyValue = <T>(defaultValue?: T) =>
		mutable.body === undefined ? defaultValue : (mutable.body as T);
	mutable.raw = () => mutable.rawBody ?? null;
	mutable.input = <T>(key: string, defaultValue?: T) => {
		const bodyValue = valueAtPath(bodyAsRecord(mutable.body), key);
		if (bodyValue !== undefined) {
			return bodyValue as T;
		}

		const queryValue = valueAtPath(
			searchParamsToObject(new URL(mutable.request.url).searchParams),
			key,
		);
		return queryValue === undefined ? defaultValue : (queryValue as T);
	};
	mutable.all = () => ({
		...searchParamsToObject(new URL(mutable.request.url).searchParams),
		...bodyAsRecord(mutable.body),
	});
	mutable.validatedData = <T>(source?: keyof ValidatedRouteData) =>
		source === undefined
			? mutable.validated
			: (mutable.validated?.[source] as T | undefined);
	mutable.validatedParams = <T>() => mutable.validated?.params as T | undefined;
	mutable.validatedQuery = <T>() => mutable.validated?.query as T | undefined;
	mutable.validatedHeaders = <T>() =>
		mutable.validated?.headers as T | undefined;
	mutable.validatedCookies = <T>() =>
		mutable.validated?.cookies as T | undefined;
	mutable.validatedBody = <T>() => mutable.validated?.body as T | undefined;
	mutable.getState = <T>(key: string, defaultValue?: T) =>
		mutable.state?.has(key)
			? (mutable.state.get(key) as T | undefined)
			: defaultValue;
	mutable.setState = (key: string, value: unknown) => {
		mutable.state?.set(key, value);
	};
	mutable.hasState = (key: string) => mutable.state?.has(key) ?? false;
	mutable.deleteState = (key: string) => mutable.state?.delete(key) ?? false;

	return mutable as Context;
}

function hasContextHelpers(ctx: Context | ContextCore): ctx is Context {
	return "param" in ctx && typeof ctx.param === "function";
}

function normalizeState(
	state: ContextState | Record<string, unknown> | undefined,
): ContextState {
	if (state instanceof Map) {
		return state;
	}

	return new Map(Object.entries(state ?? {}));
}

function searchParamsToObject(
	searchParams: URLSearchParams,
): Record<string, string | string[]> {
	const query: Record<string, string | string[]> = {};

	for (const key of new Set(searchParams.keys())) {
		const values = searchParams.getAll(key);
		query[key] = values.length > 1 ? values : (values[0] ?? "");
	}

	return query;
}

function searchParamsToArrays(
	searchParams: URLSearchParams,
): Record<string, string[]> {
	const query: Record<string, string[]> = {};

	for (const key of new Set(searchParams.keys())) {
		query[key] = searchParams.getAll(key);
	}

	return query;
}

function headersToObject(headers: Headers): Record<string, string> {
	const values: Record<string, string> = {};

	for (const [key, value] of headers.entries()) {
		values[key] = value;
	}

	return values;
}

function cookiesToObject(cookieHeader: string | null): Record<string, string> {
	const cookies: Record<string, string> = {};

	for (const part of cookieHeader?.split(";") ?? []) {
		const [rawName, ...rawValue] = part.trim().split("=");
		if (!rawName) {
			continue;
		}

		cookies[rawName] = decodeCookieValue(rawValue.join("="));
	}

	return cookies;
}

function decodeCookieValue(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function bodyAsRecord(body: unknown): Record<string, unknown> {
	return isRecord(body) ? body : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAtPath(values: Record<string, unknown>, path: string): unknown {
	if (path in values) {
		return values[path];
	}

	let current: unknown = values;
	for (const segment of path.split(".")) {
		if (!isRecord(current) || !(segment in current)) {
			return undefined;
		}
		current = current[segment];
	}

	return current;
}

export type KuraHeadersInit =
	| Headers
	| Record<string, string>
	| [string, string][];

export type KuraResponseInit = Omit<ResponseInit, "headers"> & {
	readonly headers?: KuraHeadersInit;
};

export type JsonErrorPayload = {
	readonly error: {
		readonly code: string;
		readonly message: string;
		readonly status: number;
		readonly details?: unknown;
	};
};

export type JsonErrorOptions = {
	readonly message: string;
	readonly status?: number;
	readonly code?: string;
	readonly details?: unknown;
	readonly headers?: KuraHeadersInit;
};

export type ProblemDetails = {
	readonly type?: string;
	readonly title: string;
	readonly status: number;
	readonly detail?: string;
	readonly instance?: string;
	readonly code?: string;
	readonly errors?: unknown;
};

export type HttpExceptionLike = {
	readonly message: string;
	readonly code: string;
	readonly status: number;
	readonly details?: unknown;
	readonly headers?: KuraHeadersInit;
};

export class KuraResponse {
	private headers: Headers = new Headers();
	private statusCode = 200;

	status(code: number): this {
		this.statusCode = code;
		return this;
	}

	header(name: string, value: string): this {
		this.headers.set(name, value);
		return this;
	}

	static json(data: unknown, init: KuraResponseInit = {}): Response {
		return new Response(JSON.stringify(data), {
			...init,
			headers: withDefaultHeader(
				init.headers,
				"Content-Type",
				"application/json",
			),
		});
	}

	json(data: unknown): Response {
		return KuraResponse.json(data, {
			headers: this.headers,
			status: this.statusCode,
		});
	}

	static ok(data: unknown, init: KuraResponseInit = {}): Response {
		return KuraResponse.json(data, withDefaultStatus(init, 200));
	}

	ok(data: unknown): Response {
		this.statusCode = 200;
		return this.json(data);
	}

	static created(data: unknown, init: KuraResponseInit = {}): Response {
		return KuraResponse.json(data, withDefaultStatus(init, 201));
	}

	created(data: unknown): Response {
		this.statusCode = 201;
		return this.json(data);
	}

	static noContent(init: KuraResponseInit = {}): Response {
		return new Response(null, {
			...init,
			headers: new Headers(init.headers),
			status: init.status ?? 204,
		});
	}

	noContent(): Response {
		return KuraResponse.noContent({ headers: this.headers });
	}

	static error(options: JsonErrorOptions): Response {
		const status = options.status ?? 500;
		const payload: JsonErrorPayload = {
			error: {
				code: options.code ?? defaultErrorCode(status),
				...(options.details === undefined ? {} : { details: options.details }),
				message: options.message,
				status,
			},
		};

		return KuraResponse.json(payload, {
			status,
			headers: options.headers,
		});
	}

	error(options: Omit<JsonErrorOptions, "headers">): Response {
		return KuraResponse.error({
			...options,
			headers: this.headers,
			status: options.status ?? this.statusCode,
		});
	}

	static problem(
		details: ProblemDetails,
		init: KuraResponseInit = {},
	): Response {
		return new Response(JSON.stringify(details), {
			...withDefaultStatus(init, details.status),
			headers: withDefaultHeader(
				init.headers,
				"Content-Type",
				"application/problem+json",
			),
		});
	}

	problem(details: ProblemDetails): Response {
		return KuraResponse.problem(details, { headers: this.headers });
	}

	static validation(
		details: unknown,
		message = "Validation failed",
		init: KuraResponseInit = {},
	): Response {
		return KuraResponse.error({
			code: "E_VALIDATION_FAILED",
			details,
			headers: init.headers,
			message,
			status: init.status ?? 422,
		});
	}

	validation(details: unknown, message = "Validation failed"): Response {
		return KuraResponse.validation(details, message, {
			headers: this.headers,
			status: this.statusCode === 200 ? 422 : this.statusCode,
		});
	}

	static notFound(
		message = "Not Found",
		init: KuraResponseInit = {},
	): Response {
		return KuraResponse.error({
			code: "E_NOT_FOUND",
			headers: init.headers,
			message,
			status: init.status ?? 404,
		});
	}

	notFound(message = "Not Found"): Response {
		return KuraResponse.notFound(message, { headers: this.headers });
	}

	static unauthorized(
		message = "Unauthorized",
		init: KuraResponseInit = {},
	): Response {
		return KuraResponse.error({
			code: "E_UNAUTHORIZED",
			headers: init.headers,
			message,
			status: init.status ?? 401,
		});
	}

	unauthorized(message = "Unauthorized"): Response {
		return KuraResponse.unauthorized(message, { headers: this.headers });
	}

	static unauthenticated(
		message = "Unauthenticated",
		init: KuraResponseInit = {},
	): Response {
		return KuraResponse.error({
			code: "E_UNAUTHENTICATED",
			headers: init.headers,
			message,
			status: init.status ?? 401,
		});
	}

	unauthenticated(message = "Unauthenticated"): Response {
		return KuraResponse.unauthenticated(message, { headers: this.headers });
	}

	static forbidden(
		message = "Forbidden",
		init: KuraResponseInit = {},
	): Response {
		return KuraResponse.error({
			code: "E_FORBIDDEN",
			headers: init.headers,
			message,
			status: init.status ?? 403,
		});
	}

	forbidden(message = "Forbidden"): Response {
		return KuraResponse.forbidden(message, { headers: this.headers });
	}

	static exception(
		error: HttpExceptionLike,
		headers?: KuraHeadersInit,
	): Response {
		return KuraResponse.error({
			code: error.code,
			details: error.details,
			headers: headers ?? error.headers,
			message: error.message,
			status: error.status,
		});
	}

	static internalServerError(headers?: KuraHeadersInit): Response {
		return KuraResponse.error({
			code: "E_INTERNAL_SERVER_ERROR",
			headers,
			message: "Internal Server Error",
			status: 500,
		});
	}

	static redirect(
		url: string,
		status = 302,
		init: KuraResponseInit = {},
	): Response {
		const headers = new Headers(init.headers);
		headers.set("Location", url);

		return new Response(null, {
			...init,
			status,
			headers,
		});
	}

	redirect(url: string, status = 302): Response {
		return KuraResponse.redirect(url, status, { headers: this.headers });
	}

	static download(
		file: Bun.BunFile,
		filename?: string,
		init: KuraResponseInit = {},
	): Response {
		const name = filename ?? file.name ?? "download";
		const headers = new Headers(init.headers);
		headers.set("Content-Disposition", `attachment; filename="${name}"`);

		return new Response(file, {
			...init,
			headers,
		});
	}

	download(file: Bun.BunFile, filename?: string): Response {
		return KuraResponse.download(file, filename, { headers: this.headers });
	}
}

function withDefaultHeader(
	headers: KuraHeadersInit | undefined,
	name: string,
	value: string,
): Headers {
	const nextHeaders = new Headers(headers);
	if (!nextHeaders.has(name)) {
		nextHeaders.set(name, value);
	}
	return nextHeaders;
}

function withDefaultStatus(
	init: KuraResponseInit,
	status: number,
): KuraResponseInit {
	return {
		...init,
		status: init.status ?? status,
	};
}

function defaultErrorCode(status: number): string {
	if (status === 400) {
		return "E_BAD_REQUEST";
	}
	if (status === 401) {
		return "E_UNAUTHORIZED";
	}
	if (status === 403) {
		return "E_FORBIDDEN";
	}
	if (status === 404) {
		return "E_NOT_FOUND";
	}
	if (status === 409) {
		return "E_CONFLICT";
	}
	if (status === 422) {
		return "E_VALIDATION_FAILED";
	}
	return status >= 500 ? "E_INTERNAL_SERVER_ERROR" : "E_HTTP_ERROR";
}

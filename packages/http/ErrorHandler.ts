import { BaseException } from "../core/BaseException";
import type { Context } from "./Context";
import type { KuraHeadersInit } from "./Response";
import { KuraResponse } from "./Response";

export type HttpErrorContext = {
	readonly request: Request;
	readonly context?: Context;
	readonly environment?: string;
};

export type NormalizedHttpError = {
	readonly code: string;
	readonly message: string;
	readonly status: number;
	readonly details?: unknown;
	readonly headers?: KuraHeadersInit;
};

export type HttpErrorRenderer = (
	error: unknown,
	normalized: NormalizedHttpError,
	context: HttpErrorContext,
) => Response | Promise<Response>;

export type HttpErrorHandler = (
	error: unknown,
	context: HttpErrorContext,
) => Response | Promise<Response>;

export type HttpErrorHandlerOptions = {
	readonly debug?: boolean;
	readonly includeStack?: boolean;
	readonly render?: HttpErrorRenderer;
};

export type HttpErrorHandlerInput = HttpErrorHandler | HttpErrorHandlerOptions;

export type HttpExceptionOptions = {
	readonly code?: string;
	readonly status?: number;
	readonly hint?: string;
	readonly docsUrl?: string;
	readonly details?: unknown;
	readonly headers?: KuraHeadersInit;
	readonly expose?: boolean;
};

export class HttpException extends BaseException {
	readonly details?: unknown;
	readonly headers?: KuraHeadersInit;
	readonly expose: boolean;

	constructor(message: string, options: HttpExceptionOptions = {}) {
		const status = normalizeStatus(options.status ?? 500);
		super(
			message,
			options.code ?? defaultHttpErrorCode(status),
			status,
			options.hint,
			options.docsUrl,
		);

		this.details = options.details;
		this.headers = options.headers;
		this.expose = options.expose ?? status < 500;
	}

	toResponse(): Response {
		return KuraResponse.exception({
			code: this.code,
			details: this.expose ? this.details : undefined,
			headers: this.headers,
			message: this.expose ? this.message : fallbackErrorMessage(this.status),
			status: this.status,
		});
	}
}

export class BadRequestException extends HttpException {
	constructor(
		message = "Bad Request",
		options: Omit<HttpExceptionOptions, "status"> = {},
	) {
		super(message, {
			...options,
			code: options.code ?? "E_BAD_REQUEST",
			status: 400,
		});
	}
}

export class UnauthorizedException extends HttpException {
	constructor(
		message = "Unauthorized",
		options: Omit<HttpExceptionOptions, "status"> = {},
	) {
		super(message, {
			...options,
			code: options.code ?? "E_UNAUTHORIZED",
			status: 401,
		});
	}
}

export class ForbiddenException extends HttpException {
	constructor(
		message = "Forbidden",
		options: Omit<HttpExceptionOptions, "status"> = {},
	) {
		super(message, {
			...options,
			code: options.code ?? "E_FORBIDDEN",
			status: 403,
		});
	}
}

export class NotFoundException extends HttpException {
	constructor(
		message = "Not Found",
		options: Omit<HttpExceptionOptions, "status"> = {},
	) {
		super(message, {
			...options,
			code: options.code ?? "E_NOT_FOUND",
			status: 404,
		});
	}
}

export class ConflictException extends HttpException {
	constructor(
		message = "Conflict",
		options: Omit<HttpExceptionOptions, "status"> = {},
	) {
		super(message, {
			...options,
			code: options.code ?? "E_CONFLICT",
			status: 409,
		});
	}
}

export class UnprocessableEntityException extends HttpException {
	constructor(
		message = "Unprocessable Entity",
		options: Omit<HttpExceptionOptions, "status"> = {},
	) {
		super(message, {
			...options,
			code: options.code ?? "E_UNPROCESSABLE_ENTITY",
			status: 422,
		});
	}
}

export class TooManyRequestsException extends HttpException {
	constructor(
		message = "Too Many Requests",
		options: Omit<HttpExceptionOptions, "status"> = {},
	) {
		super(message, {
			...options,
			code: options.code ?? "E_TOO_MANY_REQUESTS",
			status: 429,
		});
	}
}

export class InternalServerErrorException extends HttpException {
	constructor(
		message = "Internal Server Error",
		options: Omit<HttpExceptionOptions, "status"> = {},
	) {
		super(message, {
			...options,
			code: options.code ?? "E_INTERNAL_SERVER_ERROR",
			expose: options.expose ?? false,
			status: 500,
		});
	}
}

export function createHttpErrorHandler(
	options: HttpErrorHandlerOptions = {},
): HttpErrorHandler {
	return async (error, context) => handleHttpError(error, context, options);
}

export function resolveHttpErrorHandler(
	input: HttpErrorHandlerInput | undefined,
	options: HttpErrorHandlerOptions = {},
): HttpErrorHandler {
	if (typeof input === "function") {
		return input;
	}

	return createHttpErrorHandler({
		...options,
		...(input ?? {}),
	});
}

export function handleHttpError(
	error: unknown,
	context: HttpErrorContext,
	options: HttpErrorHandlerOptions = {},
): Response | Promise<Response> {
	const normalized = normalizeHttpError(error, context, options);

	if (options.render) {
		return options.render(error, normalized, context);
	}

	return KuraResponse.error({
		code: normalized.code,
		details: normalized.details,
		headers: normalized.headers,
		message: normalized.message,
		status: normalized.status,
	});
}

export function normalizeHttpError(
	error: unknown,
	context: HttpErrorContext,
	options: HttpErrorHandlerOptions = {},
): NormalizedHttpError {
	if (isHttpException(error)) {
		return normalizeException(error, context, options);
	}

	if (error instanceof BaseException) {
		return {
			code: error.code,
			message: error.message,
			status: normalizeStatus(error.status),
		};
	}

	if (isHttpExceptionLike(error)) {
		const status = normalizeStatus(error.status);
		const expose = error.expose ?? status < 500;
		const fallback = fallbackErrorMessage(status);
		return {
			code: error.code,
			details: expose ? error.details : undefined,
			headers: error.headers,
			message: expose ? error.message : fallback,
			status,
		};
	}

	const debug = shouldDebug(context, options);
	const details = debug ? debugDetails(error, options) : undefined;

	return {
		code: "E_INTERNAL_SERVER_ERROR",
		details,
		message:
			debug && error instanceof Error ? error.message : "Internal Server Error",
		status: 500,
	};
}

export function httpStatusFromError(error: unknown): number {
	if (error instanceof BaseException) {
		return normalizeStatus(error.status);
	}

	if (isStatusBearing(error)) {
		return normalizeStatus(error.status);
	}

	return 500;
}

export function defaultHttpErrorCode(status: number): string {
	const normalized = normalizeStatus(status);

	if (normalized === 400) {
		return "E_BAD_REQUEST";
	}
	if (normalized === 401) {
		return "E_UNAUTHORIZED";
	}
	if (normalized === 403) {
		return "E_FORBIDDEN";
	}
	if (normalized === 404) {
		return "E_NOT_FOUND";
	}
	if (normalized === 409) {
		return "E_CONFLICT";
	}
	if (normalized === 413) {
		return "E_REQUEST_BODY_TOO_LARGE";
	}
	if (normalized === 422) {
		return "E_VALIDATION_FAILED";
	}
	if (normalized === 429) {
		return "E_TOO_MANY_REQUESTS";
	}
	return normalized >= 500 ? "E_INTERNAL_SERVER_ERROR" : "E_HTTP_ERROR";
}

function normalizeException(
	error: HttpException,
	context: HttpErrorContext,
	options: HttpErrorHandlerOptions,
): NormalizedHttpError {
	const status = normalizeStatus(error.status);
	const expose = error.expose || shouldDebug(context, options);

	return {
		code: error.code,
		details: expose ? error.details : undefined,
		headers: error.headers,
		message: expose ? error.message : fallbackErrorMessage(status),
		status,
	};
}

function shouldDebug(
	context: HttpErrorContext,
	options: HttpErrorHandlerOptions,
): boolean {
	if (options.debug !== undefined) {
		return options.debug;
	}

	return context.environment === "development";
}

function debugDetails(
	error: unknown,
	options: HttpErrorHandlerOptions,
): Record<string, unknown> {
	if (error instanceof Error) {
		return {
			name: error.name,
			...(options.includeStack === false ? {} : { stack: error.stack }),
		};
	}

	return { thrown: stringifyUnknown(error) };
}

function fallbackErrorMessage(status: number): string {
	return status >= 500 ? "Internal Server Error" : "HTTP Error";
}

function normalizeStatus(status: number): number {
	return Number.isInteger(status) && status >= 400 && status <= 599
		? status
		: 500;
}

type HttpExceptionShape = {
	readonly code: string;
	readonly message: string;
	readonly status: number;
	readonly details?: unknown;
	readonly headers?: KuraHeadersInit;
	readonly expose?: boolean;
};

function isHttpException(error: unknown): error is HttpException {
	return error instanceof HttpException;
}

function isHttpExceptionLike(error: unknown): error is HttpExceptionShape {
	return (
		isRecord(error) &&
		typeof error.code === "string" &&
		typeof error.message === "string" &&
		typeof error.status === "number"
	);
}

function isStatusBearing(error: unknown): error is { readonly status: number } {
	return isRecord(error) && typeof error.status === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringifyUnknown(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

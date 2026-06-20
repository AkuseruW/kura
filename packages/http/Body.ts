import { BaseException } from "../core/BaseException";
import type { Context, RequestFormData, RequestFormDataEntry } from "./Context";
import { BadRequestException } from "./ErrorHandler";

export type RequestBodyKind = "json" | "form" | "text" | "unknown";
export type RequestFormBodyValue =
	| RequestFormDataEntry
	| readonly RequestFormDataEntry[];
export type RequestBodyType =
	| "json"
	| "multipart"
	| "text"
	| "unknown"
	| "urlencoded";
export type ParseRequestBodyOptions = {
	readonly parseText?: boolean;
};

export async function parseRequestBody(
	ctx: Context,
	options: ParseRequestBodyOptions = {},
): Promise<unknown> {
	if (ctx.body !== undefined) {
		return ctx.body;
	}

	if (!ctx.request.body) {
		return undefined;
	}

	const contentType = ctx.request.headers.get("content-type") ?? "";
	const bodyType = requestBodyTypeFromContentType(contentType);
	ctx.bodyType = bodyType;

	if (bodyType === "json") {
		try {
			ctx.rawBody = await ctx.request.text();
			ctx.body = parseJsonBody(ctx.rawBody);
		} catch (error) {
			if (error instanceof BaseException) {
				throw error;
			}

			throw new BadRequestException("Invalid JSON request body", {
				code: "E_INVALID_REQUEST_BODY",
				details: { reason: errorMessage(error) },
			});
		}
		return ctx.body;
	}

	if (bodyType === "urlencoded") {
		try {
			ctx.rawBody = await ctx.request.text();
			ctx.formData = urlEncodedBodyToFormData(ctx.rawBody);
			ctx.body = formDataToObject(ctx.formData);
		} catch (error) {
			if (error instanceof BaseException) {
				throw error;
			}

			throw new BadRequestException("Invalid form request body", {
				code: "E_INVALID_REQUEST_BODY",
				details: { reason: errorMessage(error) },
			});
		}
		return ctx.body;
	}

	if (bodyType === "multipart") {
		try {
			const formData = await parseRequestFormData(ctx.request, contentType);
			ctx.formData = formData;
			ctx.body = formDataToObject(formData);
		} catch (error) {
			if (error instanceof BaseException) {
				throw error;
			}

			throw new BadRequestException("Invalid form request body", {
				code: "E_INVALID_REQUEST_BODY",
				details: { reason: errorMessage(error) },
			});
		}
		return ctx.body;
	}

	if (bodyType === "text" && options.parseText !== false) {
		ctx.rawBody = await ctx.request.text();
		ctx.body = ctx.rawBody;
		return ctx.body;
	}

	return undefined;
}

export function requestMayHaveBody(request: Request): boolean {
	return (
		request.method !== "GET" && request.method !== "HEAD" && !!request.body
	);
}

export function requestBodyKindFromContentType(
	contentType: string | null,
): RequestBodyKind {
	const bodyType = requestBodyTypeFromContentType(contentType);

	if (bodyType === "multipart" || bodyType === "urlencoded") {
		return "form";
	}

	return bodyType;
}

export function requestBodyTypeFromContentType(
	contentType: string | null,
): RequestBodyType {
	const normalized = contentType?.toLowerCase() ?? "";

	const mime = normalized.split(";")[0]?.trim() ?? "";

	if (
		mime === "application/json" ||
		mime.endsWith("+json") ||
		mime === "application/csp-report"
	) {
		return "json";
	}

	if (normalized.includes("multipart/form-data")) {
		return "multipart";
	}

	if (normalized.includes("application/x-www-form-urlencoded")) {
		return "urlencoded";
	}

	return normalized.startsWith("text/") ? "text" : "unknown";
}

export async function parseRequestFormData(
	request: Request,
	contentType = request.headers.get("content-type"),
): Promise<RequestFormData> {
	if (!request.body) {
		return new FormData();
	}

	return Bun.readableStreamToFormData(
		request.body,
		extractMultipartBoundary(contentType),
	);
}

export function formDataToObject(
	formData: RequestFormData,
): Record<string, RequestFormBodyValue> {
	const body: Record<string, RequestFormBodyValue> = {};

	for (const key of new Set(formData.keys())) {
		const values = formData.getAll(key) as RequestFormDataEntry[];
		const [firstValue] = values;
		if (firstValue === undefined) {
			continue;
		}

		body[key] = values.length === 1 ? firstValue : values;
	}

	return body;
}

function extractMultipartBoundary(
	contentType: string | null,
): string | undefined {
	if (!contentType?.includes("multipart/form-data")) {
		return undefined;
	}

	const match = contentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i);
	const boundary = match?.[1] ?? match?.[2];
	if (!boundary) {
		throw new Error("Missing multipart form boundary");
	}

	return boundary;
}

function parseJsonBody(rawBody: string): unknown {
	if (rawBody === "") {
		return {};
	}

	return JSON.parse(rawBody) as unknown;
}

function urlEncodedBodyToFormData(rawBody: string): FormData {
	const formData = new FormData();
	const searchParams = new URLSearchParams(rawBody);

	for (const [key, value] of searchParams) {
		formData.append(key, value);
	}

	return formData;
}

function errorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Unable to parse request body";
}

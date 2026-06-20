import type { Context, RequestFormData, RequestFormDataEntry } from "./Context";

export type RequestBodyKind = "json" | "form" | "text" | "unknown";
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
	const bodyKind = requestBodyKindFromContentType(contentType);

	if (bodyKind === "json") {
		ctx.body = await ctx.request.json();
		return ctx.body;
	}

	if (bodyKind === "form") {
		const formData = await parseRequestFormData(ctx.request, contentType);
		ctx.formData = formData;
		ctx.body = formDataToObject(formData);
		return ctx.body;
	}

	if (bodyKind === "text" && options.parseText !== false) {
		ctx.body = await ctx.request.text();
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
	if (contentType?.includes("application/json")) {
		return "json";
	}

	if (
		contentType?.includes("multipart/form-data") ||
		contentType?.includes("application/x-www-form-urlencoded")
	) {
		return "form";
	}

	if (contentType?.startsWith("text/")) {
		return "text";
	}

	return "unknown";
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
): Record<string, RequestFormDataEntry> {
	const body: Record<string, RequestFormDataEntry> = {};
	for (const [key, value] of formData.entries()) {
		body[key] = value;
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

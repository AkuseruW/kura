import type { RequestFormData, RequestFormDataEntry } from "./Server";

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

	return boundary.replace(/^--/, "");
}

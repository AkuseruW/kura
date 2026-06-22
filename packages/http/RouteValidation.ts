import { isSchema, type SchemaLike } from "../validation/Schema";
import { parseRequestBody } from "./Body";
import { HttpException } from "./ErrorHandler";
import type {
	OpenApiSchemaInput,
	RouteOpenApiBodyObject,
	RouteOpenApiOptions,
} from "./OpenApi";
import type { Route, RouteSchemaOptions } from "./Router";
import type { Context, ValidatedRouteData } from "./Server";

export type RouteValidationErrorDetails = {
	readonly source: keyof ValidatedRouteData;
	readonly message: string;
	readonly errors: readonly {
		readonly source: keyof ValidatedRouteData;
		readonly message: string;
	}[];
};

export class RouteValidationException extends HttpException {
	constructor(
		public readonly source: keyof ValidatedRouteData,
		error: unknown,
	) {
		const message = errorMessage(error);
		super(`Validation failed for request ${source}: ${message}`, {
			code: "E_ROUTE_VALIDATION",
			details: {
				source,
				message,
				errors: [{ source, message }],
			} satisfies RouteValidationErrorDetails,
			status: 422,
		});
	}
}

export type RouteValidationPlan = Omit<RouteSchemaOptions, "responses">;

export async function validateRouteRequest(
	route: Route,
	ctx: Context,
	params: Record<string, string>,
	url: URL,
): Promise<void> {
	const schemas = route.validation;
	const validated: ValidatedRouteData = { ...(ctx.validated ?? {}) };

	if (schemas.params) {
		validated.params = await validateRequestPart(
			"params",
			schemas.params,
			params,
		);
	}

	if (schemas.query) {
		validated.query = await validateRequestPart(
			"query",
			schemas.query,
			searchParamsToObject(url.searchParams),
		);
	}

	if (schemas.headers) {
		validated.headers = await validateRequestPart(
			"headers",
			schemas.headers,
			headersToObject(ctx.request.headers),
		);
	}

	if (schemas.cookies) {
		validated.cookies = await validateRequestPart(
			"cookies",
			schemas.cookies,
			cookiesToObject(ctx.request.headers.get("cookie")),
		);
	}

	if (schemas.body) {
		validated.body = await validateRequestPart(
			"body",
			schemas.body,
			await parseRequestBody(ctx),
		);
	}

	if (Object.keys(validated).length > 0) {
		ctx.validated = validated;
	}
}

export function compileRouteValidationPlan(route: {
	readonly schema?: RouteSchemaOptions;
	readonly openapi?: RouteOpenApiOptions;
}): RouteValidationPlan {
	return {
		params: route.schema?.params,
		query: route.schema?.query,
		headers: route.schema?.headers,
		cookies: route.schema?.cookies,
		body: route.schema?.body ?? schemaFromOpenApiBody(route.openapi?.body),
	};
}

async function validateRequestPart(
	source: keyof ValidatedRouteData,
	schema: SchemaLike<unknown>,
	value: unknown,
): Promise<unknown> {
	try {
		return await schema.parseAsync(value);
	} catch (error) {
		throw new RouteValidationException(source, error);
	}
}

function schemaFromOpenApiBody(
	body: RouteOpenApiOptions["body"] | undefined,
): SchemaLike<unknown> | undefined {
	if (isSchema(body)) {
		return body;
	}

	if (isRouteOpenApiBodyObject(body) && isSchema(body.schema)) {
		return body.schema;
	}

	return undefined;
}

function searchParamsToObject(
	searchParams: URLSearchParams,
): Record<string, string | readonly string[]> {
	const output: Record<string, string | readonly string[]> = {};

	for (const [key, value] of searchParams) {
		const current = output[key];

		if (current === undefined) {
			output[key] = value;
		} else if (typeof current === "string") {
			output[key] = [current, value];
		} else {
			output[key] = [...current, value];
		}
	}

	return output;
}

function headersToObject(headers: Headers): Record<string, string> {
	const output: Record<string, string> = {};

	for (const [key, value] of headers) {
		output[key.toLowerCase()] = value;
	}

	return output;
}

function cookiesToObject(cookieHeader: string | null): Record<string, string> {
	const output: Record<string, string> = {};

	for (const cookie of cookieHeader?.split(";") ?? []) {
		const [rawName, ...valueParts] = cookie.split("=");
		const name = rawName?.trim();

		if (!name) {
			continue;
		}

		output[name] = decodeURIComponent(valueParts.join("=").trim());
	}

	return output;
}

function isRouteOpenApiBodyObject(
	value: RouteOpenApiOptions["body"] | undefined,
): value is RouteOpenApiBodyObject {
	return (
		!isSchema(value) &&
		isRecord(value) &&
		"schema" in value &&
		isOpenApiSchemaInput(value.schema)
	);
}

function isOpenApiSchemaInput(value: unknown): value is OpenApiSchemaInput {
	return isSchema(value) || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "validation failed";
}

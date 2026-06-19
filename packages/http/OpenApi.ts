import { Schema, type SchemaDescription } from "../validator/Schema";
import type { RegisteredRoute, Router, RouteSchemaOptions } from "./Router";

export type OpenApiJsonPrimitive = string | number | boolean | null;
export type OpenApiJsonValue =
	| OpenApiJsonPrimitive
	| readonly OpenApiJsonValue[]
	| { readonly [key: string]: OpenApiJsonValue };

export type OpenApiReferenceObject = {
	readonly $ref: string;
};

export type OpenApiSchemaObject = {
	readonly type?: string | readonly string[];
	readonly format?: string;
	readonly enum?: readonly OpenApiJsonPrimitive[];
	readonly nullable?: boolean;
	readonly items?: OpenApiSchemaObject | OpenApiReferenceObject;
	readonly properties?: Record<
		string,
		OpenApiSchemaObject | OpenApiReferenceObject
	>;
	readonly required?: readonly string[];
	readonly additionalProperties?:
		| boolean
		| OpenApiSchemaObject
		| OpenApiReferenceObject;
	readonly description?: string;
	readonly example?: OpenApiJsonValue;
};

export type OpenApiMediaTypeObject = {
	readonly schema?: OpenApiSchemaObject | OpenApiReferenceObject;
	readonly example?: OpenApiJsonValue;
};

export type OpenApiContentObject = Record<string, OpenApiMediaTypeObject>;

export type OpenApiRequestBodyObject = {
	readonly description?: string;
	readonly required?: boolean;
	readonly content: OpenApiContentObject;
};

export type OpenApiHeaderObject = {
	readonly description?: string;
	readonly schema?: OpenApiSchemaObject | OpenApiReferenceObject;
};

export type OpenApiResponseObject = {
	readonly description: string;
	readonly headers?: Record<string, OpenApiHeaderObject>;
	readonly content?: OpenApiContentObject;
};

export type OpenApiResponsesObject = Record<string, OpenApiResponseObject>;

export type OpenApiParameterObject = {
	readonly name: string;
	readonly in: "path" | "query" | "header" | "cookie";
	readonly required?: boolean;
	readonly description?: string;
	readonly schema?: OpenApiSchemaObject | OpenApiReferenceObject;
};

export type OpenApiSecurityRequirementObject = Record<
	string,
	readonly string[]
>;

export type OpenApiOperationObject = {
	readonly tags?: readonly string[];
	readonly summary?: string;
	readonly description?: string;
	readonly operationId?: string;
	readonly parameters?: readonly OpenApiParameterObject[];
	readonly requestBody?: OpenApiRequestBodyObject;
	readonly responses: OpenApiResponsesObject;
	readonly deprecated?: boolean;
	readonly security?: readonly OpenApiSecurityRequirementObject[];
};

export type OpenApiHttpMethod =
	| "get"
	| "put"
	| "post"
	| "delete"
	| "patch"
	| "options"
	| "head";

export type OpenApiPathItemObject = Partial<
	Record<OpenApiHttpMethod, OpenApiOperationObject>
>;

export type OpenApiTagObject = {
	readonly name: string;
	readonly description?: string;
};

export type OpenApiSecuritySchemeObject = {
	readonly type: string;
	readonly description?: string;
	readonly name?: string;
	readonly in?: string;
	readonly scheme?: string;
	readonly bearerFormat?: string;
	readonly flows?: OpenApiJsonValue;
	readonly openIdConnectUrl?: string;
};

export type OpenApiComponentsObject = {
	readonly schemas?: Record<
		string,
		OpenApiSchemaObject | OpenApiReferenceObject
	>;
	readonly securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
};

export type OpenApiDocument = {
	readonly openapi: OpenApiVersion;
	readonly info: {
		readonly title: string;
		readonly version: string;
		readonly description?: string;
	};
	readonly servers?: readonly {
		readonly url: string;
		readonly description?: string;
	}[];
	readonly tags?: readonly OpenApiTagObject[];
	readonly paths: Record<string, OpenApiPathItemObject>;
	readonly components?: OpenApiComponentsObject;
	readonly security?: readonly OpenApiSecurityRequirementObject[];
};

export type OpenApiVersion = "3.0.4" | "3.1.2" | "3.2.0";

export type OpenApiSchemaInput =
	| Schema<unknown>
	| OpenApiSchemaObject
	| OpenApiReferenceObject;

export type RouteOpenApiBodyObject = {
	readonly description?: string;
	readonly schema: OpenApiSchemaInput;
	readonly contentType?: string;
	readonly required?: boolean;
};

export type RouteOpenApiResponseObject = {
	readonly description?: string;
	readonly body?: OpenApiSchemaInput;
	readonly contentType?: string;
	readonly headers?: Record<string, OpenApiHeaderObject>;
};

export type RouteOpenApiOptions = {
	readonly hidden?: boolean;
	readonly tags?: readonly string[];
	readonly summary?: string;
	readonly description?: string;
	readonly operationId?: string;
	readonly parameters?: readonly OpenApiParameterObject[];
	readonly body?: OpenApiSchemaInput | RouteOpenApiBodyObject;
	readonly responses?: Record<
		string | number,
		OpenApiSchemaInput | RouteOpenApiResponseObject
	>;
	readonly deprecated?: boolean;
	readonly security?: readonly OpenApiSecurityRequirementObject[];
};

export type OpenApiDocumentOptions = {
	readonly specVersion?: OpenApiVersion;
	readonly title?: string;
	readonly version?: string;
	readonly description?: string;
	readonly servers?: readonly {
		readonly url: string;
		readonly description?: string;
	}[];
	readonly tags?: readonly OpenApiTagObject[];
	readonly components?: OpenApiComponentsObject;
	readonly security?: readonly OpenApiSecurityRequirementObject[];
};

export type OpenApiDocsUi = "scalar" | "swagger";

export type OpenApiRoutesOptions = OpenApiDocumentOptions & {
	readonly path?: string;
	readonly docsPath?: string;
	readonly ui?: OpenApiDocsUi;
};

const DEFAULT_OPENAPI_PATH = "/openapi.json";
const DEFAULT_DOCS_PATH = "/docs";
const DEFAULT_OPENAPI_VERSION = "3.1.2";
const JSON_CONTENT_TYPE = "application/json";

export function createOpenApiDocument(
	router: Router,
	options: OpenApiDocumentOptions = {},
): OpenApiDocument {
	const specVersion = options.specVersion ?? DEFAULT_OPENAPI_VERSION;
	const paths: Record<string, OpenApiPathItemObject> = {};

	for (const route of router.list()) {
		if (route.openapi?.hidden) {
			continue;
		}

		const method = route.method.toLowerCase();
		if (!isOpenApiHttpMethod(method)) {
			continue;
		}

		const openApiPath = routePathToOpenApiPath(route.path);
		const pathItem = paths[openApiPath] ?? {};
		pathItem[method] = createOperation(route, specVersion);
		paths[openApiPath] = pathItem;
	}

	return {
		openapi: specVersion,
		info: {
			title: options.title ?? "Kura API",
			version: options.version ?? "0.1.0",
			description: options.description,
		},
		servers: options.servers,
		tags: options.tags,
		paths,
		components: options.components,
		security: options.security,
	};
}

export function registerOpenApiRoutes(
	router: Router,
	options: OpenApiRoutesOptions = {},
): void {
	const openApiPath = normalizeRoutePath(options.path ?? DEFAULT_OPENAPI_PATH);
	const docsPath = normalizeRoutePath(options.docsPath ?? DEFAULT_DOCS_PATH);
	const ui = options.ui ?? "scalar";

	router
		.get(openApiPath, () =>
			Response.json(createOpenApiDocument(router, options)),
		)
		.openapi({ hidden: true });

	router
		.get(
			docsPath,
			() =>
				new Response(
					renderOpenApiHtml({ openApiPath, title: options.title, ui }),
					{
						headers: { "Content-Type": "text/html; charset=utf-8" },
					},
				),
		)
		.openapi({ hidden: true });
}

export function toOpenApiSchema(
	input: OpenApiSchemaInput,
	specVersion: OpenApiVersion = DEFAULT_OPENAPI_VERSION,
): OpenApiSchemaObject | OpenApiReferenceObject {
	if (input instanceof Schema) {
		return schemaDescriptionToOpenApi(input.describe(), specVersion);
	}

	return input;
}

function createOperation(
	route: RegisteredRoute,
	specVersion: OpenApiVersion,
): OpenApiOperationObject {
	const options = route.openapi;
	const parameters = [
		...createSchemaParameters(
			"path",
			route.schema?.params,
			specVersion,
			route.params,
		),
		...createSchemaParameters("query", route.schema?.query, specVersion),
		...createSchemaParameters("header", route.schema?.headers, specVersion),
		...createSchemaParameters("cookie", route.schema?.cookies, specVersion),
		...(options?.parameters ?? []),
	];
	const operationId =
		options?.operationId ?? route.name?.replace(/[^A-Za-z0-9_]+/g, "_");

	return {
		tags: options?.tags,
		summary: options?.summary,
		description: options?.description,
		operationId,
		parameters: parameters.length > 0 ? parameters : undefined,
		requestBody: requestBodyForRoute(route, specVersion),
		responses: createResponses(
			options?.responses ?? route.schema?.responses,
			specVersion,
		),
		deprecated: options?.deprecated,
		security: options?.security,
	};
}

function requestBodyForRoute(
	route: RegisteredRoute,
	specVersion: OpenApiVersion,
): OpenApiRequestBodyObject | undefined {
	if (route.openapi?.body) {
		return createRequestBody(route.openapi.body, specVersion);
	}

	return route.schema?.body
		? createRequestBody(route.schema.body, specVersion)
		: undefined;
}

function createSchemaParameters(
	location: OpenApiParameterObject["in"],
	schema: RouteSchemaOptions[keyof Pick<
		RouteSchemaOptions,
		"cookies" | "headers" | "params" | "query"
	>],
	specVersion: OpenApiVersion,
	pathParams: readonly string[] = [],
): readonly OpenApiParameterObject[] {
	if (!schema) {
		return location === "path"
			? pathParams.map((name) => createPathParameter(name))
			: [];
	}

	const description = schema.describe();
	if (description.type !== "object" || !description.shape) {
		return location === "path"
			? pathParams.map((name) => createPathParameter(name))
			: [];
	}

	if (location === "path") {
		return pathParams.map((name) =>
			createPathParameter(
				name,
				description.shape?.[name]
					? schemaDescriptionToOpenApi(description.shape[name], specVersion)
					: undefined,
			),
		);
	}

	return Object.entries(description.shape).map(([name, field]) => ({
		name,
		in: location,
		required: !field.optional,
		schema: schemaDescriptionToOpenApi(field, specVersion),
	}));
}

function createPathParameter(
	name: string,
	schema: OpenApiSchemaObject | OpenApiReferenceObject = { type: "string" },
): OpenApiParameterObject {
	return {
		name,
		in: "path",
		required: true,
		schema,
	};
}

function createRequestBody(
	body: OpenApiSchemaInput | RouteOpenApiBodyObject,
	specVersion: OpenApiVersion,
): OpenApiRequestBodyObject {
	if (isRouteOpenApiBodyObject(body)) {
		return {
			description: body.description,
			required: body.required,
			content: {
				[body.contentType ?? JSON_CONTENT_TYPE]: {
					schema: toOpenApiSchema(body.schema, specVersion),
				},
			},
		};
	}

	return {
		required: true,
		content: {
			[JSON_CONTENT_TYPE]: {
				schema: toOpenApiSchema(body, specVersion),
			},
		},
	};
}

function createResponses(
	responses?: Record<
		string | number,
		OpenApiSchemaInput | RouteOpenApiResponseObject
	>,
	specVersion: OpenApiVersion = DEFAULT_OPENAPI_VERSION,
): OpenApiResponsesObject {
	if (!responses) {
		return { "200": { description: "OK" } };
	}

	const normalized: OpenApiResponsesObject = {};
	for (const [status, response] of Object.entries(responses)) {
		normalized[status] = createResponse(status, response, specVersion);
	}
	return normalized;
}

function createResponse(
	status: string,
	response: OpenApiSchemaInput | RouteOpenApiResponseObject,
	specVersion: OpenApiVersion,
): OpenApiResponseObject {
	if (isRouteOpenApiResponseObject(response)) {
		return {
			description: response.description ?? defaultResponseDescription(status),
			headers: response.headers,
			content: response.body
				? {
						[response.contentType ?? JSON_CONTENT_TYPE]: {
							schema: toOpenApiSchema(response.body, specVersion),
						},
					}
				: undefined,
		};
	}

	return {
		description: defaultResponseDescription(status),
		content: {
			[JSON_CONTENT_TYPE]: {
				schema: toOpenApiSchema(response, specVersion),
			},
		},
	};
}

function schemaDescriptionToOpenApi(
	description: SchemaDescription,
	specVersion: OpenApiVersion,
): OpenApiSchemaObject {
	const schema = schemaDescriptionToOpenApiWithoutNullability(
		description,
		specVersion,
	);
	if (!description.nullable) {
		return schema;
	}

	return addNullability(schema, specVersion);
}

function schemaDescriptionToOpenApiWithoutNullability(
	description: SchemaDescription,
	specVersion: OpenApiVersion,
): OpenApiSchemaObject {
	if (description.type === "string") {
		return { type: "string" };
	}

	if (description.type === "number") {
		return { type: "number" };
	}

	if (description.type === "boolean") {
		return { type: "boolean" };
	}

	if (description.type === "array") {
		return {
			type: "array",
			items: description.item
				? schemaDescriptionToOpenApi(description.item, specVersion)
				: {},
		};
	}

	if (description.type === "object") {
		const properties: Record<
			string,
			OpenApiSchemaObject | OpenApiReferenceObject
		> = {};
		const required: string[] = [];

		for (const [key, field] of Object.entries(description.shape ?? {})) {
			properties[key] = schemaDescriptionToOpenApi(field, specVersion);
			if (!field.optional) {
				required.push(key);
			}
		}

		return {
			type: "object",
			properties,
			required: required.length > 0 ? required : undefined,
		};
	}

	if (description.type === "enum") {
		return {
			type: "string",
			enum: description.values ?? [],
		};
	}

	if (description.type === "date") {
		return { type: "string", format: "date-time" };
	}

	if (description.type === "file") {
		return { type: "string", format: "binary" };
	}

	return {};
}

function addNullability(
	schema: OpenApiSchemaObject,
	specVersion: OpenApiVersion,
): OpenApiSchemaObject {
	if (specVersion === "3.0.4") {
		return { ...schema, nullable: true };
	}

	const enumValues = schema.enum ? appendNull(schema.enum) : undefined;
	return {
		...schema,
		type: appendNullType(schema.type),
		enum: enumValues,
	};
}

function appendNullType(
	type: OpenApiSchemaObject["type"],
): OpenApiSchemaObject["type"] {
	if (!type) {
		return undefined;
	}

	const types = Array.isArray(type) ? type : [type];
	return types.includes("null") ? types : [...types, "null"];
}

function appendNull(
	values: readonly OpenApiJsonPrimitive[],
): readonly OpenApiJsonPrimitive[] {
	return values.includes(null) ? values : [...values, null];
}

function isRouteOpenApiBodyObject(
	value: OpenApiSchemaInput | RouteOpenApiBodyObject,
): value is RouteOpenApiBodyObject {
	return !(value instanceof Schema) && isRecord(value) && "schema" in value;
}

function isRouteOpenApiResponseObject(
	value: OpenApiSchemaInput | RouteOpenApiResponseObject,
): value is RouteOpenApiResponseObject {
	return (
		!(value instanceof Schema) &&
		isRecord(value) &&
		("body" in value ||
			"headers" in value ||
			"contentType" in value ||
			("description" in value && !("type" in value) && !("$ref" in value)))
	);
}

function isOpenApiHttpMethod(value: string): value is OpenApiHttpMethod {
	return (
		value === "get" ||
		value === "put" ||
		value === "post" ||
		value === "delete" ||
		value === "patch" ||
		value === "options" ||
		value === "head"
	);
}

function routePathToOpenApiPath(path: string): string {
	return path.replace(/:(\w+)/g, "{$1}");
}

function normalizeRoutePath(path: string): string {
	const trimmed = path.replace(/^\/+|\/+$/g, "");
	return trimmed ? `/${trimmed}` : "/";
}

function defaultResponseDescription(status: string): string {
	if (status === "204") {
		return "No Content";
	}

	if (status.startsWith("4")) {
		return "Client Error";
	}

	if (status.startsWith("5")) {
		return "Server Error";
	}

	return "OK";
}

function renderOpenApiHtml(options: {
	readonly openApiPath: string;
	readonly title?: string;
	readonly ui: OpenApiDocsUi;
}): string {
	return options.ui === "swagger"
		? renderSwaggerHtml(options.openApiPath, options.title)
		: renderScalarHtml(options.openApiPath, options.title);
}

function renderScalarHtml(openApiPath: string, title?: string): string {
	const pageTitle = escapeHtml(title ?? "API Reference");
	const jsonPath = JSON.stringify(openApiPath);

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${pageTitle}</title>
</head>
<body>
	<div id="app"></div>
	<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
	<script>
		Scalar.createApiReference("#app", { url: ${jsonPath} });
	</script>
</body>
</html>`;
}

function renderSwaggerHtml(openApiPath: string, title?: string): string {
	const pageTitle = escapeHtml(title ?? "API Reference");
	const jsonPath = JSON.stringify(openApiPath);

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${pageTitle}</title>
	<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
	<div id="swagger-ui"></div>
	<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
	<script>
		SwaggerUIBundle({
			url: ${jsonPath},
			dom_id: "#swagger-ui"
		});
	</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

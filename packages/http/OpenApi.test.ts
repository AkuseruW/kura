import { describe, expect, test } from "bun:test";
import { k, type SchemaLike } from "../validation/Schema";
import { createContext } from "./Context";
import {
	createOpenApiDocument,
	type OpenApiDocument,
	registerOpenApiRoutes,
	toOpenApiSchema,
} from "./OpenApi";
import { Router } from "./Router";

const request = new Request("http://localhost/docs");

describe("OpenAPI", () => {
	test("creates an OpenAPI document from router metadata", () => {
		const router = new Router();
		const userSchema = k.object({
			id: k.number(),
			email: k.string().email(),
			role: k.enum(["admin", "user"]),
			deletedAt: k.date().nullable(),
			tags: k.array(k.string()).optional(),
		});

		router
			.post("/users/:id", () => Response.json({}))
			.as("users.update")
			.openapi({
				tags: ["Users"],
				summary: "Update a user",
				security: [{ bearerAuth: [] }],
				body: userSchema,
				responses: {
					200: userSchema,
					404: { description: "User not found" },
				},
			});

		const document = createOpenApiDocument(router, {
			title: "Demo API",
			version: "1.2.3",
			components: {
				securitySchemes: {
					bearerAuth: { type: "http", scheme: "bearer" },
				},
			},
		});
		const operation = document.paths["/users/{id}"]?.post;

		expect(document.openapi).toBe("3.1.2");
		expect(document.info).toEqual({
			title: "Demo API",
			version: "1.2.3",
			description: undefined,
		});
		expect(operation?.operationId).toBe("users_update");
		expect(operation?.tags).toEqual(["Users"]);
		expect(operation?.summary).toBe("Update a user");
		expect(operation?.security).toEqual([{ bearerAuth: [] }]);
		expect(document.components?.securitySchemes?.bearerAuth).toEqual({
			type: "http",
			scheme: "bearer",
		});
		expect(operation?.parameters).toEqual([
			{
				name: "id",
				in: "path",
				required: true,
				schema: { type: "string" },
			},
		]);
		expect(operation?.requestBody).toEqual({
			required: true,
			content: {
				"application/json": {
					schema: toOpenApiSchema(userSchema),
				},
			},
		});
		expect(operation?.responses["200"]?.content?.["application/json"]).toEqual({
			schema: toOpenApiSchema(userSchema),
		});
		expect(operation?.responses["404"]?.description).toBe("User not found");
	});

	test("converts Kura schemas to OpenAPI schemas", () => {
		const schema = k.object({
			name: k.string(),
			avatar: k.file().optional(),
			birthday: k.date().nullable(),
			roles: k.array(k.enum(["admin", "user"])),
		});

		expect(toOpenApiSchema(schema)).toEqual({
			type: "object",
			properties: {
				name: { type: "string" },
				avatar: { type: "string", format: "binary" },
				birthday: { type: ["string", "null"], format: "date-time" },
				roles: {
					type: "array",
					items: { type: "string", enum: ["admin", "user"] },
				},
			},
			required: ["name", "birthday", "roles"],
		});
	});

	test("converts schema-like values from separate public entrypoints", () => {
		const schema = schemaLike(
			k.object({
				email: k.string().email(),
				password: k.string().min(1),
			}),
		);

		expect(toOpenApiSchema(schema)).toEqual({
			type: "object",
			properties: {
				email: { type: "string" },
				password: { type: "string" },
			},
			required: ["email", "password"],
		});
	});

	test("supports OpenAPI 3.0 nullable schemas", () => {
		const schema = k.object({
			status: k.enum(["active", "disabled"]).nullable(),
		});

		expect(toOpenApiSchema(schema, "3.0.4")).toEqual({
			type: "object",
			properties: {
				status: {
					type: "string",
					enum: ["active", "disabled"],
					nullable: true,
				},
			},
			required: ["status"],
		});
	});

	test("supports OpenAPI 3.2 documents", () => {
		const router = new Router();
		router
			.get("/health", () => Response.json({ status: "up" }))
			.openapi({
				responses: {
					200: k.object({
						status: k.enum(["up", "down"]).nullable(),
					}),
				},
			});

		const document = createOpenApiDocument(router, {
			specVersion: "3.2.0",
		});
		const responseSchema =
			document.paths["/health"]?.get?.responses["200"]?.content?.[
				"application/json"
			]?.schema;

		expect(document.openapi).toBe("3.2.0");
		expect(responseSchema).toEqual({
			type: "object",
			properties: {
				status: {
					type: ["string", "null"],
					enum: ["up", "down", null],
				},
			},
			required: ["status"],
		});
	});

	test("creates request and response documentation from route schemas", () => {
		const router = new Router();
		const bodySchema = k.object({ email: k.string().email() });
		const responseSchema = k.object({ id: k.string(), email: k.string() });

		router
			.post("/teams/:teamId/users", () => Response.json({}))
			.schema({
				params: k.object({ teamId: k.string() }),
				query: k.object({ invite: k.string().optional() }),
				headers: k.object({ "x-request-source": k.string().optional() }),
				cookies: k.object({ session: k.string().optional() }),
				body: bodySchema,
				responses: {
					201: responseSchema,
				},
			})
			.openapi({
				tags: ["Users"],
				summary: "Create team user",
			});

		const document = createOpenApiDocument(router);
		const operation = document.paths["/teams/{teamId}/users"]?.post;

		expect(operation?.parameters).toEqual([
			{
				name: "teamId",
				in: "path",
				required: true,
				schema: { type: "string" },
			},
			{
				name: "invite",
				in: "query",
				required: false,
				schema: { type: "string" },
			},
			{
				name: "x-request-source",
				in: "header",
				required: false,
				schema: { type: "string" },
			},
			{
				name: "session",
				in: "cookie",
				required: false,
				schema: { type: "string" },
			},
		]);
		expect(operation?.requestBody).toEqual({
			required: true,
			content: {
				"application/json": {
					schema: toOpenApiSchema(bodySchema),
				},
			},
		});
		expect(operation?.responses["201"]?.content?.["application/json"]).toEqual({
			schema: toOpenApiSchema(responseSchema),
		});
	});

	test("registers hidden JSON and UI routes", async () => {
		const router = new Router();
		router
			.get("/health", () => Response.json({ status: "up" }))
			.openapi({
				tags: ["Health"],
				summary: "Health check",
			});
		registerOpenApiRoutes(router, { title: "Demo API", ui: "swagger" });

		const jsonMatch = router.match("GET", "/openapi.json");
		const docsMatch = router.match("GET", "/docs");
		const jsonResponse = await jsonMatch?.handler(
			createContext(new Request("http://localhost/openapi.json"), {
				params: jsonMatch.params,
			}),
		);
		const docsResponse = await docsMatch?.handler(
			createContext(request, { params: docsMatch.params }),
		);
		const document = (await jsonResponse?.json()) as
			| OpenApiDocument
			| undefined;
		const html = await docsResponse?.text();

		expect(document?.paths["/health"]).toBeDefined();
		expect(document?.paths["/docs"]).toBeUndefined();
		expect(document?.paths["/openapi.json"]).toBeUndefined();
		expect(docsResponse?.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(html).toContain("swagger-ui-dist");
	});
});

function schemaLike<T>(schema: SchemaLike<T>): SchemaLike<T> {
	return {
		parse: (value) => schema.parse(value),
		parseAsync: (value, context) => schema.parseAsync(value, context),
		describe: () => schema.describe(),
	};
}

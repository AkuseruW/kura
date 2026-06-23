import { describe, expect, test } from "bun:test";
import { guard } from "../auth/Guard";
import { SessionGuard } from "../auth/SessionGuard";
import { BaseException } from "../core/BaseException";
import { k } from "../validation/Schema";
import { BodyParser } from "./Middleware";
import { Router } from "./Router";
import {
	createTestClient,
	TestClient,
	type TestClientHandler,
} from "./TestClient";

describe("TestClient", () => {
	test("dispatches GET requests through a router and injects params", async () => {
		const router = new Router();
		router.get("/users/:id", (ctx) => {
			const url = new URL(ctx.request.url);
			return Response.json({
				id: ctx.param("id"),
				query: ctx.query("tab"),
				host: url.host,
			});
		});
		const client = createTestClient(router, {
			baseUrl: "https://kura.test",
		});

		const response = await client.get("/users/42", {
			query: { tab: "profile" },
		});

		expect(response.status).toBe(200);
		await expect(
			response.json<{ id: string; query: string; host: string }>(),
		).resolves.toEqual({
			id: "42",
			query: "profile",
			host: "kura.test",
		});
	});

	test("exposes ergonomic context helpers inside client requests", async () => {
		const router = new Router();
		router.get("/search/:scope", (ctx) =>
			Response.json({
				cookie: ctx.cookie("session"),
				header: ctx.header("x-tenant"),
				scope: ctx.param("scope"),
				tags: ctx.queries("tag"),
			}),
		);
		const client = createTestClient(router, {
			headers: { "x-tenant": "acme" },
		});

		const response = await client
			.withCookie("session", "abc123")
			.get("/search/users", {
				query: { tag: ["active", "admin"] },
			});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			cookie: "abc123",
			header: "acme",
			scope: "users",
			tags: ["active", "admin"],
		});
	});

	test("posts JSON bodies with the expected request content type", async () => {
		const handler: TestClientHandler = async (ctx) =>
			Response.json(
				{
					body: await ctx.request.json(),
					contentType: ctx.request.headers.get("content-type"),
				},
				{ status: 201 },
			);
		const client = new TestClient(handler);

		const response = await client.post("/users", {
			name: "Ada",
			active: true,
		});

		expect(response.status).toBe(201);
		await expect(
			response.json<{
				body: { name: string; active: boolean };
				contentType: string;
			}>(),
		).resolves.toEqual({
			body: { name: "Ada", active: true },
			contentType: "application/json",
		});
	});

	test("supports form posts through middleware parsing", async () => {
		const router = new Router();
		router
			.group()
			.middleware(BodyParser)
			.routes((routes) => {
				routes.post("/profile", (ctx) => Response.json(ctx.body));
			});
		const client = createTestClient(router);

		const response = await client.request("POST", "/profile", {
			form: { name: "Ada", roles: ["admin", "editor"] },
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			name: "Ada",
			roles: ["admin", "editor"],
		});
	});

	test("supports multipart uploads with route validation", async () => {
		const router = new Router();
		router
			.post("/uploads", async (ctx) => {
				const body = ctx.validatedBody<{
					avatar: File;
					photos: File[];
					title: string;
				}>();
				const avatar = await ctx.file("avatar");

				return Response.json({
					avatar: avatar?.clientName,
					photos: body?.photos.map((file) => file.name),
					title: body?.title,
				});
			})
			.schema({
				body: k.object({
					avatar: k.file().mimeTypes(["image/png"]),
					photos: k.files(),
					title: k.string(),
				}),
			});
		const client = createTestClient(router);
		const formData = new FormData();
		formData.append(
			"avatar",
			new File(["avatar"], "avatar.png", { type: "image/png" }),
		);
		formData.append(
			"photos",
			new File(["one"], "one.jpg", { type: "image/jpeg" }),
		);
		formData.append(
			"photos",
			new File(["two"], "two.jpg", { type: "image/jpeg" }),
		);
		formData.append("title", "Profile");

		const response = await client.request("POST", "/uploads", {
			body: formData,
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			avatar: "avatar.png",
			photos: ["one.jpg", "two.jpg"],
			title: "Profile",
		});
	});

	test("renders route validation errors as 422 responses", async () => {
		const router = new Router();
		router
			.post("/users", (ctx) => Response.json(ctx.validated?.body))
			.schema({
				body: k.object({ name: k.string() }),
			});
		const client = createTestClient(router);

		const response = await client.post("/users", { name: 42 });

		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "E_ROUTE_VALIDATION",
				details: {
					errors: [
						{
							message: "Validation failed for object",
							source: "body",
						},
					],
					message: "Validation failed for object",
					source: "body",
				},
				message:
					"Validation failed for request body: Validation failed for object",
				status: 422,
			},
		});
	});

	test("loginAs attaches auth context and a session cookie", async () => {
		const router = new Router();
		router.get("/me", (ctx) =>
			Response.json({
				auth: ctx.auth,
				cookie: ctx.request.headers.get("cookie"),
			}),
		);
		const client = createTestClient(router);

		client.loginAs(
			{ id: 7, email: "dev@kura.dev" },
			{
				guard: "web",
				sessionId: "session-7",
			},
		);
		const response = await client.get("/me");

		expect(response.status).toBe(200);
		await expect(
			response.json<{
				auth: {
					guard: string;
					user: { id: number; email: string };
					sessionId: string;
				};
				cookie: string;
			}>(),
		).resolves.toEqual({
			auth: {
				guard: "web",
				user: { id: 7, email: "dev@kura.dev" },
				sessionId: "session-7",
			},
			cookie: "kura_session=session-7",
		});
	});

	test("sends session cookies that guards can resolve", async () => {
		const router = new Router();
		router
			.group()
			.middleware(
				guard(
					new SessionGuard({
						resolve: (sessionId) => ({
							guard: "session",
							sessionId,
							user: { id: sessionId },
						}),
					}),
				),
			)
			.routes((routes) => {
				routes.get("/session", (ctx) => Response.json(ctx.auth));
			});
		const client = createTestClient(router).withSession("session-1");

		const response = await client.get("/session");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			guard: "session",
			sessionId: "session-1",
			user: { id: "session-1" },
		});
	});

	test("stores response cookies and sends them on later requests", async () => {
		const router = new Router();
		router.get(
			"/set-cookie",
			() =>
				new Response("stored", {
					headers: { "Set-Cookie": "theme=dark; Path=/" },
				}),
		);
		router.get(
			"/read-cookie",
			(ctx) => new Response(ctx.request.headers.get("cookie") ?? ""),
		);
		const client = createTestClient(router);

		const setResponse = await client.get("/set-cookie");
		const readResponse = await client.get("/read-cookie");

		expect(setResponse.cookie("theme")).toBe("dark");
		expect(client.cookie("theme")).toBe("dark");
		expect(await readResponse.text()).toBe("theme=dark");
	});

	test("renders framework exceptions like the server pipeline", async () => {
		const client = createTestClient(() => {
			throw new BaseException("Forbidden", "E_FORBIDDEN", 403);
		});

		const response = await client.get("/admin");

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "E_FORBIDDEN",
				message: "Forbidden",
				status: 403,
			},
		});
	});

	test("uses configured error handlers like the server pipeline", async () => {
		const client = createTestClient(
			() => {
				throw new Error("not exposed");
			},
			{
				errorHandler: {
					render: (_error, normalized) =>
						Response.json(
							{ handled: true, status: normalized.status },
							{ status: normalized.status },
						),
				},
			},
		);

		const response = await client.get("/fail");

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			handled: true,
			status: 500,
		});
	});

	test("returns 404 when no route matches", async () => {
		const client = createTestClient(new Router());

		const response = await client.get("/missing");

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "E_NOT_FOUND",
				message: "Not Found",
				status: 404,
			},
		});
	});

	test("asserts response status, headers, cookies, redirects, and JSON bodies", async () => {
		const router = new Router();
		router.get("/users", () =>
			Response.json(
				{ users: [{ id: 1, email: "dev@kura.dev" }] },
				{ headers: { "X-Total": "1" } },
			),
		);
		router.get(
			"/login",
			() =>
				new Response(null, {
					status: 302,
					headers: {
						Location: "/dashboard",
						"Set-Cookie": "session=abc123; Path=/",
					},
				}),
		);
		router
			.post("/users", () => Response.json({ ok: true }))
			.schema({
				body: k.object({ name: k.string() }),
			});
		const client = createTestClient(router);

		const usersResponse = await client.get("/users");
		const redirectResponse = await client.get("/login");
		const validationResponse = await client.post("/users", { name: 42 });

		usersResponse.assertStatus(200).assertHeader("X-Total", "1");
		await usersResponse.assertJsonPath("users.0.email", "dev@kura.dev");
		await usersResponse.assertJson({
			users: [{ id: 1, email: "dev@kura.dev" }],
		});
		redirectResponse
			.assertStatus(302)
			.assertCookie("session", "abc123")
			.assertRedirect("/dashboard");
		await validationResponse.assertValidationErrors(["body"]);
	});

	test("throws readable errors when assertions fail", async () => {
		const response = new TestClient(() =>
			Response.json(
				{ ok: true },
				{ status: 200, headers: { "X-Mode": "test" } },
			),
		);
		const result = await response.get("/status");

		expect(() => result.assertStatus(201)).toThrow(
			"Expected response status 201, received 200",
		);
		expect(() => result.assertHeader("X-Mode", "prod")).toThrow(
			"Expected response header [X-Mode] to be [prod], received [test]",
		);
		expect(() => result.assertCookie("session")).toThrow(
			"Expected response cookie [session] to be set",
		);
		expect(() => result.assertRedirect("/home")).toThrow(
			"Expected response to be a redirect, received status 200",
		);
		await expect(result.assertJson({ ok: false })).rejects.toThrow(
			"Expected response JSON to match",
		);
		await expect(result.assertJsonPath("ok", false)).rejects.toThrow(
			"Expected response JSON path [ok] to match",
		);
	});
});

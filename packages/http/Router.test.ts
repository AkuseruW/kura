import { describe, expect, test } from "bun:test";
import { v } from "../validation/Schema";
import { createContext } from "./Context";
import { BaseController, registerController } from "./Controller";
import { BadRequestException } from "./ErrorHandler";
import { BodyParser } from "./Middleware";
import { Router, RouteValidationException } from "./Router";
import type { Context } from "./Server";

const request = new Request("http://localhost/users/1");

describe("Router", () => {
	test("matches params for registered routes", async () => {
		const router = new Router();
		router.get("/users/:id", (ctx) => Response.json({ id: ctx.params?.id }));

		const match = router.match("GET", "/users/123");

		const response = await match?.handler(
			createContext(request, { params: match.params }),
		);

		expect(match?.params).toEqual({ id: "123" });
		expect(await response?.json()).toEqual({ id: "123" });
	});

	test("escapes regex characters in literal paths", () => {
		const router = new Router();
		router.get("/files/report.json", () => new Response("ok"));

		expect(router.match("GET", "/files/report.json")).not.toBeNull();
		expect(router.match("GET", "/files/reportxjson")).toBeNull();
	});

	test("matches exact routes before parameter routes", async () => {
		const router = new Router();
		router.get("/users/:id", (ctx) => new Response(ctx.params?.id));
		router.get("/users/new", () => new Response("new"));

		const match = router.match("GET", "/users/new");
		const response = await match?.handler(
			createContext(request, { params: match.params }),
		);

		expect(await response?.text()).toBe("new");
	});

	test("preserves dynamic route registration order within matching segments", async () => {
		const router = new Router();
		router.get("/:scope/settings", (ctx) => new Response(ctx.param("scope")));
		router.get("/users/:id", (ctx) => new Response(ctx.param("id")));

		const match = router.match("GET", "/users/settings");
		const response = await match?.handler(
			createContext(request, { params: match.params }),
		);

		expect(match?.params).toEqual({ scope: "users" });
		expect(await response?.text()).toBe("users");
	});

	test("keeps exact routes ahead of dynamic routes regardless of order", () => {
		const router = new Router();
		router.get("/:scope/settings", () => new Response("dynamic"));
		router.get("/users/settings", () => new Response("exact"));

		expect(router.match("GET", "/users/settings")?.params).toEqual({});
	});

	test("does not match dynamic routes with different segment counts", () => {
		const router = new Router();
		router.get("/users/:id/settings", () => new Response("ok"));

		expect(router.match("GET", "/users/1")).toBeNull();
		expect(router.match("GET", "/users/1/settings")).not.toBeNull();
	});

	test("builds named routes and fails when params are missing", () => {
		const router = new Router();
		router.get("/users/:id", () => new Response()).as("users.show");

		expect(router.route("users.show", { id: 1 })).toBe("/users/1");
		expect(router.list()).toEqual([
			{
				method: "GET",
				name: "users.show",
				params: ["id"],
				path: "/users/:id",
			},
		]);
		expect(() => router.route("users.show")).toThrow(
			"Missing route parameter [id] for route [users.show]",
		);
	});

	test("normalizes route group prefixes", () => {
		const router = new Router();

		router
			.group()
			.prefix("admin/")
			.as("admin.")
			.routes((routes) => {
				routes.get("users", () => new Response("ok")).as("users.index");
			});

		expect(router.match("GET", "/admin/users")).not.toBeNull();
		expect(router.route("admin.users.index")).toBe("/admin/users");
	});

	test("registers resource routes from handler objects", () => {
		const router = new Router();

		router
			.resource("users", {
				index: () => new Response("index"),
				show: (ctx) => new Response(ctx.params?.id),
			})
			.register();

		expect(router.match("GET", "/users")).not.toBeNull();
		expect(router.match("GET", "/users/123")?.params).toEqual({ id: "123" });
	});

	test("registers resource routes from controller names", async () => {
		class UsersController extends BaseController {
			index() {
				return new Response("index");
			}

			show(ctx: Context) {
				return new Response(ctx.params?.id);
			}
		}
		registerController("UsersController", UsersController);
		const router = new Router();

		router
			.resource("users", "UsersController")
			.only(["index", "show"])
			.register();

		const index = router.match("GET", "/users");
		const show = router.match("GET", "/users/123");
		const indexResponse = await index?.handler(createContext(request));
		const showResponse = await show?.handler(
			createContext(request, { params: show.params }),
		);

		expect(await indexResponse?.text()).toBe("index");
		expect(await showResponse?.text()).toBe("123");
	});

	test("dispatch exposes ergonomic context helpers", async () => {
		const router = new Router();
		router.get("/users/:id", (ctx) => {
			ctx.setState("visited", true);

			return Response.json({
				cookie: ctx.cookie("session"),
				header: ctx.header("x-tenant"),
				missing: ctx.query("missing"),
				param: ctx.param("id"),
				params: ctx.param(),
				query: ctx.query(),
				state: ctx.getState("visited"),
				tab: ctx.query("tab"),
				tags: ctx.queries("tag"),
			});
		});

		const response = await router.dispatch({
			request: new Request(
				"http://localhost/users/123?tab=profile&tag=a&tag=b",
				{
					headers: {
						cookie: "session=abc123",
						"x-tenant": "acme",
					},
				},
			),
		});

		expect(await response.json()).toEqual({
			cookie: "abc123",
			header: "acme",
			missing: null,
			param: "123",
			params: { id: "123" },
			query: { tab: "profile", tag: ["a", "b"] },
			state: true,
			tab: "profile",
			tags: ["a", "b"],
		});
	});

	test("validates route schemas and exposes validated data", async () => {
		const router = new Router();
		router
			.post("/users/:id", (ctx) =>
				Response.json({
					body: ctx.validatedBody(),
					cookies: ctx.validatedCookies(),
					headers: ctx.validatedHeaders(),
					params: ctx.validatedParams(),
					query: ctx.validatedQuery(),
				}),
			)
			.schema({
				params: v.object({ id: v.string() }),
				query: v.object({ tab: v.string().optional() }),
				headers: v.object({ "x-tenant": v.string() }),
				cookies: v.object({ session: v.string() }),
				body: v.object({ name: v.string() }),
			});

		const response = await router.dispatch({
			request: new Request("http://localhost/users/123?tab=profile", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					cookie: "session=abc123",
					"x-tenant": "acme",
				},
				body: JSON.stringify({ name: "Ada" }),
			}),
		});

		expect(await response.json()).toEqual({
			params: { id: "123" },
			query: { tab: "profile" },
			headers: {
				"content-type": "application/json",
				cookie: "session=abc123",
				"x-tenant": "acme",
			},
			cookies: { session: "abc123" },
			body: { name: "Ada" },
		});
	});

	test("rejects invalid route schemas before handlers run", async () => {
		const router = new Router();
		let called = false;
		router
			.post("/users", () => {
				called = true;
				return Response.json({ ok: true });
			})
			.schema({
				body: v.object({ name: v.string() }),
			});

		await expect(
			router.dispatch({
				request: new Request("http://localhost/users", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: 42 }),
				}),
			}),
		).rejects.toThrow(RouteValidationException);
		expect(called).toBe(false);
	});

	test("rejects malformed JSON bodies before schema validation", async () => {
		const router = new Router();
		let called = false;
		router
			.post("/users", () => {
				called = true;
				return Response.json({ ok: true });
			})
			.schema({
				body: v.object({ name: v.string() }),
			});

		await expect(
			router.dispatch({
				request: new Request("http://localhost/users", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{",
				}),
			}),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(called).toBe(false);
	});

	test("does not parse body-less routes before handlers run", async () => {
		const router = new Router();
		router.post("/events", () => new Response("accepted"));

		const response = await router.dispatch({
			request: new Request("http://localhost/events", {
				body: "{",
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("accepted");
	});

	test("does not parse bodies for unmatched routes", async () => {
		const router = new Router();

		const response = await router.dispatch({
			request: new Request("http://localhost/missing", {
				body: "{",
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		});

		expect(response.status).toBe(404);
	});

	test("reuses bodies parsed by explicit BodyParser middleware", async () => {
		const router = new Router();
		router
			.group()
			.middleware(BodyParser)
			.routes((routes) => {
				routes
					.post("/users", (ctx) => Response.json(ctx.validatedBody()))
					.schema({
						body: v.object({ name: v.string() }),
					});
			});

		const response = await router.dispatch({
			request: new Request("http://localhost/users", {
				body: JSON.stringify({ name: "Ada" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		});

		expect(await response.json()).toEqual({ name: "Ada" });
	});
});

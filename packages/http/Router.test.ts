import { describe, expect, test } from "bun:test";
import { BaseController, registerController } from "./Controller";
import { Router } from "./Router";
import type { Context } from "./Server";

const request = new Request("http://localhost/users/1");

describe("Router", () => {
	test("matches params for registered routes", async () => {
		const router = new Router();
		router.get("/users/:id", (ctx) => Response.json({ id: ctx.params?.id }));

		const match = router.match("GET", "/users/123");

		const response = await match?.handler({ request, params: match.params });

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
		const response = await match?.handler({ request, params: match.params });

		expect(await response?.text()).toBe("new");
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
		const indexResponse = await index?.handler({ request });
		const showResponse = await show?.handler({ request, params: show.params });

		expect(await indexResponse?.text()).toBe("index");
		expect(await showResponse?.text()).toBe("123");
	});
});

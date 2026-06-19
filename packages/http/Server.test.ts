import { describe, expect, test } from "bun:test";
import { BaseException } from "../core/BaseException";
import { createContext } from "./Context";
import { Router } from "./Router";
import type { Context } from "./Server";
import { Server } from "./Server";

describe("Server", () => {
	test("dispatches requests through a configured router", async () => {
		const router = new Router();
		router.get("/users/:id", (ctx) => new Response(ctx.params?.id));
		const server = new Server({ port: 0 });
		server.setRouter(router);

		const handler = (
			server as unknown as {
				handler: (ctx: Context) => Promise<Response> | Response;
			}
		).handler;
		const response = await handler(
			createContext(
				new Request("http://localhost/users/123", { method: "GET" }),
			),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("123");
	});

	test("returns 404 when no route matches", async () => {
		const server = new Server({ port: 0 });
		server.setRouter(new Router());

		const handler = (
			server as unknown as {
				handler: (ctx: Context) => Promise<Response> | Response;
			}
		).handler;
		const response = await handler(
			createContext(new Request("http://localhost/missing", { method: "GET" })),
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: {
				code: "E_NOT_FOUND",
				message: "Not Found",
				status: 404,
			},
		});
	});

	test("serves Bun static routes before the Kura fetch handler", async () => {
		const server = new Server({
			port: 0,
			staticRoutes: {
				"/": new Response("html route"),
			},
			development: false,
		});
		server.setHandler((ctx) => {
			const url = new URL(ctx.request.url);
			return new Response(`handler:${url.pathname}`);
		});
		server.start();
		const instance = (
			server as unknown as {
				server: ReturnType<typeof Bun.serve>;
			}
		).server;

		try {
			const staticResponse = await fetch(instance.url);
			const handlerResponse = await fetch(new URL("/api", instance.url));

			expect(await staticResponse.text()).toBe("html route");
			expect(await handlerResponse.text()).toBe("handler:/api");
		} finally {
			server.stop();
		}
	});

	test("renders base exceptions from the fetch pipeline", async () => {
		const server = new Server({ port: 0 });
		server.setHandler(() => {
			throw new BaseException("Policy denied", "E_POLICY_DENIED", 403);
		});
		server.start();
		const instance = (
			server as unknown as {
				server: ReturnType<typeof Bun.serve>;
			}
		).server;

		try {
			const response = await fetch(instance.url);

			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({
				error: {
					code: "E_POLICY_DENIED",
					message: "Policy denied",
					status: 403,
				},
			});
		} finally {
			server.stop();
		}
	});
});

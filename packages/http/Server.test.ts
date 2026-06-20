import { describe, expect, test } from "bun:test";
import { BaseException } from "../core/BaseException";
import { createContext } from "./Context";
import { InternalServerErrorException } from "./ErrorHandler";
import { BodyLimit, MiddlewarePipeline, RequestTimeout } from "./Middleware";
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

	test("uses a configured error handler from the fetch pipeline", async () => {
		const server = new Server({
			port: 0,
			errorHandler: {
				render: (_error, normalized) =>
					Response.json(
						{
							code: normalized.code,
							message: normalized.message,
						},
						{ status: normalized.status },
					),
			},
		});
		server.setHandler(() => {
			throw new InternalServerErrorException("Database failed", {
				code: "E_DATABASE_FAILED",
				expose: true,
			});
		});
		server.start();
		const instance = (
			server as unknown as {
				server: ReturnType<typeof Bun.serve>;
			}
		).server;

		try {
			const response = await fetch(instance.url);

			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({
				code: "E_DATABASE_FAILED",
				message: "Database failed",
			});
		} finally {
			server.stop();
		}
	});

	test("renders body limit exceptions from the fetch pipeline", async () => {
		let handlerCalled = false;
		const server = new Server({ port: 0 });
		server.setHandler(
			new MiddlewarePipeline().use(BodyLimit({ maxBytes: 4 })).toHandler(() => {
				handlerCalled = true;
				return new Response("ok");
			}),
		);
		server.start();
		const instance = (
			server as unknown as {
				server: ReturnType<typeof Bun.serve>;
			}
		).server;

		try {
			const response = await fetch(instance.url, {
				body: "too-large",
				headers: { "content-length": "9" },
				method: "POST",
			});

			expect(handlerCalled).toBe(false);
			expect(response.status).toBe(413);
			expect(await response.json()).toEqual({
				error: {
					code: "E_REQUEST_BODY_TOO_LARGE",
					message: "Request body exceeds the configured limit of 4 bytes",
					status: 413,
				},
			});
		} finally {
			server.stop();
		}
	});

	test("renders request timeout exceptions from the fetch pipeline", async () => {
		const server = new Server({ port: 0 });
		server.setHandler(
			new MiddlewarePipeline()
				.use(RequestTimeout({ ms: 5 }))
				.toHandler(async () => {
					await sleep(30);
					return new Response("late");
				}),
		);
		server.start();
		const instance = (
			server as unknown as {
				server: ReturnType<typeof Bun.serve>;
			}
		).server;

		try {
			const response = await fetch(instance.url);

			expect(response.status).toBe(408);
			expect(await response.json()).toEqual({
				error: {
					code: "E_REQUEST_TIMEOUT",
					message: "Request exceeded the configured timeout of 5ms",
					status: 408,
				},
			});
		} finally {
			server.stop();
		}
	});
});

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

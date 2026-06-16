import { describe, expect, test } from "bun:test";
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
		const response = await handler({
			request: new Request("http://localhost/users/123", { method: "GET" }),
		});

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
		const response = await handler({
			request: new Request("http://localhost/missing", { method: "GET" }),
		});

		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not Found");
	});
});

import { describe, expect, test } from "bun:test";
import { BodyParser, Cors, MiddlewarePipeline, RequestId } from "./Middleware";
import type { Context } from "./Server";

describe("MiddlewarePipeline", () => {
	test("runs middlewares in order", async () => {
		const calls: string[] = [];
		const pipeline = new MiddlewarePipeline()
			.use(async (_ctx, next) => {
				calls.push("before-a");
				const response = await next();
				calls.push("after-a");
				return response;
			})
			.use(async (_ctx, next) => {
				calls.push("before-b");
				const response = await next();
				calls.push("after-b");
				return response;
			});

		await pipeline.run(
			{ request: new Request("http://localhost") },
			async () => {
				calls.push("handler");
				return new Response("ok");
			},
		);

		expect(calls).toEqual([
			"before-a",
			"before-b",
			"handler",
			"after-b",
			"after-a",
		]);
	});
});

describe("BodyParser", () => {
	test("parses JSON bodies", async () => {
		const ctx: Context = {
			request: new Request("http://localhost", {
				body: JSON.stringify({ name: "Kura" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		};

		await BodyParser(ctx, async () => new Response("ok"));

		expect(ctx.body).toEqual({ name: "Kura" });
	});

	test("parses urlencoded bodies", async () => {
		const ctx: Context = {
			request: new Request("http://localhost", {
				body: "name=Kura&debug=true",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
			}),
		};

		await BodyParser(ctx, async () => new Response("ok"));

		expect(ctx.body).toEqual({ debug: "true", name: "Kura" });
	});

	test("parses multipart bodies and exposes formData", async () => {
		const formData = new FormData();
		formData.set("name", "Kura");
		const ctx: Context = {
			request: new Request("http://localhost", {
				body: formData,
				method: "POST",
			}),
		};

		await BodyParser(ctx, async () => new Response("ok"));

		expect(ctx.formData?.get("name")).toBe("Kura");
		expect(ctx.body).toEqual({ name: "Kura" });
	});
});

describe("built-in middlewares", () => {
	test("adds CORS headers", async () => {
		const response = await Cors({ origin: "https://example.com" })(
			{ request: new Request("http://localhost") },
			async () => new Response("ok"),
		);

		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://example.com",
		);
		expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
			"GET, POST, PUT, PATCH, DELETE",
		);
	});

	test("adds a request id to the context and response", async () => {
		const ctx: Context = { request: new Request("http://localhost") };
		const response = await RequestId(ctx, async () => new Response("ok"));

		expect(ctx.requestId).toBeDefined();
		expect(response.headers.get("X-Request-Id")).toBe(ctx.requestId ?? null);
	});
});

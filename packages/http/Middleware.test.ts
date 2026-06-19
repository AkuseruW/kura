import { describe, expect, test } from "bun:test";
import { createContext } from "./Context";
import { BodyParser, Cors, MiddlewarePipeline, RequestId } from "./Middleware";
import { Router } from "./Router";
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
			createContext(new Request("http://localhost")),
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

	test("composes middlewares into a reusable handler", async () => {
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

		const handler = pipeline.toHandler(() => {
			calls.push("handler");
			return new Response("ok");
		});

		await handler(createContext(new Request("http://localhost")));

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
		const ctx: Context = createContext(
			new Request("http://localhost", {
				body: JSON.stringify({ name: "Kura" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		await BodyParser(ctx, async () => new Response("ok"));

		expect(ctx.body).toEqual({ name: "Kura" });
	});

	test("parses urlencoded bodies", async () => {
		const ctx: Context = createContext(
			new Request("http://localhost", {
				body: "name=Kura&debug=true",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
			}),
		);

		await BodyParser(ctx, async () => new Response("ok"));

		expect(ctx.body).toEqual({ debug: "true", name: "Kura" });
	});

	test("parses multipart bodies and exposes formData", async () => {
		const formData = new FormData();
		formData.set("name", "Kura");
		const ctx: Context = createContext(
			new Request("http://localhost", {
				body: formData,
				method: "POST",
			}),
		);

		await BodyParser(ctx, async () => new Response("ok"));

		expect(ctx.formData?.get("name")).toBe("Kura");
		expect(ctx.body).toEqual({ name: "Kura" });
	});
});

describe("built-in middlewares", () => {
	test("adds CORS headers", async () => {
		const response = await Cors({ origin: "https://example.com" })(
			createContext(new Request("http://localhost")),
			async () => new Response("ok"),
		);

		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://example.com",
		);
		expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
			"GET, POST, PUT, PATCH, DELETE",
		);
	});

	test("returns allowed preflight responses before handlers run", async () => {
		let handlerCalled = false;
		const response = await Cors({
			headers: ["Content-Type", "Authorization", "X-Trace-Id"],
			maxAge: 600,
			origin: "https://app.example.com",
		})(
			createContext(
				new Request("http://localhost/missing", {
					headers: {
						"Access-Control-Request-Headers": "X-Trace-Id",
						"Access-Control-Request-Method": "POST",
						Origin: "https://app.example.com",
					},
					method: "OPTIONS",
				}),
			),
			async () => {
				handlerCalled = true;
				return new Response("missing", { status: 404 });
			},
		);

		expect(handlerCalled).toBe(false);
		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example.com",
		);
		expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
			"Content-Type, Authorization, X-Trace-Id",
		);
		expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
		expect(response.headers.get("Vary")).toBe("Origin");
	});

	test("returns predictable denied preflight responses", async () => {
		let handlerCalled = false;
		const response = await Cors({
			origin: ["https://app.example.com"],
		})(
			createContext(
				new Request("http://localhost/users", {
					headers: {
						"Access-Control-Request-Method": "POST",
						Origin: "https://evil.example.com",
					},
					method: "OPTIONS",
				}),
			),
			async () => {
				handlerCalled = true;
				return new Response("ok");
			},
		);

		expect(handlerCalled).toBe(false);
		expect(response.status).toBe(403);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	test("keeps normal OPTIONS routes for non-preflight requests", async () => {
		let handlerCalled = false;
		const response = await Cors({ origin: "https://app.example.com" })(
			createContext(
				new Request("http://localhost/options", {
					headers: { Origin: "https://app.example.com" },
					method: "OPTIONS",
				}),
			),
			async () => {
				handlerCalled = true;
				return new Response("options route");
			},
		);

		expect(handlerCalled).toBe(true);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("options route");
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example.com",
		);
	});

	test("handles generated app preflights before API route dispatch", async () => {
		let routeCalled = false;
		const router = new Router();
		router.post("/api/users", () => {
			routeCalled = true;
			return Response.json({ ok: true });
		});
		const handler = new MiddlewarePipeline()
			.use(RequestId)
			.use(Cors())
			.use(BodyParser)
			.toHandler((ctx) => router.dispatch(ctx));

		const response = await handler(
			createContext(
				new Request("http://localhost/api/users", {
					headers: {
						"Access-Control-Request-Method": "POST",
						Origin: "https://app.example.com",
					},
					method: "OPTIONS",
				}),
			),
		);

		expect(routeCalled).toBe(false);
		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(response.headers.get("X-Request-Id")).toBeDefined();
	});

	test("adds a request id to the context and response", async () => {
		const ctx: Context = createContext(new Request("http://localhost"));
		const response = await RequestId(ctx, async () => new Response("ok"));

		expect(ctx.requestId).toBeDefined();
		expect(response.headers.get("X-Request-Id")).toBe(ctx.requestId ?? null);
	});
});

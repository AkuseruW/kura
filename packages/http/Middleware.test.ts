import { describe, expect, test } from "bun:test";
import { createContext } from "./Context";
import { BadRequestException } from "./ErrorHandler";
import {
	BodyLimit,
	BodyParser,
	Cors,
	CsrfProtection,
	MiddlewarePipeline,
	RequestBodyLimitException,
	RequestId,
	RequestTimeout,
	RequestTimeoutException,
} from "./Middleware";
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

	test("rejects middleware that calls next more than once", async () => {
		const handler = new MiddlewarePipeline()
			.use(async (_ctx, next) => {
				await next();
				return next();
			})
			.toHandler(() => new Response("ok"));

		await expect(
			handler(createContext(new Request("http://localhost"))),
		).rejects.toThrow("next() called multiple times");
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
		expect(ctx.bodyType).toBe("json");
		expect(ctx.raw()).toBe(JSON.stringify({ name: "Kura" }));
	});

	test("rejects invalid JSON bodies as bad requests", async () => {
		const ctx: Context = createContext(
			new Request("http://localhost", {
				body: "{",
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		await expect(
			BodyParser(ctx, async () => new Response("ok")),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	test("parses JSON vendor content types", async () => {
		const ctx: Context = createContext(
			new Request("http://localhost", {
				body: JSON.stringify({ name: "Kura" }),
				headers: { "content-type": "application/vnd.api+json" },
				method: "POST",
			}),
		);

		await BodyParser(ctx, async () => new Response("ok"));

		expect(ctx.body).toEqual({ name: "Kura" });
		expect(ctx.bodyType).toBe("json");
	});

	test("parses urlencoded bodies", async () => {
		const ctx: Context = createContext(
			new Request("http://localhost", {
				body: "name=Kura&debug=true&tag=http&tag=dx",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
			}),
		);

		await BodyParser(ctx, async () => new Response("ok"));

		expect(ctx.body).toEqual({
			debug: "true",
			name: "Kura",
			tag: ["http", "dx"],
		});
		expect(ctx.bodyType).toBe("urlencoded");
		expect(ctx.raw()).toBe("name=Kura&debug=true&tag=http&tag=dx");
		expect(ctx.formData?.get("name")).toBe("Kura");
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

		expect(ctx.bodyType).toBe("multipart");
		expect(ctx.formData?.get("name")).toBe("Kura");
		expect(ctx.body).toEqual({ name: "Kura" });
	});

	test("leaves text bodies available for handlers", async () => {
		const ctx: Context = createContext(
			new Request("http://localhost", {
				body: "hello",
				headers: { "content-type": "text/plain" },
				method: "POST",
			}),
		);

		const response = await BodyParser(ctx, async () => {
			return new Response(await ctx.request.text());
		});

		expect(ctx.body).toBeUndefined();
		expect(ctx.bodyType).toBe("text");
		expect(ctx.raw()).toBeNull();
		expect(await response.text()).toBe("hello");
	});
});

describe("built-in middlewares", () => {
	test("rejects oversized content length before handlers run", async () => {
		let handlerCalled = false;
		const handler = new MiddlewarePipeline()
			.use(BodyLimit({ maxBytes: 2 }))
			.toHandler(() => {
				handlerCalled = true;
				return new Response("ok");
			});

		await expect(
			handler(
				createContext(
					new Request("http://localhost", {
						body: "abc",
						headers: { "content-length": "3" },
						method: "POST",
					}),
				),
			),
		).rejects.toBeInstanceOf(RequestBodyLimitException);
		expect(handlerCalled).toBe(false);
	});

	test("limits JSON bodies lazily while parsing", async () => {
		const handler = new MiddlewarePipeline()
			.use(BodyLimit({ maxBytes: 8 }))
			.use(BodyParser)
			.toHandler((ctx) => Response.json(ctx.body));

		await expect(
			handler(
				createContext(
					new Request("http://localhost", {
						body: JSON.stringify({ name: "Kura" }),
						headers: { "content-type": "application/json" },
						method: "POST",
					}),
				),
			),
		).rejects.toBeInstanceOf(RequestBodyLimitException);
	});

	test("limits urlencoded bodies lazily while parsing", async () => {
		const handler = new MiddlewarePipeline()
			.use(BodyLimit({ maxBytes: 6 }))
			.use(BodyParser)
			.toHandler((ctx) => Response.json(ctx.body));

		await expect(
			handler(
				createContext(
					new Request("http://localhost", {
						body: "name=Kura",
						headers: { "content-type": "application/x-www-form-urlencoded" },
						method: "POST",
					}),
				),
			),
		).rejects.toBeInstanceOf(RequestBodyLimitException);
	});

	test("limits multipart bodies lazily while parsing", async () => {
		const formData = new FormData();
		formData.set("name", "Kura");
		const handler = new MiddlewarePipeline()
			.use(BodyLimit({ maxBytes: 4 }))
			.use(BodyParser)
			.toHandler((ctx) => Response.json(ctx.body));

		await expect(
			handler(
				createContext(
					new Request("http://localhost", {
						body: formData,
						method: "POST",
					}),
				),
			),
		).rejects.toBeInstanceOf(RequestBodyLimitException);
	});

	test("allows body-less requests through body limits", async () => {
		const handler = new MiddlewarePipeline()
			.use(BodyLimit({ maxBytes: 1 }))
			.toHandler(() => new Response("ok"));

		const response = await handler(
			createContext(new Request("http://localhost", { method: "GET" })),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
	});

	test("times out slow middleware chains", async () => {
		let timeoutSignal: AbortSignal | undefined;
		const handler = new MiddlewarePipeline()
			.use(RequestTimeout({ ms: 5 }))
			.toHandler(async (ctx) => {
				timeoutSignal = ctx.timeoutSignal;
				await sleep(30);
				return new Response("late");
			});

		await expect(
			handler(createContext(new Request("http://localhost"))),
		).rejects.toBeInstanceOf(RequestTimeoutException);
		expect(timeoutSignal?.aborted).toBe(true);
	});

	test("allows fast middleware chains through request timeouts", async () => {
		const handler = new MiddlewarePipeline()
			.use(RequestTimeout({ ms: 50 }))
			.toHandler(() => new Response("ok"));

		const response = await handler(
			createContext(new Request("http://localhost")),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
	});
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

	test("adds credentialed CORS headers for explicit origins", async () => {
		const response = await Cors({
			allowedHeaders: ["Content-Type", "X-Trace-Id"],
			credentials: true,
			exposedHeaders: ["X-Request-Id"],
			origin: "https://app.example.com",
		})(
			createContext(
				new Request("http://localhost", {
					headers: { Origin: "https://app.example.com" },
				}),
			),
			async () => new Response("ok"),
		);

		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example.com",
		);
		expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
			"true",
		);
		expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
			"Content-Type, X-Trace-Id",
		);
		expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
			"X-Request-Id",
		);
		expect(response.headers.get("Vary")).toBe("Origin");
	});

	test("rejects credentialed wildcard CORS by default", () => {
		expect(() => Cors({ credentials: true })).toThrow(
			"CORS credentials cannot be used with wildcard origins",
		);
		expect(() =>
			Cors({ credentials: true, origin: ["https://app.example.com", "*"] }),
		).toThrow("CORS credentials cannot be used with wildcard origins");
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

	test("sets a CSRF cookie for safe requests", async () => {
		const ctx = createContext(new Request("http://localhost/form"));
		const response = await CsrfProtection()(
			ctx,
			async () => new Response("ok"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Set-Cookie")).toContain("kura-csrf-token=");
		expect(response.headers.get("Set-Cookie")).toContain("SameSite=Lax");
		expect(response.headers.get("Set-Cookie")).not.toContain("HttpOnly");
		expect(ctx.getState<string>("csrfToken")).toBeDefined();
	});

	test("accepts matching CSRF header tokens", async () => {
		const token = "token-1";
		const response = await CsrfProtection()(
			createContext(
				new Request("http://localhost/profile", {
					headers: {
						cookie: `kura-csrf-token=${token}`,
						"x-csrf-token": token,
					},
					method: "POST",
				}),
			),
			async () => Response.json({ ok: true }),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	test("accepts matching CSRF form tokens after body parsing", async () => {
		const token = "token-2";
		const handler = new MiddlewarePipeline()
			.use(BodyParser)
			.use(CsrfProtection())
			.toHandler(() => Response.json({ ok: true }));
		const response = await handler(
			createContext(
				new Request("http://localhost/profile", {
					body: `_csrf=${token}`,
					headers: {
						"content-type": "application/x-www-form-urlencoded",
						cookie: `kura-csrf-token=${token}`,
					},
					method: "POST",
				}),
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	test("rejects missing or mismatched CSRF tokens", async () => {
		const middleware = CsrfProtection();

		await expect(
			middleware(
				createContext(
					new Request("http://localhost/profile", { method: "POST" }),
				),
				async () => new Response("ok"),
			),
		).rejects.toThrow("Invalid CSRF token");

		await expect(
			middleware(
				createContext(
					new Request("http://localhost/profile", {
						headers: {
							cookie: "kura-csrf-token=token",
							"x-csrf-token": "other",
						},
						method: "POST",
					}),
				),
				async () => new Response("ok"),
			),
		).rejects.toThrow("Invalid CSRF token");
	});

	test("skips CSRF protection for configured route exceptions", async () => {
		const response = await CsrfProtection({
			except: ["/auth/login"],
		})(
			createContext(
				new Request("http://localhost/auth/login", { method: "POST" }),
			),
			async () => new Response("ok"),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

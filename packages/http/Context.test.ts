import { describe, expect, test } from "bun:test";
import { createContext, ensureContext } from "./Context";

describe("Context helpers", () => {
	test("reads params, query strings, headers, cookies, and body values", () => {
		const ctx = createContext(
			new Request("http://localhost/users/42?tab=profile&tag=a&tag=b", {
				headers: {
					cookie: "session=abc123; theme=dark%20mode",
					"x-tenant": "acme",
				},
			}),
			{
				body: { name: "Ada" },
				params: { id: "42" },
			},
		);

		expect(ctx.param("id")).toBe("42");
		expect(ctx.param("missing")).toBeNull();
		expect(ctx.param("missing", "fallback")).toBe("fallback");
		expect(ctx.param()).toEqual({ id: "42" });
		expect(ctx.query("tab")).toBe("profile");
		expect(ctx.query("missing")).toBeNull();
		expect(ctx.query("missing", "fallback")).toBe("fallback");
		expect(ctx.query()).toEqual({ tab: "profile", tag: ["a", "b"] });
		expect(ctx.queries("tag")).toEqual(["a", "b"]);
		expect(ctx.queries()).toEqual({ tab: ["profile"], tag: ["a", "b"] });
		expect(ctx.header("x-tenant")).toBe("acme");
		expect(ctx.header("missing", "fallback")).toBe("fallback");
		expect(ctx.header()).toMatchObject({ "x-tenant": "acme" });
		expect(ctx.cookie("session")).toBe("abc123");
		expect(ctx.cookie("theme")).toBe("dark mode");
		expect(ctx.cookie("missing", "fallback")).toBe("fallback");
		expect(ctx.cookie()).toEqual({
			session: "abc123",
			theme: "dark mode",
		});
		expect(ctx.bodyValue<{ name: string }>()?.name).toBe("Ada");
		expect(ctx.input<string>("name")).toBe("Ada");
		expect(ctx.input<string>("tab")).toBe("profile");
		expect(ctx.input("missing", "fallback")).toBe("fallback");
		expect(ctx.all()).toEqual({
			name: "Ada",
			tab: "profile",
			tag: ["a", "b"],
		});
		expect(ctx.raw()).toBeNull();
	});

	test("reads input values through nested object paths", () => {
		const ctx = createContext(new Request("http://localhost"), {
			body: {
				user: {
					email: "ada@example.com",
				},
			},
		});

		expect(ctx.input<string>("user.email")).toBe("ada@example.com");
		expect(ctx.input("user.missing", "fallback")).toBe("fallback");
	});

	test("reads validated data and request-local state", () => {
		const ctx = createContext(new Request("http://localhost"), {
			state: { requestStarted: true },
			validated: {
				body: { name: "Ada" },
				cookies: { session: "abc123" },
				headers: { "x-tenant": "acme" },
				params: { id: "42" },
				query: { tab: "profile" },
			},
		});

		expect(ctx.validatedData()).toEqual({
			body: { name: "Ada" },
			cookies: { session: "abc123" },
			headers: { "x-tenant": "acme" },
			params: { id: "42" },
			query: { tab: "profile" },
		});
		expect(ctx.validatedData<{ tab: string }>("query")).toEqual({
			tab: "profile",
		});
		expect(ctx.validatedParams<{ id: string }>()).toEqual({ id: "42" });
		expect(ctx.validatedQuery<{ tab: string }>()).toEqual({
			tab: "profile",
		});
		expect(ctx.validatedHeaders<{ "x-tenant": string }>()).toEqual({
			"x-tenant": "acme",
		});
		expect(ctx.validatedCookies<{ session: string }>()).toEqual({
			session: "abc123",
		});
		expect(ctx.validatedBody<{ name: string }>()?.name).toBe("Ada");
		expect(ctx.getState<boolean>("requestStarted")).toBe(true);
		expect(ctx.getState("missing", "fallback")).toBe("fallback");
		expect(ctx.hasState("requestStarted")).toBe(true);

		ctx.setState("userId", 123);

		expect(ctx.getState<number>("userId")).toBe(123);
		expect(ctx.deleteState("userId")).toBe(true);
		expect(ctx.hasState("userId")).toBe(false);
	});

	test("parses request bodies lazily and caches the parsed value", async () => {
		const ctx = createContext(
			new Request("http://localhost/users", {
				body: JSON.stringify({ name: "Ada" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(ctx.bodyValue()).toBeUndefined();

		const parsed = await ctx.parseBody<{ name: string }>();

		expect(parsed).toEqual({ name: "Ada" });
		expect(ctx.bodyType).toBe("json");
		expect(ctx.raw()).toBe(JSON.stringify({ name: "Ada" }));
		expect(ctx.bodyValue<{ name: string }>()).toEqual(parsed);
		expect(await ctx.parseBody<{ name: string }>()).toEqual(parsed);
	});

	test("parses form bodies lazily and exposes form data", async () => {
		const ctx = createContext(
			new Request("http://localhost/users", {
				body: "name=Ada",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
			}),
		);

		await expect(ctx.parseBody()).resolves.toEqual({ name: "Ada" });
		expect(ctx.bodyType).toBe("urlencoded");
		expect(ctx.raw()).toBe("name=Ada");
		expect(ctx.formData?.get("name")).toBe("Ada");
	});

	test("parses text bodies lazily when requested by handlers", async () => {
		const ctx = createContext(
			new Request("http://localhost/messages", {
				body: "hello",
				headers: { "content-type": "text/plain" },
				method: "POST",
			}),
		);

		await expect(ctx.parseBody()).resolves.toBe("hello");
		expect(ctx.bodyType).toBe("text");
		expect(ctx.raw()).toBe("hello");
	});

	test("enriches existing context objects without replacing them", () => {
		const raw = {
			request: new Request("http://localhost/users/1"),
			params: { id: "1" },
		};
		const ctx = ensureContext(raw);

		expect(ctx).toBe(raw as unknown as typeof ctx);
		expect(ctx.param("id")).toBe("1");
		expect(ctx.state).toBeInstanceOf(Map);
	});
});

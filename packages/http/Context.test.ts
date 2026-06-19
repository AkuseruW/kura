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
	});

	test("reads validated data and request-local state", () => {
		const ctx = createContext(new Request("http://localhost"), {
			state: { requestStarted: true },
			validated: {
				body: { name: "Ada" },
				query: { tab: "profile" },
			},
		});

		expect(ctx.validatedData()).toEqual({
			body: { name: "Ada" },
			query: { tab: "profile" },
		});
		expect(ctx.validatedData<{ tab: string }>("query")).toEqual({
			tab: "profile",
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

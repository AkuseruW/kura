import { describe, expect, test } from "bun:test";
import { createContext } from "../http/Context";
import { BaseController, registerController } from "../http/Controller";
import { Router } from "../http/Router";
import type { Context } from "../http/Server";
import {
	AuthorizationException,
	authorize,
	authorizeMiddleware,
	BasePolicy,
	can,
} from "./Policy";

type User = {
	id: string;
	role?: "admin" | "editor";
};

type Post = {
	ownerId: string;
	published?: boolean;
};

class PostPolicy extends BasePolicy<User, Post> {
	override before(user: User): boolean | undefined {
		if (user.role === "admin") {
			return true;
		}
		return undefined;
	}

	override view(user: User, post?: Post): boolean {
		return Boolean(post?.published || post?.ownerId === user.id);
	}

	override create(user: User): boolean {
		return user.role === "editor";
	}

	override update(user: User, post?: Post): boolean {
		return post?.ownerId === user.id;
	}

	override delete(): boolean {
		return false;
	}
}

class EmptyPolicy extends BasePolicy<User, Post> {}

describe("authorize", () => {
	test("allows matching policy methods", async () => {
		await expect(
			authorize(authContext({ id: "user-1" }), PostPolicy, "view", {
				ownerId: "user-1",
			}),
		).resolves.toBeUndefined();
	});

	test("supports policy instances and before hooks", async () => {
		await expect(
			authorize(
				authContext({ id: "admin-1", role: "admin" }),
				new PostPolicy(),
				"delete",
				{ ownerId: "user-1" },
			),
		).resolves.toBeUndefined();
	});

	test("throws 401 when no authenticated user exists", async () => {
		await expect(
			authorize(
				createContext(new Request("http://localhost")),
				PostPolicy,
				"view",
			),
		).rejects.toMatchObject({
			code: "E_UNAUTHENTICATED",
			status: 401,
		});
	});

	test("throws 403 when a policy denies the action", async () => {
		await expect(
			authorize(authContext({ id: "user-2" }), PostPolicy, "update", {
				ownerId: "user-1",
			}),
		).rejects.toMatchObject({
			code: "E_AUTHORIZATION_DENIED",
			status: 403,
		});
	});

	test("base policy methods deny by default", async () => {
		await expect(
			authorize(authContext({ id: "user-1" }), EmptyPolicy, "view", {
				ownerId: "user-1",
			}),
		).rejects.toBeInstanceOf(AuthorizationException);
	});

	test("throws when an unknown policy action is requested", async () => {
		await expect(
			authorize(authContext({ id: "user-1" }), PostPolicy, "archive", {
				ownerId: "user-1",
			}),
		).rejects.toThrow("Policy action [archive] is not defined");
	});
});

describe("authorizeMiddleware", () => {
	test("continues when authorization passes", async () => {
		const middleware = authorizeMiddleware(PostPolicy, "view", () => ({
			ownerId: "user-1",
		}));

		const response = await middleware(
			authContext({ id: "user-1" }),
			async () => {
				return new Response("ok");
			},
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
	});

	test("returns 401 or 403 JSON responses when authorization fails", async () => {
		const middleware = authorizeMiddleware(PostPolicy, "view", () => ({
			ownerId: "user-1",
		}));
		const unauthenticated = await middleware(
			createContext(new Request("http://localhost")),
			async () => new Response("should not run"),
		);
		const forbidden = await middleware(
			authContext({ id: "user-2" }),
			async () => new Response("should not run"),
		);

		expect(unauthenticated.status).toBe(401);
		expect(await unauthenticated.json()).toEqual({
			error: {
				code: "E_UNAUTHENTICATED",
				message: "Unauthenticated",
				status: 401,
			},
		});
		expect(forbidden.status).toBe(403);
		expect(await forbidden.json()).toEqual({
			error: {
				code: "E_AUTHORIZATION_DENIED",
				message: "This action is unauthorized",
				status: 403,
			},
		});
	});
});

describe("@can", () => {
	test("authorizes controller actions through route middleware", async () => {
		class PostsController extends BaseController {
			@can(PostPolicy, "view", (ctx) => ({
				ownerId: ctx.params?.id ?? "",
			}))
			show(ctx: Context): Response {
				return new Response(ctx.params?.id);
			}
		}
		registerController("PolicyPostsController", PostsController);
		const router = new Router();
		router.resource("posts", "PolicyPostsController").only(["show"]).register();

		const allowed = router.match("GET", "/posts/user-1");
		const denied = router.match("GET", "/posts/user-1");
		const allowedResponse = await allowed?.handler(
			authContext({ id: "user-1" }, allowed.params),
		);
		const deniedResponse = await denied?.handler(
			authContext({ id: "user-2" }, denied.params),
		);

		expect(allowedResponse?.status).toBe(200);
		expect(await allowedResponse?.text()).toBe("user-1");
		expect(deniedResponse?.status).toBe(403);
		expect(await deniedResponse?.json()).toEqual({
			error: {
				code: "E_AUTHORIZATION_DENIED",
				message: "This action is unauthorized",
				status: 403,
			},
		});
	});
});

function authContext(user: User, params?: Record<string, string>): Context {
	return createContext(new Request("http://localhost"), {
		auth: {
			guard: "web",
			user,
		},
		params,
	});
}

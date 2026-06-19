import { describe, expect, test } from "bun:test";
import { Router } from "../http/Router";
import type { Context } from "../http/Server";
import {
	AccessTokenGuard,
	AccessTokenManager,
	MemoryAccessTokenStore,
} from "./AccessToken";
import { AuthManager } from "./AuthManager";
import { type AuthContext, type GuardResult, guard } from "./Guard";
import {
	type JwtClaims,
	JwtGuard,
	type JwtHeader,
	type JwtSecret,
} from "./JwtGuard";
import { SessionGuard } from "./SessionGuard";

const request = new Request("http://localhost/profile");

describe("guard middleware", () => {
	test("allows requests and attaches auth context", async () => {
		const ctx: Context = { request };
		const middleware = guard(() => ({ guard: "custom", user: "user-1" }));

		const response = await middleware(ctx, async () => {
			return new Response(ctx.auth?.guard);
		});

		expect(await response.text()).toBe("custom");
		expect(ctx.auth).toEqual({ guard: "custom", user: "user-1" });
	});

	test("returns 401 when a guard denies the request", async () => {
		const middleware = guard(() => false);

		const response = await middleware({ request }, async () => {
			return new Response("should not run");
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: {
				code: "E_UNAUTHENTICATED",
				message: "Unauthenticated",
				status: 401,
			},
		});
	});

	test("supports custom guard responses", async () => {
		const middleware = guard(() => new Response("Forbidden", { status: 403 }));

		const response = await middleware({ request }, async () => {
			return new Response("should not run");
		});

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Forbidden");
	});
});

describe("AuthManager", () => {
	test("registers guards and exposes auth.use(name).authenticate()", async () => {
		const auth = new AuthManager().register("web", () => true);
		const ctx: Context = { request };

		const response = await auth.use("web").authenticate()(ctx, async () => {
			return new Response(ctx.auth?.guard);
		});

		expect(await response.text()).toBe("web");
		expect(ctx.auth?.guard).toBe("web");
	});

	test("throws when resolving an unknown guard", () => {
		const auth = new AuthManager();

		expect(() => auth.use("missing")).toThrow(
			"Auth guard [missing] is not registered",
		);
	});

	test("can protect route groups through middleware", async () => {
		const auth = new AuthManager().register("web", () => ({
			guard: "session",
			user: "user-1",
		}));
		const router = new Router();
		router
			.group()
			.middleware(auth.use("web").authenticate())
			.routes((routes) => {
				routes.get("/profile", (ctx) => Response.json(ctx.auth));
			});

		const match = router.match("GET", "/profile");
		const response = await match?.handler({ request, params: match.params });

		expect(await response?.json()).toEqual({ guard: "web", user: "user-1" });
	});
});

describe("SessionGuard", () => {
	test("authenticates with a validated session cookie", async () => {
		const session = new SessionGuard({
			resolve: (sessionId) => ({
				sessionId,
				user: { id: 1 },
			}),
		});
		const ctx: Context = {
			request: new Request("http://localhost/profile", {
				headers: { cookie: "kura_session=session-1" },
			}),
		};

		const result = authContext(await session.authenticate(ctx));

		expect(result).toEqual({
			guard: "session",
			sessionId: "session-1",
			user: { id: 1 },
		});
	});

	test("supports custom session header names", async () => {
		const session = new SessionGuard({
			headerName: "x-session-id",
			guardName: "web",
			resolve: () => true,
		});
		const ctx: Context = {
			request: new Request("http://localhost/profile", {
				headers: { "x-session-id": "session-2" },
			}),
		};

		const result = authContext(await session.authenticate(ctx));

		expect(result.guard).toBe("web");
		expect(result.sessionId).toBe("session-2");
	});

	test("rejects missing or unresolved sessions", async () => {
		const session = new SessionGuard({ resolve: () => false });

		await expect(session.authenticate({ request })).resolves.toBe(false);
		await expect(
			session.authenticate({
				request: new Request("http://localhost/profile", {
					headers: { cookie: "kura_session=session-1" },
				}),
			}),
		).resolves.toBe(false);
	});
});

describe("AccessTokenManager", () => {
	type User = {
		readonly id: number;
		readonly email: string;
	};
	const user: User = { id: 1, email: "demo@example.com" };

	test("creates opaque tokens and authenticates bearer requests", async () => {
		const store = new MemoryAccessTokenStore<number>();
		const manager = new AccessTokenManager<User>({
			store,
			resolveUser: (id) => (id === user.id ? user : null),
			now: () => new Date("2026-01-01T00:00:00.000Z"),
		});

		const token = await manager.create(user, {
			name: "login",
			expiresIn: 3600,
			abilities: ["profile:read"],
		});
		const guard = new AccessTokenGuard({ manager, guardName: "api" });
		const result = authContext(
			await guard.authenticate({
				request: new Request("http://localhost/profile", {
					headers: { authorization: `Bearer ${token.value}` },
				}),
			}),
		);

		expect(token.value).toContain(".");
		expect(store.all()[0]?.tokenHash).not.toContain(token.value);
		expect(result.guard).toBe("api");
		expect(result.user).toEqual(user);
		expect(result.token).toBe(token.value);
		expect(result.claims).toEqual({
			abilities: ["profile:read"],
			tokenIdentifier: token.identifier,
			tokenType: "api",
		});
		expect(store.all()[0]?.lastUsedAt).toEqual(
			new Date("2026-01-01T00:00:00.000Z"),
		);
	});

	test("rejects missing and malformed bearer authorization headers", async () => {
		const manager = new AccessTokenManager<User>({
			resolveUser: (id) => (id === user.id ? user : null),
		});
		const token = await manager.create(user);
		const guard = new AccessTokenGuard({ manager });
		const headers = [
			undefined,
			"",
			"Basic credentials",
			"Bearer",
			"Bearer ",
			`Token ${token.value}`,
		];

		for (const authorization of headers) {
			const request = new Request("http://localhost/profile", {
				headers: authorization === undefined ? undefined : { authorization },
			});

			await expect(guard.authenticate({ request })).resolves.toBe(false);
		}
	});

	test("rejects missing, revoked, tampered, expired, and orphaned tokens", async () => {
		const store = new MemoryAccessTokenStore<number>();
		let userExists = true;
		let now = new Date("2026-01-01T00:00:00.000Z");
		const manager = new AccessTokenManager<User>({
			store,
			resolveUser: (id) => (userExists && id === user.id ? user : null),
			now: () => now,
		});
		const token = await manager.create(user, { expiresIn: 10 });

		await expect(manager.authenticate(undefined)).resolves.toBeNull();
		await expect(manager.authenticate(`${token.value}x`)).resolves.toBeNull();

		await manager.revoke(token.value);
		await expect(manager.authenticate(token.value)).resolves.toBeNull();

		const expiringToken = await manager.create(user, { expiresIn: 10 });
		now = new Date("2026-01-01T00:00:11.000Z");
		await expect(manager.authenticate(expiringToken.value)).resolves.toBeNull();

		now = new Date("2026-01-01T00:00:00.000Z");
		const orphanedToken = await manager.create(user);
		userExists = false;
		await expect(manager.authenticate(orphanedToken.value)).resolves.toBeNull();
	});
});

describe("JwtGuard", () => {
	const secret = "super-secret-with-at-least-32-bytes";

	test("authenticates valid HS256 bearer tokens", async () => {
		const token = await signJwt(
			{
				sub: "user-1",
				iss: "kura",
				aud: "api",
				exp: unixTime() + 60,
				iat: unixTime(),
			},
			secret,
		);
		const jwt = new JwtGuard({
			secret,
			issuer: "kura",
			audience: "api",
		});

		const result = authContext(
			await jwt.authenticate({
				request: new Request("http://localhost/profile", {
					headers: { authorization: `Bearer ${token}` },
				}),
			}),
		);

		expect(result.guard).toBe("jwt");
		expect(result.user).toBe("user-1");
		expect(result.claims?.sub).toBe("user-1");
		expect(result.token).toBe(token);
	});

	test("rejects missing, expired, tampered, or none-algorithm tokens", async () => {
		const jwt = new JwtGuard({ secret, issuer: "kura", audience: "api" });
		const validPayload: JwtClaims = {
			sub: "user-1",
			iss: "kura",
			aud: "api",
			exp: unixTime() + 60,
		};
		const validToken = await signJwt(validPayload, secret);
		const expiredToken = await signJwt(
			{ ...validPayload, exp: unixTime() - 60 },
			secret,
		);
		const tamperedToken = await replaceJwtPayload(validToken, {
			...validPayload,
			sub: "user-2",
		});
		const noneToken = unsignedJwt({ alg: "none", typ: "JWT" }, validPayload);

		await expect(jwt.authenticate({ request })).resolves.toBe(false);
		await expect(authenticateBearer(jwt, expiredToken)).resolves.toBe(false);
		await expect(authenticateBearer(jwt, tamperedToken)).resolves.toBe(false);
		await expect(authenticateBearer(jwt, noneToken)).resolves.toBe(false);
	});

	test("rejects issuer and audience mismatches", async () => {
		const token = await signJwt(
			{
				sub: "user-1",
				iss: "wrong",
				aud: "other",
				exp: unixTime() + 60,
			},
			secret,
		);
		const jwt = new JwtGuard({
			secret,
			issuer: "kura",
			audience: "api",
		});

		await expect(authenticateBearer(jwt, token)).resolves.toBe(false);
	});

	test("supports secret resolution from JWT headers", async () => {
		const token = await signJwt(
			{
				sub: "user-1",
				exp: unixTime() + 60,
			},
			secret,
			{ kid: "current" },
		);
		const jwt = new JwtGuard({
			secret: (header) => {
				if (header.kid !== "current") {
					return "wrong-secret-with-at-least-32-bytes";
				}
				return secret;
			},
		});

		const result = authContext(await authenticateBearer(jwt, token));

		expect(result.claims?.sub).toBe("user-1");
	});

	test("rejects weak HS256 secrets", async () => {
		const weakSecret = "short";
		const token = await signJwt(
			{
				sub: "user-1",
				exp: unixTime() + 60,
			},
			weakSecret,
		);
		const jwt = new JwtGuard({ secret: weakSecret });

		await expect(authenticateBearer(jwt, token)).resolves.toBe(false);
	});
});

function authContext(result: GuardResult): AuthContext {
	if (result === true || result === false || result instanceof Response) {
		throw new Error("Expected auth context");
	}
	return result;
}

async function authenticateBearer(
	jwt: JwtGuard,
	token: string,
): Promise<GuardResult> {
	return jwt.authenticate({
		request: new Request("http://localhost/profile", {
			headers: { authorization: `Bearer ${token}` },
		}),
	});
}

async function signJwt(
	payload: JwtClaims,
	secret: JwtSecret,
	header: Partial<JwtHeader> = {},
): Promise<string> {
	const encodedHeader = base64UrlEncodeJson({
		alg: "HS256",
		typ: "JWT",
		...header,
	});
	const encodedPayload = base64UrlEncodeJson(payload);
	const signature = await hmac(`${encodedHeader}.${encodedPayload}`, secret);
	return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
}

async function replaceJwtPayload(
	token: string,
	payload: JwtClaims,
): Promise<string> {
	const [header, , signature] = token.split(".");
	return `${header}.${base64UrlEncodeJson(payload)}.${signature}`;
}

function unsignedJwt(
	header: Record<string, unknown>,
	payload: JwtClaims,
): string {
	return `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}.signature`;
}

async function hmac(value: string, secret: JwtSecret): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		secretBuffer(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(value),
	);
	return new Uint8Array(signature);
}

function secretBuffer(secret: JwtSecret): ArrayBuffer {
	let bytes: Uint8Array;
	if (typeof secret === "string") {
		bytes = new TextEncoder().encode(secret);
	} else if (secret instanceof Uint8Array) {
		bytes = secret;
	} else {
		bytes = new Uint8Array(secret);
	}

	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function base64UrlEncodeJson(value: unknown): string {
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function unixTime(): number {
	return Math.floor(Date.now() / 1000);
}

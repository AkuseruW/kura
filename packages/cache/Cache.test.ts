import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CacheException,
	CacheManager,
	FileCacheDriver,
	MemoryCacheDriver,
	type RedisCacheClient,
	RedisCacheDriver,
} from "./Cache";

describe("CacheManager", () => {
	test("stores, reads, checks, forgets, and flushes values", async () => {
		const cache = createMemoryCache();

		await cache.put("user:1", { name: "Kura" });
		await cache.put("user:2", { name: "Axel" });

		expect(await cache.get<{ name: string }>("user:1")).toEqual({
			name: "Kura",
		});
		expect(await cache.get("missing", "fallback")).toBe("fallback");
		expect(await cache.has("user:2")).toBe(true);

		await cache.forget("user:2");
		expect(await cache.has("user:2")).toBe(false);

		await cache.flush();
		expect(await cache.get("user:1")).toBeNull();
	});

	test("expires values with millisecond TTLs and absolute dates", async () => {
		const clock = new MutableClock("2026-01-01T00:00:00.000Z");
		const cache = createMemoryCache(clock);

		await cache.put("short", "value", 50);
		await cache.put("absolute", "value", new Date("2026-01-01T00:00:00.100Z"));

		clock.tick(49);
		expect(await cache.get<string>("short")).toBe("value");

		clock.tick(1);
		expect(await cache.get("short")).toBeNull();
		expect(await cache.get<string>("absolute")).toBe("value");

		clock.tick(50);
		expect(await cache.get("absolute")).toBeNull();
	});

	test("remembers computed values only on cache misses", async () => {
		const cache = createMemoryCache();
		let calls = 0;

		const first = await cache.remember("count", 1000, () => {
			calls++;
			return calls;
		});
		const second = await cache.remember("count", 1000, () => {
			calls++;
			return calls;
		});

		expect(first).toBe(1);
		expect(second).toBe(1);
		expect(calls).toBe(1);
	});

	test("flushes tagged values without deleting unrelated entries", async () => {
		const cache = createMemoryCache();

		await cache.tags(["users", "profile"]).put("user:1", "tagged");
		await cache.tags("posts").put("post:1", "post");
		await cache.put("global", "value");

		await cache.tags("users").flush();

		expect(await cache.get("user:1")).toBeNull();
		expect(await cache.get<string>("post:1")).toBe("post");
		expect(await cache.get<string>("global")).toBe("value");
	});

	test("validates keys and TTLs", async () => {
		const cache = createMemoryCache();

		await expect(cache.put("", "value")).rejects.toMatchObject({
			code: "E_CACHE_INVALID_KEY",
		});
		await expect(cache.put("key", "value", -1)).rejects.toMatchObject({
			code: "E_CACHE_INVALID_TTL",
		});
		await expect(cache.put("key", undefined)).rejects.toMatchObject({
			code: "E_CACHE_INVALID_VALUE",
		});
	});
});

describe("MemoryCacheDriver", () => {
	test("can be used directly through the cache driver contract", async () => {
		const driver = new MemoryCacheDriver();
		const now = new Date("2026-01-01T00:00:00.000Z");

		await driver.put("direct", "value", {
			now,
			tags: [],
		});

		expect(await driver.get<string>("direct", now)).toBe("value");
	});
});

describe("FileCacheDriver", () => {
	test("persists cache records across driver instances", async () => {
		const directory = await mkdtemp(join(tmpdir(), "kura-cache-"));
		const clock = new MutableClock("2026-01-01T00:00:00.000Z");

		try {
			const first = new CacheManager(new FileCacheDriver({ directory }), () =>
				clock.now(),
			);
			await first.put("settings", { theme: "dark" }, 100);

			const second = new CacheManager(new FileCacheDriver({ directory }), () =>
				clock.now(),
			);
			expect(await second.get<{ theme: string }>("settings")).toEqual({
				theme: "dark",
			});

			clock.tick(100);
			expect(await second.get("settings")).toBeNull();
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	test("flushes file records by tag", async () => {
		const directory = await mkdtemp(join(tmpdir(), "kura-cache-"));
		const cache = new CacheManager(new FileCacheDriver({ directory }));

		try {
			await cache.tags("users").put("user:1", "tagged");
			await cache.put("global", "value");
			await cache.tags("users").flush();

			expect(await cache.get("user:1")).toBeNull();
			expect(await cache.get<string>("global")).toBe("value");
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});
});

describe("RedisCacheDriver", () => {
	test("stores and reads serialized cache records", async () => {
		const clock = new MutableClock("2026-01-01T00:00:00.000Z");
		const client = new FakeRedisCacheClient();
		const cache = new CacheManager(
			new RedisCacheDriver({ client, prefix: "test:cache" }),
			() => clock.now(),
		);

		await cache.put("session", { userId: 1 }, 100);

		expect(await cache.get<{ userId: number }>("session")).toEqual({
			userId: 1,
		});

		clock.tick(100);
		expect(await cache.get("session")).toBeNull();
		expect(client.size()).toBe(0);
	});

	test("flushes Redis records by tag when keys are available", async () => {
		const client = new FakeRedisCacheClient();
		const cache = new CacheManager(
			new RedisCacheDriver({ client, prefix: "test:cache" }),
		);

		await cache.tags("users").put("user:1", "tagged");
		await cache.tags("posts").put("post:1", "post");

		await cache.tags("users").flush();

		expect(await cache.get("user:1")).toBeNull();
		expect(await cache.get<string>("post:1")).toBe("post");
	});

	test("fails clearly when Redis tag flushing cannot scan keys", async () => {
		const cache = new CacheManager(
			new RedisCacheDriver({
				client: new NoKeysRedisCacheClient(),
				prefix: "test:cache",
			}),
		);

		await expect(cache.tags("users").flush()).rejects.toBeInstanceOf(
			CacheException,
		);
		await expect(cache.flush()).rejects.toMatchObject({
			code: "E_CACHE_UNSUPPORTED_OPERATION",
		});
	});
});

class MutableClock {
	private current: Date;

	constructor(date: string) {
		this.current = new Date(date);
	}

	now(): Date {
		return new Date(this.current.getTime());
	}

	tick(milliseconds: number): void {
		this.current = new Date(this.current.getTime() + milliseconds);
	}
}

function createMemoryCache(clock?: MutableClock): CacheManager {
	return new CacheManager(new MemoryCacheDriver(), () =>
		clock ? clock.now() : new Date(),
	);
}

class FakeRedisCacheClient implements RedisCacheClient {
	protected readonly values = new Map<string, string>();

	get(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	set(key: string, value: string): string {
		this.values.set(key, value);
		return "OK";
	}

	del(key: string): number {
		return Number(this.values.delete(key));
	}

	keys(pattern: string): string[] {
		const prefix = pattern.replace("*", "");

		return [...this.values.keys()].filter((key) => key.startsWith(prefix));
	}

	size(): number {
		return this.values.size;
	}
}

class NoKeysRedisCacheClient implements RedisCacheClient {
	private readonly values = new Map<string, string>();

	get(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	set(key: string, value: string): string {
		this.values.set(key, value);
		return "OK";
	}

	del(key: string): number {
		return Number(this.values.delete(key));
	}
}

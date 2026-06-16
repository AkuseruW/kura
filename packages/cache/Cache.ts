import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BaseException } from "../core/BaseException";

type MaybePromise<T> = T | Promise<T>;

export type CacheTtl = number | Date;
export type CacheFactory<T> = () => T | Promise<T>;

export type CachePutOptions = {
	readonly ttl?: CacheTtl;
	readonly tags?: readonly string[];
};

export type CacheStoreOptions = {
	readonly expiresAt?: Date;
	readonly tags: readonly string[];
	readonly now: Date;
};

export interface CacheDriver {
	get<T = unknown>(key: string, now: Date): Promise<T | null>;
	put<T>(key: string, value: T, options: CacheStoreOptions): Promise<void>;
	forget(key: string): Promise<void>;
	flush(): Promise<void>;
	flushTags(tags: readonly string[]): Promise<void>;
}

export type CacheManagerOptions = {
	readonly driver?: CacheDriver;
	readonly now?: () => Date;
};

export type FileCacheDriverOptions = {
	readonly directory: string;
	readonly prefix?: string;
};

export type RedisCacheClient = {
	get(key: string): MaybePromise<string | null>;
	set(key: string, value: string): MaybePromise<unknown>;
	del(key: string): MaybePromise<unknown>;
	keys?(pattern: string): MaybePromise<string[]>;
};

export type RedisCacheDriverOptions = {
	readonly client: RedisCacheClient;
	readonly prefix?: string;
};

type MemoryCacheRecord = {
	readonly value: unknown;
	readonly expiresAt?: Date;
	readonly tags: ReadonlySet<string>;
};

type SerializedCacheRecord = {
	readonly key: string;
	readonly value: unknown;
	readonly expiresAt: number | null;
	readonly tags: readonly string[];
};

export class CacheException extends BaseException {
	static invalidKey(key: string): CacheException {
		return new CacheException(
			`Invalid cache key [${key}]`,
			"E_CACHE_INVALID_KEY",
			500,
			"Cache keys must not be empty.",
		);
	}

	static invalidTtl(ttl: CacheTtl): CacheException {
		return new CacheException(
			`Invalid cache TTL [${String(ttl)}]`,
			"E_CACHE_INVALID_TTL",
			500,
			"Cache TTL values must be non-negative finite milliseconds or a valid Date.",
		);
	}

	static invalidValue(): CacheException {
		return new CacheException(
			"Invalid cache value [undefined]",
			"E_CACHE_INVALID_VALUE",
			500,
			"Cache values must be defined; use null when an empty value should be cached.",
		);
	}

	static invalidRecord(driver: string): CacheException {
		return new CacheException(
			`Invalid ${driver} cache record`,
			"E_CACHE_INVALID_RECORD",
		);
	}

	static unsupportedOperation(operation: string): CacheException {
		return new CacheException(
			`Cache driver does not support [${operation}]`,
			"E_CACHE_UNSUPPORTED_OPERATION",
		);
	}
}

export class CacheManager {
	constructor(
		public readonly driver: CacheDriver = new MemoryCacheDriver(),
		private readonly clock: () => Date = () => new Date(),
	) {}

	static memory(options: CacheManagerOptions = {}): CacheManager {
		return new CacheManager(
			options.driver ?? new MemoryCacheDriver(),
			options.now ?? (() => new Date()),
		);
	}

	async get<T>(key: string): Promise<T | null>;
	async get<T>(key: string, defaultValue: T): Promise<T>;
	async get<T>(key: string, defaultValue?: T): Promise<T | null> {
		validateKey(key);

		const value = await this.driver.get<T>(key, this.now());

		if (value === null && defaultValue !== undefined) {
			return defaultValue;
		}

		return value;
	}

	async put<T>(
		key: string,
		value: T,
		ttlOrOptions?: CacheTtl | CachePutOptions,
	): Promise<void> {
		validateKey(key);
		validateValue(value);
		await this.driver.put(key, value, this.storeOptions(ttlOrOptions));
	}

	async forever<T>(key: string, value: T): Promise<void> {
		await this.put(key, value);
	}

	async has(key: string): Promise<boolean> {
		return (await this.get(key)) !== null;
	}

	async forget(key: string): Promise<void> {
		validateKey(key);
		await this.driver.forget(key);
	}

	async flush(): Promise<void> {
		await this.driver.flush();
	}

	async remember<T>(
		key: string,
		ttlOrOptions: CacheTtl | CachePutOptions,
		factory: CacheFactory<T>,
	): Promise<T> {
		const cached = await this.get<T>(key);

		if (cached !== null) {
			return cached;
		}

		const value = await factory();
		await this.put(key, value, ttlOrOptions);

		return value;
	}

	async rememberForever<T>(key: string, factory: CacheFactory<T>): Promise<T> {
		return this.remember(key, {}, factory);
	}

	tags(tags: string | readonly string[]): TaggedCache {
		return new TaggedCache(this, normalizeTags(tags));
	}

	now(): Date {
		return new Date(this.clock().getTime());
	}

	resolveExpiresAt(ttl: CacheTtl | undefined): Date | undefined {
		if (ttl === undefined) {
			return undefined;
		}

		if (ttl instanceof Date) {
			if (Number.isNaN(ttl.getTime())) {
				throw CacheException.invalidTtl(ttl);
			}

			return new Date(ttl.getTime());
		}

		if (!Number.isFinite(ttl) || ttl < 0) {
			throw CacheException.invalidTtl(ttl);
		}

		return new Date(this.now().getTime() + ttl);
	}

	private storeOptions(
		ttlOrOptions: CacheTtl | CachePutOptions | undefined,
	): CacheStoreOptions {
		const options = normalizePutOptions(ttlOrOptions);

		return {
			expiresAt: this.resolveExpiresAt(options.ttl),
			tags: normalizeTags(options.tags ?? []),
			now: this.now(),
		};
	}
}

export class TaggedCache {
	constructor(
		private readonly cache: CacheManager,
		private readonly tagNames: readonly string[],
	) {}

	async get<T>(key: string): Promise<T | null>;
	async get<T>(key: string, defaultValue: T): Promise<T>;
	async get<T>(key: string, defaultValue?: T): Promise<T | null> {
		return defaultValue === undefined
			? this.cache.get<T>(key)
			: this.cache.get<T>(key, defaultValue);
	}

	async put<T>(
		key: string,
		value: T,
		ttlOrOptions?: CacheTtl | CachePutOptions,
	): Promise<void> {
		const options = normalizePutOptions(ttlOrOptions);
		await this.cache.put(key, value, {
			...options,
			tags: mergeTags(this.tagNames, options.tags ?? []),
		});
	}

	async forever<T>(key: string, value: T): Promise<void> {
		await this.put(key, value);
	}

	async has(key: string): Promise<boolean> {
		return this.cache.has(key);
	}

	async forget(key: string): Promise<void> {
		await this.cache.forget(key);
	}

	async flush(): Promise<void> {
		await this.cache.driver.flushTags(this.tagNames);
	}

	async remember<T>(
		key: string,
		ttlOrOptions: CacheTtl | CachePutOptions,
		factory: CacheFactory<T>,
	): Promise<T> {
		const cached = await this.get<T>(key);

		if (cached !== null) {
			return cached;
		}

		const value = await factory();
		await this.put(key, value, ttlOrOptions);

		return value;
	}

	async rememberForever<T>(key: string, factory: CacheFactory<T>): Promise<T> {
		return this.remember(key, {}, factory);
	}
}

export class MemoryCacheDriver implements CacheDriver {
	private readonly records = new Map<string, MemoryCacheRecord>();

	async get<T = unknown>(key: string, now: Date): Promise<T | null> {
		const record = this.records.get(key);

		if (!record) {
			return null;
		}

		if (isExpired(record.expiresAt, now)) {
			this.records.delete(key);
			return null;
		}

		return record.value as T;
	}

	async put<T>(
		key: string,
		value: T,
		options: CacheStoreOptions,
	): Promise<void> {
		this.records.set(key, {
			value,
			expiresAt: options.expiresAt
				? new Date(options.expiresAt.getTime())
				: undefined,
			tags: new Set(options.tags),
		});
	}

	async forget(key: string): Promise<void> {
		this.records.delete(key);
	}

	async flush(): Promise<void> {
		this.records.clear();
	}

	async flushTags(tags: readonly string[]): Promise<void> {
		const tagSet = new Set(tags);

		for (const [key, record] of this.records.entries()) {
			if (intersects(record.tags, tagSet)) {
				this.records.delete(key);
			}
		}
	}
}

export class FileCacheDriver implements CacheDriver {
	private readonly prefix: string;

	constructor(private readonly options: FileCacheDriverOptions) {
		this.prefix = normalizeFilePrefix(options.prefix ?? "kura-cache");
	}

	async get<T = unknown>(key: string, now: Date): Promise<T | null> {
		const record = await this.readRecord(key);

		if (!record) {
			return null;
		}

		if (isExpired(timestampToDate(record.expiresAt), now)) {
			await this.forget(key);
			return null;
		}

		return record.value as T;
	}

	async put<T>(
		key: string,
		value: T,
		options: CacheStoreOptions,
	): Promise<void> {
		await mkdir(this.options.directory, { recursive: true });
		await writeFile(
			this.pathForKey(key),
			JSON.stringify(
				serializeRecord(key, value, options.expiresAt, options.tags),
			),
		);
	}

	async forget(key: string): Promise<void> {
		await rm(this.pathForKey(key), { force: true });
	}

	async flush(): Promise<void> {
		for (const file of await this.files()) {
			await rm(join(this.options.directory, file), { force: true });
		}
	}

	async flushTags(tags: readonly string[]): Promise<void> {
		const tagSet = new Set(tags);

		for (const file of await this.files()) {
			const path = join(this.options.directory, file);
			const record = parseRecord(await readFile(path, "utf8"), "file");

			if (intersects(new Set(record.tags), tagSet)) {
				await rm(path, { force: true });
			}
		}
	}

	private async readRecord(key: string): Promise<SerializedCacheRecord | null> {
		try {
			const record = parseRecord(
				await readFile(this.pathForKey(key), "utf8"),
				"file",
			);

			if (record.key !== key) {
				throw CacheException.invalidRecord("file");
			}

			return record;
		} catch (error) {
			if (hasNodeCode(error, "ENOENT")) {
				return null;
			}

			throw error;
		}
	}

	private async files(): Promise<string[]> {
		try {
			return (await readdir(this.options.directory)).filter((file) =>
				file.startsWith(`${this.prefix}-`),
			);
		} catch (error) {
			if (hasNodeCode(error, "ENOENT")) {
				return [];
			}

			throw error;
		}
	}

	private pathForKey(key: string): string {
		return join(this.options.directory, `${this.prefix}-${hashKey(key)}.json`);
	}
}

export class RedisCacheDriver implements CacheDriver {
	private readonly client: RedisCacheClient;
	private readonly prefix: string;

	constructor(options: RedisCacheDriverOptions) {
		this.client = options.client;
		this.prefix = normalizeRedisPrefix(options.prefix ?? "kura:cache");
	}

	async get<T = unknown>(key: string, now: Date): Promise<T | null> {
		const record = await this.getRecord(key);

		if (!record) {
			return null;
		}

		if (isExpired(timestampToDate(record.expiresAt), now)) {
			await this.forget(key);
			return null;
		}

		return record.value as T;
	}

	async put<T>(
		key: string,
		value: T,
		options: CacheStoreOptions,
	): Promise<void> {
		await this.client.set(
			this.keyForKey(key),
			JSON.stringify(
				serializeRecord(key, value, options.expiresAt, options.tags),
			),
		);
	}

	async forget(key: string): Promise<void> {
		await this.client.del(this.keyForKey(key));
	}

	async flush(): Promise<void> {
		await this.deleteKeys(await this.keys());
	}

	async flushTags(tags: readonly string[]): Promise<void> {
		const tagSet = new Set(tags);
		const keys = await this.keys();
		const deletedKeys: string[] = [];

		for (const key of keys) {
			const value = await this.client.get(key);

			if (!value) {
				continue;
			}

			const record = parseRecord(value, "redis");

			if (intersects(new Set(record.tags), tagSet)) {
				deletedKeys.push(key);
			}
		}

		await this.deleteKeys(deletedKeys);
	}

	private async getRecord(key: string): Promise<SerializedCacheRecord | null> {
		const value = await this.client.get(this.keyForKey(key));

		if (!value) {
			return null;
		}

		const record = parseRecord(value, "redis");

		if (record.key !== key) {
			throw CacheException.invalidRecord("redis");
		}

		return record;
	}

	private async keys(): Promise<string[]> {
		if (!this.client.keys) {
			throw CacheException.unsupportedOperation("redis keys scan");
		}

		return this.client.keys(`${this.prefix}:entries:*`);
	}

	private async deleteKeys(keys: readonly string[]): Promise<void> {
		for (const key of keys) {
			await this.client.del(key);
		}
	}

	private keyForKey(key: string): string {
		return `${this.prefix}:entries:${hashKey(key)}`;
	}
}

export const cache = new CacheManager();

function normalizePutOptions(
	ttlOrOptions: CacheTtl | CachePutOptions | undefined,
): CachePutOptions {
	if (
		ttlOrOptions === undefined ||
		typeof ttlOrOptions === "number" ||
		ttlOrOptions instanceof Date
	) {
		return { ttl: ttlOrOptions };
	}

	return ttlOrOptions;
}

function validateKey(key: string): void {
	if (!key.trim()) {
		throw CacheException.invalidKey(key);
	}
}

function validateValue(value: unknown): void {
	if (value === undefined) {
		throw CacheException.invalidValue();
	}
}

function normalizeTags(tags: string | readonly string[]): readonly string[] {
	const values = typeof tags === "string" ? [tags] : tags;
	const normalized = values.map((tag) => tag.trim()).filter(Boolean);

	return [...new Set(normalized)];
}

function mergeTags(
	first: readonly string[],
	second: readonly string[],
): readonly string[] {
	return normalizeTags([...first, ...second]);
}

function serializeRecord<T>(
	key: string,
	value: T,
	expiresAt: Date | undefined,
	tags: readonly string[],
): SerializedCacheRecord {
	return {
		key,
		value,
		expiresAt: expiresAt?.getTime() ?? null,
		tags: normalizeTags(tags),
	};
}

function parseRecord(value: string, driver: string): SerializedCacheRecord {
	const parsed = JSON.parse(value) as unknown;

	if (
		isRecord(parsed) &&
		typeof parsed.key === "string" &&
		"value" in parsed &&
		(parsed.expiresAt === null || typeof parsed.expiresAt === "number") &&
		Array.isArray(parsed.tags) &&
		parsed.tags.every((tag) => typeof tag === "string")
	) {
		return {
			key: parsed.key,
			value: parsed.value,
			expiresAt: parsed.expiresAt,
			tags: parsed.tags,
		};
	}

	throw CacheException.invalidRecord(driver);
}

function isExpired(expiresAt: Date | undefined, now: Date): boolean {
	return expiresAt !== undefined && expiresAt.getTime() <= now.getTime();
}

function timestampToDate(timestamp: number | null): Date | undefined {
	return timestamp === null ? undefined : new Date(timestamp);
}

function intersects(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): boolean {
	for (const value of left) {
		if (right.has(value)) {
			return true;
		}
	}

	return false;
}

function hashKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

function normalizeFilePrefix(prefix: string): string {
	const normalized = prefix.trim().replace(/[^a-zA-Z0-9_-]/g, "-");

	if (!normalized) {
		throw CacheException.invalidKey(prefix);
	}

	return normalized;
}

function normalizeRedisPrefix(prefix: string): string {
	const normalized = prefix.trim().replace(/:+$/, "");

	if (!normalized) {
		throw CacheException.invalidKey(prefix);
	}

	return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function hasNodeCode(error: unknown, code: string): boolean {
	return (
		isRecord(error) && typeof error.code === "string" && error.code === code
	);
}

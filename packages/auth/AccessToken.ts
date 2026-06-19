import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "../http/Server";
import type { Guard, GuardResult } from "./Guard";

export type AccessTokenUserId = string | number | bigint;

export type AccessTokenUser = {
	readonly id: AccessTokenUserId;
};

export type AccessTokenRecord<
	TUserId extends AccessTokenUserId = AccessTokenUserId,
> = {
	readonly identifier: string;
	readonly tokenableId: TUserId;
	readonly type: string;
	readonly name?: string;
	readonly tokenHash: string;
	readonly abilities: readonly string[];
	readonly createdAt: Date;
	readonly updatedAt?: Date;
	readonly lastUsedAt?: Date;
	readonly expiresAt?: Date;
};

export type AccessTokenCreateRecord<
	TUserId extends AccessTokenUserId = AccessTokenUserId,
> = Omit<AccessTokenRecord<TUserId>, "createdAt"> & {
	readonly createdAt?: Date;
};

export interface AccessTokenStore<
	TUserId extends AccessTokenUserId = AccessTokenUserId,
> {
	create(record: AccessTokenRecord<TUserId>): void | Promise<void>;
	find(
		identifier: string,
	):
		| AccessTokenRecord<TUserId>
		| null
		| Promise<AccessTokenRecord<TUserId> | null>;
	delete(identifier: string): void | Promise<void>;
	updateLastUsedAt(identifier: string, date: Date): void | Promise<void>;
}

export type AccessTokenUserProvider<TUser extends AccessTokenUser> = (
	id: TUser["id"],
) => TUser | null | Promise<TUser | null>;

export type AccessTokenManagerOptions<TUser extends AccessTokenUser> = {
	readonly store?: AccessTokenStore<TUser["id"]>;
	readonly resolveUser: AccessTokenUserProvider<TUser>;
	readonly tokenPrefix?: string;
	readonly now?: () => Date;
};

export type AccessTokenCreateOptions = {
	readonly type?: string;
	readonly name?: string;
	readonly abilities?: readonly string[];
	readonly expiresIn?: number;
	readonly expiresAt?: Date;
};

export type PlainAccessToken<TUser extends AccessTokenUser = AccessTokenUser> =
	{
		readonly identifier: string;
		readonly value: string;
		readonly type: string;
		readonly name?: string;
		readonly abilities: readonly string[];
		readonly expiresAt?: Date;
		readonly user: TUser;
	};

export type AccessTokenAuthentication<
	TUser extends AccessTokenUser = AccessTokenUser,
> = {
	readonly token: string;
	readonly record: AccessTokenRecord<TUser["id"]>;
	readonly user: TUser;
};

export type AccessTokenGuardOptions<TUser extends AccessTokenUser> = {
	readonly manager: AccessTokenManager<TUser>;
	readonly guardName?: string;
};

const DEFAULT_TOKEN_TYPE = "api";
const DEFAULT_TOKEN_ABILITIES = ["*"] as const;

export class AccessTokenManager<TUser extends AccessTokenUser> {
	private readonly store: AccessTokenStore<TUser["id"]>;
	private readonly tokenPrefix: string;
	private readonly now: () => Date;

	constructor(private readonly options: AccessTokenManagerOptions<TUser>) {
		this.store = options.store ?? new MemoryAccessTokenStore<TUser["id"]>();
		this.tokenPrefix = options.tokenPrefix ?? "";
		this.now = options.now ?? (() => new Date());
	}

	async create(
		user: TUser,
		options: AccessTokenCreateOptions = {},
	): Promise<PlainAccessToken<TUser>> {
		const identifier = createTokenIdentifier();
		const secret = createTokenSecret();
		const value = `${this.tokenPrefix}${identifier}.${secret}`;
		const createdAt = this.now();
		const expiresAt = resolveExpiresAt(options, createdAt);
		const type = options.type ?? DEFAULT_TOKEN_TYPE;
		const abilities = options.abilities ?? DEFAULT_TOKEN_ABILITIES;

		await this.store.create({
			identifier,
			tokenableId: user.id,
			type,
			name: options.name,
			tokenHash: hashTokenSecret(secret),
			abilities: [...abilities],
			createdAt: cloneDate(createdAt),
			expiresAt: expiresAt ? cloneDate(expiresAt) : undefined,
		});

		return {
			identifier,
			value,
			type,
			name: options.name,
			abilities: [...abilities],
			expiresAt: expiresAt ? cloneDate(expiresAt) : undefined,
			user,
		};
	}

	async authenticate(
		token: string | null | undefined,
	): Promise<AccessTokenAuthentication<TUser> | null> {
		const parsed = this.parse(token);

		if (!parsed) {
			return null;
		}

		const record = await this.store.find(parsed.identifier);

		if (!record || isExpired(record, this.now())) {
			return null;
		}

		if (!matchesTokenSecret(parsed.secret, record.tokenHash)) {
			return null;
		}

		const user = await this.options.resolveUser(record.tokenableId);

		if (!user) {
			return null;
		}

		await this.store.updateLastUsedAt(record.identifier, this.now());

		return {
			token: parsed.token,
			record,
			user,
		};
	}

	async revoke(tokenOrIdentifier: string): Promise<void> {
		const parsed = this.parse(tokenOrIdentifier);
		await this.store.delete(parsed?.identifier ?? tokenOrIdentifier);
	}

	private parse(token: string | null | undefined): {
		readonly identifier: string;
		readonly secret: string;
		readonly token: string;
	} | null {
		if (!token) {
			return null;
		}

		const value =
			this.tokenPrefix && token.startsWith(this.tokenPrefix)
				? token.slice(this.tokenPrefix.length)
				: token;
		const separatorIndex = value.indexOf(".");

		if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
			return null;
		}

		return {
			identifier: value.slice(0, separatorIndex),
			secret: value.slice(separatorIndex + 1),
			token,
		};
	}
}

export class AccessTokenGuard<TUser extends AccessTokenUser> implements Guard {
	constructor(private readonly options: AccessTokenGuardOptions<TUser>) {}

	async authenticate(ctx: Context): Promise<GuardResult> {
		const token = bearerToken(ctx.request);
		const result = await this.options.manager.authenticate(token);

		if (!result) {
			return false;
		}

		return {
			guard: this.options.guardName ?? result.record.type,
			user: result.user,
			token: result.token,
			claims: {
				abilities: [...result.record.abilities],
				tokenIdentifier: result.record.identifier,
				tokenType: result.record.type,
			},
		};
	}
}

export class MemoryAccessTokenStore<
	TUserId extends AccessTokenUserId = AccessTokenUserId,
> implements AccessTokenStore<TUserId>
{
	private readonly records = new Map<string, AccessTokenRecord<TUserId>>();

	create(record: AccessTokenRecord<TUserId>): void {
		this.records.set(record.identifier, cloneRecord(record));
	}

	find(identifier: string): AccessTokenRecord<TUserId> | null {
		const record = this.records.get(identifier);

		return record ? cloneRecord(record) : null;
	}

	delete(identifier: string): void {
		this.records.delete(identifier);
	}

	updateLastUsedAt(identifier: string, date: Date): void {
		const record = this.records.get(identifier);

		if (!record) {
			return;
		}

		this.records.set(identifier, {
			...record,
			lastUsedAt: cloneDate(date),
			updatedAt: cloneDate(date),
		});
	}

	all(): readonly AccessTokenRecord<TUserId>[] {
		return [...this.records.values()].map(cloneRecord);
	}
}

function bearerToken(request: Request): string | null {
	return (
		request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
	);
}

function createTokenIdentifier(): string {
	return randomBytes(16).toString("hex");
}

function createTokenSecret(): string {
	return randomBytes(32).toString("hex");
}

function hashTokenSecret(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

function matchesTokenSecret(secret: string, expectedHash: string): boolean {
	const actual = Buffer.from(hashTokenSecret(secret), "hex");
	const expected = Buffer.from(expectedHash, "hex");

	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function resolveExpiresAt(
	options: AccessTokenCreateOptions,
	now: Date,
): Date | undefined {
	if (options.expiresAt) {
		return cloneDate(options.expiresAt);
	}

	if (options.expiresIn === undefined) {
		return undefined;
	}

	if (!Number.isFinite(options.expiresIn) || options.expiresIn < 0) {
		throw new Error(
			"Access token expiresIn must be a positive number of seconds",
		);
	}

	return new Date(now.getTime() + options.expiresIn * 1000);
}

function isExpired(record: AccessTokenRecord, now: Date): boolean {
	return (
		record.expiresAt !== undefined &&
		record.expiresAt.getTime() <= now.getTime()
	);
}

function cloneRecord<TUserId extends AccessTokenUserId>(
	record: AccessTokenRecord<TUserId>,
): AccessTokenRecord<TUserId> {
	return {
		...record,
		abilities: [...record.abilities],
		createdAt: cloneDate(record.createdAt),
		updatedAt: record.updatedAt ? cloneDate(record.updatedAt) : undefined,
		lastUsedAt: record.lastUsedAt ? cloneDate(record.lastUsedAt) : undefined,
		expiresAt: record.expiresAt ? cloneDate(record.expiresAt) : undefined,
	};
}

function cloneDate(date: Date): Date {
	return new Date(date.getTime());
}

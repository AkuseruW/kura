import type {
	DatabaseClient,
	QueryPrimitive,
	QueryRow,
} from "../database/Database";
import type {
	AccessTokenRecord,
	AccessTokenStore,
	AccessTokenUserId,
} from "./AccessToken";

export type DatabaseAccessTokenStoreOptions = {
	readonly table?: string;
	readonly connection?: string;
};

type AccessTokenRow = QueryRow & {
	readonly identifier: string;
	readonly tokenable_id: QueryPrimitive;
	readonly type: string;
	readonly name: string | null;
	readonly token_hash: string;
	readonly abilities: string;
	readonly created_at: Date | string;
	readonly updated_at?: Date | string | null;
	readonly last_used_at?: Date | string | null;
	readonly expires_at?: Date | string | null;
};

const DEFAULT_TABLE = "auth_access_tokens";

export class DatabaseAccessTokenStore<
	TUserId extends AccessTokenUserId = AccessTokenUserId,
> implements AccessTokenStore<TUserId>
{
	private readonly tableName: string;
	private readonly connection?: string;

	constructor(
		private readonly database: DatabaseClient,
		options: DatabaseAccessTokenStoreOptions = {},
	) {
		this.tableName = options.table ?? DEFAULT_TABLE;
		this.connection = options.connection;
	}

	async create(record: AccessTokenRecord<TUserId>): Promise<void> {
		const createdAt = record.createdAt;

		await this.database
			.table<AccessTokenRow>(this.tableName, this.connection)
			.insert({
				identifier: record.identifier,
				tokenable_id: record.tokenableId,
				type: record.type,
				name: record.name ?? null,
				token_hash: record.tokenHash,
				abilities: JSON.stringify(record.abilities),
				created_at: createdAt,
				updated_at: record.updatedAt ?? createdAt,
				last_used_at: record.lastUsedAt ?? null,
				expires_at: record.expiresAt ?? null,
			});
	}

	async find(identifier: string): Promise<AccessTokenRecord<TUserId> | null> {
		const row = await this.database
			.table<AccessTokenRow>(this.tableName, this.connection)
			.where("identifier", identifier)
			.first();

		return row ? toAccessTokenRecord<TUserId>(row) : null;
	}

	async delete(identifier: string): Promise<void> {
		await this.database
			.table<AccessTokenRow>(this.tableName, this.connection)
			.where("identifier", identifier)
			.delete();
	}

	async updateLastUsedAt(identifier: string, date: Date): Promise<void> {
		await this.database
			.table<AccessTokenRow>(this.tableName, this.connection)
			.where("identifier", identifier)
			.update({
				last_used_at: date,
				updated_at: date,
			});
	}
}

function toAccessTokenRecord<TUserId extends AccessTokenUserId>(
	row: AccessTokenRow,
): AccessTokenRecord<TUserId> {
	return {
		identifier: row.identifier,
		tokenableId: readUserId<TUserId>(row.tokenable_id),
		type: row.type,
		name: row.name ?? undefined,
		tokenHash: row.token_hash,
		abilities: readAbilities(row.abilities),
		createdAt: readDate(row.created_at, "created_at"),
		updatedAt: readOptionalDate(row.updated_at, "updated_at"),
		lastUsedAt: readOptionalDate(row.last_used_at, "last_used_at"),
		expiresAt: readOptionalDate(row.expires_at, "expires_at"),
	};
}

function readUserId<TUserId extends AccessTokenUserId>(
	value: QueryPrimitive,
): TUserId {
	if (
		typeof value !== "string" &&
		typeof value !== "number" &&
		typeof value !== "bigint"
	) {
		throw new Error("Access token row has an invalid tokenable_id");
	}

	return value as TUserId;
}

function readAbilities(value: string): readonly string[] {
	const parsed = JSON.parse(value) as unknown;

	if (
		!Array.isArray(parsed) ||
		!parsed.every((entry): entry is string => typeof entry === "string")
	) {
		throw new Error("Access token row has invalid abilities");
	}

	return parsed;
}

function readOptionalDate(
	value: Date | string | null | undefined,
	column: string,
): Date | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}

	return readDate(value, column);
}

function readDate(value: Date | string, column: string): Date {
	if (value instanceof Date) {
		return new Date(value.getTime());
	}

	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		throw new Error(`Access token row has an invalid ${column} date`);
	}

	return date;
}

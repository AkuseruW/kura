import { SQL } from "bun";
import type {
	DatabaseConnection,
	DatabaseConnectionConfig,
	DatabaseConnectionTransactionCallback,
	DatabaseDriver,
	QueryBindings,
	QueryResult,
	QueryRow,
} from "./Database";

export type PostgresDatabaseConnectionConfig = DatabaseConnectionConfig & {
	readonly driver: "postgres";
	readonly url?: string;
	readonly hostname?: string;
	readonly host?: string;
	readonly port?: string | number;
	readonly username?: string;
	readonly user?: string;
	readonly password?: string;
	readonly pass?: string;
	readonly database?: string;
	readonly db?: string;
	readonly max?: number;
	readonly idleTimeout?: number;
	readonly connectionTimeout?: number;
	readonly maxLifetime?: number;
	readonly tls?: boolean;
	readonly ssl?: boolean;
	readonly bigint?: boolean;
	readonly prepare?: boolean;
	readonly connection?: Record<string, string | boolean | number>;
};

export type PostgresSqlOptions = SQL.Options & {
	readonly adapter: "postgres";
};

export type PostgresSqlClient = {
	unsafe<TRow extends QueryRow = QueryRow>(
		sql: string,
		bindings?: unknown[],
	): Promise<readonly TRow[]>;
	begin<TResult>(
		callback: (client: PostgresSqlClient) => TResult | Promise<TResult>,
	): Promise<TResult>;
	close(options?: { readonly timeout?: number }): Promise<void>;
};

export type PostgresSqlClientFactory = (
	options: PostgresSqlOptions,
) => PostgresSqlClient;

export class PostgresDatabaseDriver implements DatabaseDriver {
	constructor(
		private readonly createClient: PostgresSqlClientFactory = (options) =>
			new SQL(options),
	) {}

	connect(
		name: string,
		config: DatabaseConnectionConfig,
	): PostgresDatabaseConnection {
		return new PostgresDatabaseConnection(
			this.createClient(readPostgresOptions(name, config)),
		);
	}
}

export class PostgresDatabaseConnection implements DatabaseConnection {
	constructor(private readonly client: PostgresSqlClient) {}

	async query<TRow extends QueryRow = QueryRow>(
		sql: string,
		bindings: QueryBindings = [],
	): Promise<QueryResult<TRow>> {
		const rows = await this.client.unsafe<TRow>(
			compilePostgresPlaceholders(sql),
			serializeBindings(bindings),
		);
		const result: QueryResult<TRow> = {
			rows,
			affectedRows: rows.length,
		};
		const insertId = readInsertId(sql, rows);

		if (insertId !== undefined) {
			return {
				...result,
				insertId,
			};
		}

		return result;
	}

	transaction<TResult>(
		callback: DatabaseConnectionTransactionCallback<TResult>,
	): Promise<TResult> {
		return this.client.begin((client) =>
			callback(new PostgresDatabaseConnection(client)),
		);
	}

	close(): Promise<void> {
		return this.client.close({ timeout: 0 });
	}
}

function readPostgresOptions(
	connectionName: string,
	config: DatabaseConnectionConfig,
): PostgresSqlOptions {
	const options: PostgresSqlOptions = {
		adapter: "postgres",
	};

	assignStringOption(options, "url", config, connectionName);
	assignStringOption(options, "hostname", config, connectionName);
	assignStringOption(options, "host", config, connectionName);
	assignStringOrNumberOption(options, "port", config, connectionName);
	assignStringOption(options, "username", config, connectionName);
	assignStringOption(options, "user", config, connectionName);
	assignStringOption(options, "password", config, connectionName);
	assignStringOption(options, "pass", config, connectionName);
	assignStringOption(options, "database", config, connectionName);
	assignStringOption(options, "db", config, connectionName);
	assignNumberOption(options, "max", config);
	assignNumberOption(options, "idleTimeout", config);
	assignNumberOption(options, "connectionTimeout", config);
	assignNumberOption(options, "maxLifetime", config);
	assignBooleanOption(options, "tls", config);
	assignBooleanOption(options, "ssl", config);
	assignBooleanOption(options, "bigint", config);
	assignBooleanOption(options, "prepare", config);
	assignConnectionOption(options, config);

	if (!hasPostgresConnectionTarget(options)) {
		throw new Error(
			`Postgres connection [${connectionName}] requires a url, hostname, host, database, or db option`,
		);
	}

	return options;
}

function assignStringOption<TKey extends keyof PostgresSqlOptions>(
	options: PostgresSqlOptions,
	key: TKey,
	config: DatabaseConnectionConfig,
	connectionName: string,
): void {
	const value = config[key];

	if (value === undefined) {
		return;
	}

	if (typeof value !== "string") {
		throw new Error(`Postgres database option [${key}] must be a string`);
	}

	if (value.trim() !== value || value.length === 0) {
		throw new Error(
			`Postgres connection [${connectionName}] option [${key}] cannot be empty or padded`,
		);
	}

	Object.assign(options, { [key]: value });
}

function assignStringOrNumberOption<TKey extends keyof PostgresSqlOptions>(
	options: PostgresSqlOptions,
	key: TKey,
	config: DatabaseConnectionConfig,
	connectionName: string,
): void {
	const value = config[key];

	if (value === undefined) {
		return;
	}

	if (typeof value === "number") {
		if (!Number.isInteger(value) || value < 1) {
			throw new Error(
				`Postgres database option [${key}] must be a positive integer`,
			);
		}

		Object.assign(options, { [key]: value });
		return;
	}

	if (
		typeof value !== "string" ||
		value.trim() !== value ||
		value.length === 0
	) {
		throw new Error(
			`Postgres connection [${connectionName}] option [${key}] must be a non-empty string or positive integer`,
		);
	}

	Object.assign(options, { [key]: value });
}

function assignNumberOption<TKey extends keyof PostgresSqlOptions>(
	options: PostgresSqlOptions,
	key: TKey,
	config: DatabaseConnectionConfig,
): void {
	const value = config[key];

	if (value === undefined) {
		return;
	}

	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(
			`Postgres database option [${key}] must be a non-negative number`,
		);
	}

	Object.assign(options, { [key]: value });
}

function assignBooleanOption<TKey extends keyof PostgresSqlOptions>(
	options: PostgresSqlOptions,
	key: TKey,
	config: DatabaseConnectionConfig,
): void {
	const value = config[key];

	if (value === undefined) {
		return;
	}

	if (typeof value !== "boolean") {
		throw new Error(`Postgres database option [${key}] must be a boolean`);
	}

	Object.assign(options, { [key]: value });
}

function assignConnectionOption(
	options: PostgresSqlOptions,
	config: DatabaseConnectionConfig,
): void {
	const value = config.connection;

	if (value === undefined) {
		return;
	}

	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Postgres database option [connection] must be an object");
	}

	const connection: Record<string, string | boolean | number> = {};

	for (const [key, entry] of Object.entries(value)) {
		if (
			typeof entry !== "string" &&
			typeof entry !== "boolean" &&
			typeof entry !== "number"
		) {
			throw new Error(
				"Postgres database option [connection] values must be strings, booleans, or numbers",
			);
		}

		connection[key] = entry;
	}

	options.connection = connection;
}

function hasPostgresConnectionTarget(options: PostgresSqlOptions): boolean {
	return (
		options.url !== undefined ||
		options.hostname !== undefined ||
		options.host !== undefined ||
		options.database !== undefined ||
		options.db !== undefined
	);
}

function serializeBindings(bindings: QueryBindings): unknown[] {
	return bindings.map((binding) => binding);
}

function compilePostgresPlaceholders(sql: string): string {
	let parameterIndex = 0;
	let compiled = "";
	let index = 0;
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let inLineComment = false;
	let inBlockComment = false;
	let dollarQuoteTag: string | null = null;

	while (index < sql.length) {
		const character = sql[index];
		const next = sql[index + 1];

		if (dollarQuoteTag) {
			if (sql.startsWith(dollarQuoteTag, index)) {
				compiled += dollarQuoteTag;
				index += dollarQuoteTag.length;
				dollarQuoteTag = null;
				continue;
			}

			compiled += character;
			index += 1;
			continue;
		}

		if (inLineComment) {
			compiled += character;
			index += 1;

			if (character === "\n") {
				inLineComment = false;
			}

			continue;
		}

		if (inBlockComment) {
			compiled += character;
			index += 1;

			if (character === "*" && next === "/") {
				compiled += next;
				index += 1;
				inBlockComment = false;
			}

			continue;
		}

		if (inSingleQuote) {
			compiled += character;
			index += 1;

			if (character === "'" && next === "'") {
				compiled += next;
				index += 1;
				continue;
			}

			if (character === "'") {
				inSingleQuote = false;
			}

			continue;
		}

		if (inDoubleQuote) {
			compiled += character;
			index += 1;

			if (character === '"' && next === '"') {
				compiled += next;
				index += 1;
				continue;
			}

			if (character === '"') {
				inDoubleQuote = false;
			}

			continue;
		}

		const dollarTag = readDollarQuoteTag(sql, index);
		if (dollarTag) {
			compiled += dollarTag;
			index += dollarTag.length;
			dollarQuoteTag = dollarTag;
			continue;
		}

		if (character === "-" && next === "-") {
			compiled += `${character}${next}`;
			index += 2;
			inLineComment = true;
			continue;
		}

		if (character === "/" && next === "*") {
			compiled += `${character}${next}`;
			index += 2;
			inBlockComment = true;
			continue;
		}

		if (character === "'") {
			compiled += character;
			index += 1;
			inSingleQuote = true;
			continue;
		}

		if (character === '"') {
			compiled += character;
			index += 1;
			inDoubleQuote = true;
			continue;
		}

		if (character === "?") {
			parameterIndex += 1;
			compiled += `$${parameterIndex}`;
			index += 1;
			continue;
		}

		compiled += character;
		index += 1;
	}

	return compiled;
}

function readDollarQuoteTag(sql: string, start: number): string | null {
	if (sql[start] !== "$") {
		return null;
	}

	let index = start + 1;

	while (index < sql.length) {
		const character = sql[index];

		if (character === "$") {
			return sql.slice(start, index + 1);
		}

		if (!/[A-Za-z0-9_]/.test(character ?? "")) {
			return null;
		}

		index += 1;
	}

	return null;
}

function readInsertId(
	sql: string,
	rows: readonly QueryRow[],
): string | number | bigint | undefined {
	if (!sql.trimStart().toLowerCase().startsWith("insert ")) {
		return undefined;
	}

	const id = rows[0]?.id;

	if (isInsertId(id)) {
		return id;
	}

	return undefined;
}

function isInsertId(value: unknown): value is string | number | bigint {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "bigint"
	);
}

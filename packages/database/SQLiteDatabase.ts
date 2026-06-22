import {
	Database as BunSQLiteDatabase,
	type DatabaseOptions,
	type SQLQueryBindings,
} from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
	DatabaseConnection,
	DatabaseConnectionConfig,
	DatabaseDriver,
	QueryBindings,
	QueryPrimitive,
	QueryResult,
	QueryRow,
} from "./Database";

type SQLiteBinding = Exclude<SQLQueryBindings, Record<string, unknown>>;
type SQLiteBooleanOption =
	| "create"
	| "readonly"
	| "readwrite"
	| "safeIntegers"
	| "strict";

export type SQLiteDatabaseConnectionConfig = DatabaseConnectionConfig & {
	readonly driver: "sqlite";
	readonly filename: string;
	readonly create?: boolean;
	readonly readonly?: boolean;
	readonly readwrite?: boolean;
	readonly safeIntegers?: boolean;
	readonly strict?: boolean;
};

export class SQLiteDatabaseDriver implements DatabaseDriver {
	connect(
		name: string,
		config: DatabaseConnectionConfig,
	): SQLiteDatabaseConnection {
		const filename = readFilename(name, config);
		const options = readDatabaseOptions(config);

		if (options.create !== false && filename !== ":memory:") {
			mkdirSync(dirname(resolve(filename)), { recursive: true });
		}

		return new SQLiteDatabaseConnection(
			new BunSQLiteDatabase(filename, options),
		);
	}
}

export class SQLiteDatabaseConnection implements DatabaseConnection {
	constructor(private readonly database: BunSQLiteDatabase) {}

	async query<TRow extends QueryRow = QueryRow>(
		sql: string,
		bindings: QueryBindings = [],
	): Promise<QueryResult<TRow>> {
		const sqliteBindings = serializeBindings(bindings);
		const statement = this.database.query<TRow, SQLiteBinding[]>(sql);

		if (returnsRows(sql)) {
			return {
				rows: statement.all(...sqliteBindings),
				affectedRows: 0,
			};
		}

		const result = statement.run(...sqliteBindings);
		const queryResult: QueryResult<TRow> = {
			rows: [],
			affectedRows: result.changes,
		};

		if (isInsertQuery(sql)) {
			return {
				...queryResult,
				insertId: result.lastInsertRowid,
			};
		}

		return queryResult;
	}

	close(): void {
		this.database.close(false);
	}
}

function readFilename(
	connectionName: string,
	config: DatabaseConnectionConfig,
): string {
	const filename = config.filename;

	if (typeof filename !== "string" || filename.trim() !== filename) {
		throw new Error(
			`SQLite connection [${connectionName}] requires a string filename`,
		);
	}

	if (filename.length === 0) {
		throw new Error(
			`SQLite connection [${connectionName}] requires a non-empty filename`,
		);
	}

	return filename;
}

function readDatabaseOptions(
	config: DatabaseConnectionConfig,
): DatabaseOptions {
	const readonly = readBooleanOption(config, "readonly");

	return {
		create: readBooleanOption(config, "create") ?? readonly !== true,
		readonly,
		readwrite: readBooleanOption(config, "readwrite") ?? readonly !== true,
		safeIntegers: readBooleanOption(config, "safeIntegers"),
		strict: readBooleanOption(config, "strict") ?? true,
	};
}

function readBooleanOption(
	config: DatabaseConnectionConfig,
	key: SQLiteBooleanOption,
): boolean | undefined {
	const value = config[key];

	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "boolean") {
		throw new Error(`SQLite database option [${key}] must be a boolean`);
	}

	return value;
}

function serializeBindings(bindings: QueryBindings): SQLiteBinding[] {
	return bindings.map(serializeBinding);
}

function serializeBinding(value: QueryPrimitive): SQLiteBinding {
	if (value instanceof Date) {
		return value.toISOString();
	}

	return value;
}

function returnsRows(sql: string): boolean {
	const normalized = normalizeQuery(sql);

	return (
		normalized.startsWith("select ") ||
		normalized.startsWith("with ") ||
		normalized.startsWith("pragma ") ||
		normalized.startsWith("values ") ||
		normalized.startsWith("explain ") ||
		hasReturningClause(normalized)
	);
}

function isInsertQuery(sql: string): boolean {
	const normalized = normalizeQuery(sql);

	return normalized.startsWith("insert ");
}

function hasReturningClause(normalizedSql: string): boolean {
	return (
		(normalizedSql.startsWith("insert ") ||
			normalizedSql.startsWith("update ") ||
			normalizedSql.startsWith("delete ")) &&
		normalizedSql.includes(" returning ")
	);
}

function normalizeQuery(sql: string): string {
	return sql.trimStart().toLowerCase();
}

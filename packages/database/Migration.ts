import type { DatabaseManager, QueryPrimitive, QueryRow } from "./Database";
import type { CompiledQuery } from "./QueryBuilder";

export abstract class Migration {
	abstract up(schema: SchemaBuilder): void | Promise<void>;
	abstract down(schema: SchemaBuilder): void | Promise<void>;
}

export type MigrationConstructor = new () => Migration;
export type MigrationSource = Migration | MigrationConstructor;

export type MigrationDefinition = {
	readonly name: string;
	readonly migration: MigrationSource;
};

export type MigrationRunResult = {
	readonly batch: number | null;
	readonly migrations: readonly string[];
};

export type MigrationRunnerOptions = {
	readonly table?: string;
	readonly connection?: string;
};

export type ColumnType =
	| "increments"
	| "integer"
	| "string"
	| "text"
	| "boolean"
	| "timestamp";

type TableCallback = (table: TableBuilder) => void;

type ColumnDefinition = {
	readonly name: string;
	readonly type: ColumnType;
	readonly length?: number;
	nullable: boolean;
	primary: boolean;
	unique: boolean;
	autoIncrement: boolean;
	hasDefault: boolean;
	defaultValue: QueryPrimitive;
};

type AddColumnChange = {
	readonly type: "addColumn";
	readonly column: ColumnDefinition;
};

type DropColumnChange = {
	readonly type: "dropColumn";
	readonly column: string;
};

type TableChange = AddColumnChange | DropColumnChange;

type CreateTableOperation = {
	readonly type: "createTable";
	readonly table: string;
	readonly ifNotExists: boolean;
	readonly columns: readonly ColumnDefinition[];
};

type AlterTableOperation = {
	readonly type: "alterTable";
	readonly table: string;
	readonly changes: readonly TableChange[];
};

type DropTableOperation = {
	readonly type: "dropTable";
	readonly table: string;
	readonly ifExists: boolean;
};

type SchemaOperation =
	| CreateTableOperation
	| AlterTableOperation
	| DropTableOperation;

type AppliedMigration = {
	readonly name: string;
	readonly batch: number;
};

type MigrationTableRow = QueryRow & {
	readonly name: string;
	readonly batch: number;
	readonly created_at: Date;
};

export class SchemaBuilder {
	private readonly operations: SchemaOperation[] = [];

	createTable(tableName: string, callback: TableCallback): this {
		return this.addCreateTable(tableName, false, callback);
	}

	createTableIfNotExists(tableName: string, callback: TableCallback): this {
		return this.addCreateTable(tableName, true, callback);
	}

	table(tableName: string, callback: TableCallback): this {
		const table = new TableBuilder(tableName, "alter");
		callback(table);

		const changes = table.toAlterChanges();
		if (changes.length === 0) {
			throw new Error("table() requires at least one table change");
		}

		this.operations.push({
			type: "alterTable",
			table: tableName,
			changes,
		});
		return this;
	}

	dropTable(tableName: string): this {
		this.operations.push({
			type: "dropTable",
			table: tableName,
			ifExists: false,
		});
		return this;
	}

	dropTableIfExists(tableName: string): this {
		this.operations.push({
			type: "dropTable",
			table: tableName,
			ifExists: true,
		});
		return this;
	}

	toSQL(): readonly CompiledQuery[] {
		return this.operations.flatMap((operation) =>
			compileSchemaOperation(operation),
		);
	}

	private addCreateTable(
		tableName: string,
		ifNotExists: boolean,
		callback: TableCallback,
	): this {
		const table = new TableBuilder(tableName, "create");
		callback(table);

		const columns = table.toColumns();
		if (columns.length === 0) {
			throw new Error("createTable() requires at least one column");
		}

		this.operations.push({
			type: "createTable",
			table: tableName,
			ifNotExists,
			columns,
		});
		return this;
	}
}

export class TableBuilder {
	private readonly columns: ColumnDefinition[] = [];
	private readonly changes: TableChange[] = [];

	constructor(
		tableName: string,
		private readonly mode: "create" | "alter",
	) {
		assertValidIdentifier(tableName, "table");
	}

	id(columnName = "id"): ColumnBuilder {
		return this.addColumn(columnName, "increments", {
			nullable: false,
			primary: true,
			autoIncrement: true,
		});
	}

	integer(columnName: string): ColumnBuilder {
		return this.addColumn(columnName, "integer");
	}

	string(columnName: string, length = 255): ColumnBuilder {
		if (!Number.isInteger(length) || length < 1) {
			throw new Error("string() length must be a positive integer");
		}

		return this.addColumn(columnName, "string", { length });
	}

	text(columnName: string): ColumnBuilder {
		return this.addColumn(columnName, "text");
	}

	boolean(columnName: string): ColumnBuilder {
		return this.addColumn(columnName, "boolean");
	}

	timestamp(columnName: string): ColumnBuilder {
		return this.addColumn(columnName, "timestamp");
	}

	timestamps(): this {
		this.timestamp("created_at").notNull();
		this.timestamp("updated_at").notNull();
		return this;
	}

	dropColumn(columnName: string): this {
		if (this.mode !== "alter") {
			throw new Error("dropColumn() can only be used when altering a table");
		}

		assertValidIdentifier(columnName, "column");
		this.changes.push({
			type: "dropColumn",
			column: columnName,
		});
		return this;
	}

	toColumns(): readonly ColumnDefinition[] {
		return [...this.columns];
	}

	toAlterChanges(): readonly TableChange[] {
		return [...this.changes];
	}

	private addColumn(
		columnName: string,
		type: ColumnType,
		options: Partial<
			Pick<
				ColumnDefinition,
				"autoIncrement" | "length" | "nullable" | "primary"
			>
		> = {},
	): ColumnBuilder {
		assertValidIdentifier(columnName, "column");

		const definition: ColumnDefinition = {
			name: columnName,
			type,
			length: options.length,
			nullable: options.nullable ?? true,
			primary: options.primary ?? false,
			unique: false,
			autoIncrement: options.autoIncrement ?? false,
			hasDefault: false,
			defaultValue: null,
		};

		this.columns.push(definition);

		if (this.mode === "alter") {
			this.changes.push({
				type: "addColumn",
				column: definition,
			});
		}

		return new ColumnBuilder(definition);
	}
}

export class ColumnBuilder {
	constructor(private readonly definition: ColumnDefinition) {}

	notNull(): this {
		this.definition.nullable = false;
		return this;
	}

	nullable(): this {
		this.definition.nullable = true;
		return this;
	}

	primary(): this {
		this.definition.primary = true;
		return this;
	}

	unique(): this {
		this.definition.unique = true;
		return this;
	}

	default(value: QueryPrimitive): this {
		this.definition.defaultValue = value;
		this.definition.hasDefault = true;
		return this;
	}
}

export class MigrationRunner {
	private readonly tableName: string;
	private readonly connectionName?: string;

	constructor(
		private readonly database: DatabaseManager,
		options: MigrationRunnerOptions = {},
	) {
		this.tableName = options.table ?? "kura_migrations";
		this.connectionName = options.connection;
		assertValidIdentifier(this.tableName, "migration table");
	}

	async run(
		migrations: readonly MigrationDefinition[],
	): Promise<MigrationRunResult> {
		const definitions = normalizeMigrationDefinitions(migrations);
		await this.ensureMigrationTable();

		const applied = await this.loadAppliedMigrations();
		const appliedNames = new Set(applied.map((migration) => migration.name));
		const pending = definitions.filter(
			(definition) => !appliedNames.has(definition.name),
		);

		if (pending.length === 0) {
			return {
				batch: null,
				migrations: [],
			};
		}

		const batch = getNextBatch(applied);
		const migrated: string[] = [];

		for (const definition of pending) {
			const schema = new SchemaBuilder();
			await resolveMigration(definition.migration).up(schema);
			await this.executeSchema(schema);
			await this.recordMigration(definition.name, batch);
			migrated.push(definition.name);
		}

		return {
			batch,
			migrations: migrated,
		};
	}

	async rollback(
		migrations: readonly MigrationDefinition[],
		batch?: number,
	): Promise<MigrationRunResult> {
		const definitions = normalizeMigrationDefinitions(migrations);
		await this.ensureMigrationTable();

		const applied = await this.loadAppliedMigrations();
		const targetBatch = batch ?? getLatestBatch(applied);
		if (targetBatch === null) {
			return {
				batch: null,
				migrations: [],
			};
		}

		assertPositiveInteger(targetBatch, "rollback() batch");

		const appliedInBatch = applied.filter(
			(migration) => migration.batch === targetBatch,
		);
		if (appliedInBatch.length === 0) {
			return {
				batch: targetBatch,
				migrations: [],
			};
		}

		const definitionsByName = new Map(
			definitions.map((definition) => [definition.name, definition]),
		);
		const missing = appliedInBatch.find(
			(migration) => !definitionsByName.has(migration.name),
		);

		if (missing) {
			throw new Error(
				`Migration [${missing.name}] is not registered and cannot be rolled back`,
			);
		}

		const appliedNames = new Set(
			appliedInBatch.map((migration) => migration.name),
		);
		const rollbackDefinitions = [...definitions]
			.reverse()
			.filter((definition) => appliedNames.has(definition.name));
		const rolledBack: string[] = [];

		for (const definition of rollbackDefinitions) {
			const schema = new SchemaBuilder();
			await resolveMigration(definition.migration).down(schema);
			await this.executeSchema(schema);
			await this.removeMigration(definition.name);
			rolledBack.push(definition.name);
		}

		return {
			batch: targetBatch,
			migrations: rolledBack,
		};
	}

	private async ensureMigrationTable(): Promise<void> {
		const schema = new SchemaBuilder();
		schema.createTableIfNotExists(this.tableName, (table) => {
			table.string("name").primary();
			table.integer("batch").notNull();
			table.timestamp("created_at").notNull();
		});

		await this.executeSchema(schema);
	}

	private async loadAppliedMigrations(): Promise<readonly AppliedMigration[]> {
		const result = await this.database.query(
			`select ${escapeIdentifier("name")}, ${escapeIdentifier("batch")} from ${escapeIdentifier(this.tableName)} order by ${escapeIdentifier("batch")} asc, ${escapeIdentifier("name")} asc`,
			[],
			this.connectionName,
		);

		return result.rows.map(parseAppliedMigration);
	}

	private async executeSchema(schema: SchemaBuilder): Promise<void> {
		for (const query of schema.toSQL()) {
			await this.database.query(query.sql, query.bindings, this.connectionName);
		}
	}

	private async recordMigration(name: string, batch: number): Promise<void> {
		await this.database
			.table<MigrationTableRow>(this.tableName, this.connectionName)
			.insert({
				name,
				batch,
				created_at: new Date(),
			});
	}

	private async removeMigration(name: string): Promise<void> {
		await this.database
			.table<MigrationTableRow>(this.tableName, this.connectionName)
			.where("name", name)
			.delete();
	}
}

function compileSchemaOperation(
	operation: SchemaOperation,
): readonly CompiledQuery[] {
	if (operation.type === "createTable") {
		return [compileCreateTable(operation)];
	}

	if (operation.type === "alterTable") {
		return operation.changes.map((change) =>
			compileAlterTableChange(operation.table, change),
		);
	}

	return [compileDropTable(operation)];
}

function compileCreateTable(operation: CreateTableOperation): CompiledQuery {
	const bindings: QueryPrimitive[] = [];
	const tablePrefix = operation.ifNotExists
		? "create table if not exists"
		: "create table";
	const columns = operation.columns.map((column) =>
		compileColumn(column, bindings),
	);

	return {
		sql: `${tablePrefix} ${escapeIdentifier(operation.table)} (${columns.join(", ")})`,
		bindings,
	};
}

function compileAlterTableChange(
	tableName: string,
	change: TableChange,
): CompiledQuery {
	if (change.type === "dropColumn") {
		return {
			sql: `alter table ${escapeIdentifier(tableName)} drop column ${escapeIdentifier(change.column)}`,
			bindings: [],
		};
	}

	const bindings: QueryPrimitive[] = [];
	return {
		sql: `alter table ${escapeIdentifier(tableName)} add column ${compileColumn(change.column, bindings)}`,
		bindings,
	};
}

function compileDropTable(operation: DropTableOperation): CompiledQuery {
	const prefix = operation.ifExists ? "drop table if exists" : "drop table";

	return {
		sql: `${prefix} ${escapeIdentifier(operation.table)}`,
		bindings: [],
	};
}

function compileColumn(
	column: ColumnDefinition,
	bindings: QueryPrimitive[],
): string {
	const segments = [escapeIdentifier(column.name), compileColumnType(column)];

	if (column.primary) {
		segments.push("primary key");
	}

	if (column.autoIncrement) {
		segments.push("autoincrement");
	}

	if (!column.nullable && !column.primary) {
		segments.push("not null");
	}

	if (column.unique) {
		segments.push("unique");
	}

	if (column.hasDefault) {
		segments.push("default ?");
		bindings.push(column.defaultValue);
	}

	return segments.join(" ");
}

function compileColumnType(column: ColumnDefinition): string {
	if (column.type === "increments") {
		return "integer";
	}

	if (column.type === "string") {
		return `varchar(${column.length ?? 255})`;
	}

	return column.type;
}

function normalizeMigrationDefinitions(
	migrations: readonly MigrationDefinition[],
): readonly MigrationDefinition[] {
	const names = new Set<string>();

	for (const migration of migrations) {
		if (
			migration.name.trim() !== migration.name ||
			migration.name.length === 0
		) {
			throw new Error("Migration names cannot be empty or padded");
		}

		if (names.has(migration.name)) {
			throw new Error(`Duplicate migration name [${migration.name}]`);
		}

		names.add(migration.name);
	}

	return migrations;
}

function resolveMigration(source: MigrationSource): Migration {
	if (typeof source === "function") {
		return new source();
	}

	return source;
}

function parseAppliedMigration(row: QueryRow): AppliedMigration {
	const name = row.name;
	const batch = row.batch;

	if (typeof name !== "string") {
		throw new Error("Migration table returned a row without a string name");
	}

	return {
		name,
		batch: parseBatchValue(batch),
	};
}

function parseBatchValue(value: unknown): number {
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}

	if (typeof value === "bigint" && value > 0n) {
		return Number(value);
	}

	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isInteger(parsed) && parsed > 0) {
			return parsed;
		}
	}

	throw new Error("Migration table returned an invalid batch value");
}

function getNextBatch(migrations: readonly AppliedMigration[]): number {
	return (getLatestBatch(migrations) ?? 0) + 1;
}

function getLatestBatch(
	migrations: readonly AppliedMigration[],
): number | null {
	let latest: number | null = null;

	for (const migration of migrations) {
		if (latest === null || migration.batch > latest) {
			latest = migration.batch;
		}
	}

	return latest;
}

function assertValidIdentifier(identifier: string, label: string): void {
	escapeIdentifier(identifier, label);
}

function escapeIdentifier(identifier: string, label = "identifier"): string {
	if (identifier.length === 0 || identifier.trim() !== identifier) {
		throw new Error(`Invalid ${label} [${identifier}]`);
	}

	const parts = identifier.split(".");
	if (parts.some((part) => part.length === 0 || part.trim() !== part)) {
		throw new Error(`Invalid ${label} [${identifier}]`);
	}

	return parts.map((part) => `"${part.replaceAll('"', '""')}"`).join(".");
}

function assertPositiveInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer`);
	}
}

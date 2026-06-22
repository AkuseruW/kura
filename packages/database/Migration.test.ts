import { describe, expect, test } from "bun:test";
import {
	DatabaseManager,
	type ExecutedQuery,
	type MemoryDatabaseConnection,
	MemoryDatabaseDriver,
	type QueryRow,
} from "./Database";
import {
	Migration,
	type MigrationDefinition,
	MigrationRunner,
	SchemaBuilder,
} from "./Migration";

class CreateUsers extends Migration {
	override up(schema: SchemaBuilder): void {
		schema.createTable("users", (table) => {
			table.id();
			table.string("email").notNull().unique();
			table.string("name", 120);
			table.boolean("active").notNull().default(true);
			table.timestamps();
		});
	}

	override down(schema: SchemaBuilder): void {
		schema.dropTable("users");
	}
}

class AddUserProfile extends Migration {
	override up(schema: SchemaBuilder): void {
		schema.table("users", (table) => {
			table.text("bio");
			table.string("status").notNull().default("draft");
		});
	}

	override down(schema: SchemaBuilder): void {
		schema.table("users", (table) => {
			table.dropColumn("status");
			table.dropColumn("bio");
		});
	}
}

function createDatabase(connections = ["primary"]): DatabaseManager {
	const database = new DatabaseManager({
		default: connections[0],
		connections: Object.fromEntries(
			connections.map((name) => [name, { driver: "memory" }]),
		),
	});
	database.extend("memory", new MemoryDatabaseDriver());

	return database;
}

async function memoryConnection(
	database: DatabaseManager,
	name?: string,
): Promise<MemoryDatabaseConnection> {
	return database.connection<MemoryDatabaseConnection>(name);
}

function queryResult(rows: readonly QueryRow[] = []) {
	return {
		rows,
		affectedRows: 0,
	};
}

function expectMigrationInsert(
	query: ExecutedQuery,
	name: string,
	batch: number,
): void {
	expect(query.sql).toBe(
		'insert into "kura_migrations" ("name", "batch", "created_at") values (?, ?, ?)',
	);
	expect(query.bindings[0]).toBe(name);
	expect(query.bindings[1]).toBe(batch);
	expect(query.bindings[2]).toBeInstanceOf(Date);
}

describe("SchemaBuilder", () => {
	test("builds create table SQL with column types and modifiers", () => {
		const schema = new SchemaBuilder();

		schema.createTable("users", (table) => {
			table.id();
			table.string("email").notNull().unique();
			table.string("name", 120);
			table.boolean("active").notNull().default(true);
			table.timestamps();
		});

		expect(schema.toSQL()).toEqual([
			{
				sql: 'create table "users" ("id" integer primary key autoincrement, "email" varchar(255) not null unique, "name" varchar(120), "active" boolean not null default true, "created_at" timestamp not null, "updated_at" timestamp not null)',
				bindings: [],
			},
		]);
	});

	test("builds alter and drop table SQL", () => {
		const schema = new SchemaBuilder();

		schema.table("users", (table) => {
			table.text("bio");
			table.string("status").notNull().default("draft");
			table.dropColumn("legacy_status");
		});
		schema.dropTableIfExists("old_users");

		expect(schema.toSQL()).toEqual([
			{
				sql: 'alter table "users" add column "bio" text',
				bindings: [],
			},
			{
				sql: 'alter table "users" add column "status" varchar(255) not null default \'draft\'',
				bindings: [],
			},
			{
				sql: 'alter table "users" drop column "legacy_status"',
				bindings: [],
			},
			{
				sql: 'drop table if exists "old_users"',
				bindings: [],
			},
		]);
	});

	test("quotes dotted identifiers and embedded quotes", () => {
		const schema = new SchemaBuilder();

		schema.createTableIfNotExists('tenant.user"events', (table) => {
			table.string('display"name');
		});

		expect(schema.toSQL()).toEqual([
			{
				sql: 'create table if not exists "tenant"."user""events" ("display""name" varchar(255))',
				bindings: [],
			},
		]);
	});

	test("throws for invalid schema definitions", () => {
		expect(() => new SchemaBuilder().createTable("users", () => {})).toThrow(
			"createTable() requires at least one column",
		);
		expect(() => new SchemaBuilder().table("users", () => {})).toThrow(
			"table() requires at least one table change",
		);
		expect(() =>
			new SchemaBuilder().createTable(" users", (table) => {
				table.id();
			}),
		).toThrow("Invalid table [ users]");
		expect(() =>
			new SchemaBuilder().createTable("users", (table) => {
				table.string("email", 0);
			}),
		).toThrow("string() length must be a positive integer");
		expect(() =>
			new SchemaBuilder().createTable("users", (table) => {
				table.dropColumn("email");
			}),
		).toThrow("dropColumn() can only be used when altering a table");
	});
});

describe("MigrationRunner", () => {
	const migrations: readonly MigrationDefinition[] = [
		{ name: "001_create_users", migration: CreateUsers },
		{ name: "002_add_user_profile", migration: new AddUserProfile() },
	];

	test("runs pending migrations and records a new batch", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult());
		connection.queueResult(queryResult());
		const runner = new MigrationRunner(database);

		const result = await runner.run(migrations);

		expect(result).toEqual({
			batch: 1,
			migrations: ["001_create_users", "002_add_user_profile"],
		});
		expect(connection.queries[0]).toEqual({
			sql: 'create table if not exists "kura_migrations" ("name" varchar(255) primary key, "batch" integer not null, "created_at" timestamp not null)',
			bindings: [],
		});
		expect(connection.queries[1]).toEqual({
			sql: 'select "name", "batch" from "kura_migrations" order by "batch" asc, "name" asc',
			bindings: [],
		});
		expect(connection.queries[2]).toEqual({
			sql: 'create table "users" ("id" integer primary key autoincrement, "email" varchar(255) not null unique, "name" varchar(120), "active" boolean not null default true, "created_at" timestamp not null, "updated_at" timestamp not null)',
			bindings: [],
		});
		expectMigrationInsert(
			connection.queries[3] as ExecutedQuery,
			"001_create_users",
			1,
		);
		expect(connection.queries[4]).toEqual({
			sql: 'alter table "users" add column "bio" text',
			bindings: [],
		});
		expect(connection.queries[5]).toEqual({
			sql: 'alter table "users" add column "status" varchar(255) not null default \'draft\'',
			bindings: [],
		});
		expectMigrationInsert(
			connection.queries[6] as ExecutedQuery,
			"002_add_user_profile",
			1,
		);
	});

	test("skips applied migrations and increments the next batch", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult());
		connection.queueResult({
			rows: [{ name: "001_create_users", batch: 2 }],
			affectedRows: 0,
		});
		const runner = new MigrationRunner(database);

		const result = await runner.run(migrations);

		expect(result).toEqual({
			batch: 3,
			migrations: ["002_add_user_profile"],
		});
		expect(connection.queries).toHaveLength(5);
		expect(connection.queries[2]).toEqual({
			sql: 'alter table "users" add column "bio" text',
			bindings: [],
		});
		expectMigrationInsert(
			connection.queries[4] as ExecutedQuery,
			"002_add_user_profile",
			3,
		);
	});

	test("returns an empty run result when every migration is applied", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult());
		connection.queueResult({
			rows: [
				{ name: "001_create_users", batch: 1 },
				{ name: "002_add_user_profile", batch: 1 },
			],
			affectedRows: 0,
		});
		const runner = new MigrationRunner(database);

		await expect(runner.run(migrations)).resolves.toEqual({
			batch: null,
			migrations: [],
		});
		expect(connection.queries).toHaveLength(2);
	});

	test("rolls back the latest batch in reverse definition order", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult());
		connection.queueResult({
			rows: [
				{ name: "001_create_users", batch: 1 },
				{ name: "002_add_user_profile", batch: 1 },
			],
			affectedRows: 0,
		});
		const runner = new MigrationRunner(database);

		const result = await runner.rollback(migrations);

		expect(result).toEqual({
			batch: 1,
			migrations: ["002_add_user_profile", "001_create_users"],
		});
		expect(connection.queries[2]).toEqual({
			sql: 'alter table "users" drop column "status"',
			bindings: [],
		});
		expect(connection.queries[3]).toEqual({
			sql: 'alter table "users" drop column "bio"',
			bindings: [],
		});
		expect(connection.queries[4]).toEqual({
			sql: 'delete from "kura_migrations" where "name" = ?',
			bindings: ["002_add_user_profile"],
		});
		expect(connection.queries[5]).toEqual({
			sql: 'drop table "users"',
			bindings: [],
		});
		expect(connection.queries[6]).toEqual({
			sql: 'delete from "kura_migrations" where "name" = ?',
			bindings: ["001_create_users"],
		});
	});

	test("rolls back an explicit batch only", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult());
		connection.queueResult({
			rows: [
				{ name: "001_create_users", batch: 1 },
				{ name: "002_add_user_profile", batch: 2 },
			],
			affectedRows: 0,
		});
		const runner = new MigrationRunner(database);

		const result = await runner.rollback(migrations, 2);

		expect(result).toEqual({
			batch: 2,
			migrations: ["002_add_user_profile"],
		});
		expect(connection.queries[2]).toEqual({
			sql: 'alter table "users" drop column "status"',
			bindings: [],
		});
		expect(connection.queries[3]).toEqual({
			sql: 'alter table "users" drop column "bio"',
			bindings: [],
		});
		expect(connection.queries[4]).toEqual({
			sql: 'delete from "kura_migrations" where "name" = ?',
			bindings: ["002_add_user_profile"],
		});
	});

	test("uses configured migration table and connection", async () => {
		const database = createDatabase(["primary", "analytics"]);
		const analytics = await memoryConnection(database, "analytics");
		analytics.queueResult(queryResult());
		analytics.queueResult(queryResult());
		const runner = new MigrationRunner(database, {
			table: "system.migrations",
			connection: "analytics",
		});

		await runner.run([{ name: "001_create_users", migration: CreateUsers }]);

		expect(analytics.queries[0]).toEqual({
			sql: 'create table if not exists "system"."migrations" ("name" varchar(255) primary key, "batch" integer not null, "created_at" timestamp not null)',
			bindings: [],
		});
		expect(analytics.queries[1]).toEqual({
			sql: 'select "name", "batch" from "system"."migrations" order by "batch" asc, "name" asc',
			bindings: [],
		});
		expect(analytics.queries[3]?.sql).toBe(
			'insert into "system"."migrations" ("name", "batch", "created_at") values (?, ?, ?)',
		);
		expect(await memoryConnection(database, "primary")).not.toBe(analytics);
	});

	test("reports applied and pending migration status", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult());
		connection.queueResult({
			rows: [{ name: "001_create_users", batch: 2 }],
			affectedRows: 0,
		});
		const runner = new MigrationRunner(database);

		const result = await runner.status(migrations);

		expect(result).toEqual([
			{
				name: "001_create_users",
				status: "applied",
				batch: 2,
			},
			{
				name: "002_add_user_profile",
				status: "pending",
				batch: null,
			},
		]);
		expect(connection.queries).toHaveLength(2);
	});

	test("rejects duplicate names and unknown rollback records", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		const runner = new MigrationRunner(database);

		await expect(
			runner.run([
				{ name: "001_create_users", migration: CreateUsers },
				{ name: "001_create_users", migration: CreateUsers },
			]),
		).rejects.toThrow("Duplicate migration name [001_create_users]");

		connection.queueResult(queryResult());
		connection.queueResult({
			rows: [{ name: "999_missing", batch: 1 }],
			affectedRows: 0,
		});

		await expect(runner.rollback([])).rejects.toThrow(
			"Migration [999_missing] is not registered and cannot be rolled back",
		);
	});
});

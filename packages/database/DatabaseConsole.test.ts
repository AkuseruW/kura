import { describe, expect, test } from "bun:test";
import { ConsoleKernel, MemoryConsoleOutput } from "../console/Console";
import {
	DatabaseManager,
	type ExecutedQuery,
	type MemoryDatabaseConnection,
	MemoryDatabaseDriver,
	type QueryRow,
} from "./Database";
import {
	createDatabaseCommands,
	registerDatabaseCommands,
} from "./DatabaseConsole";
import { Seeder } from "./Factory";
import {
	Migration,
	type MigrationDefinition,
	type SchemaBuilder,
} from "./Migration";

class CreateUsers extends Migration {
	override up(schema: SchemaBuilder): void {
		schema.createTable("users", (table) => {
			table.id();
			table.string("email").notNull();
		});
	}

	override down(schema: SchemaBuilder): void {
		schema.dropTable("users");
	}
}

class AddUserStatus extends Migration {
	override up(schema: SchemaBuilder): void {
		schema.table("users", (table) => {
			table.string("status").notNull().default("active");
		});
	}

	override down(schema: SchemaBuilder): void {
		schema.table("users", (table) => {
			table.dropColumn("status");
		});
	}
}

const migrations: readonly MigrationDefinition[] = [
	{ name: "001_create_users", migration: CreateUsers },
	{ name: "002_add_user_status", migration: AddUserStatus },
];

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

describe("database console commands", () => {
	test("registers the database command set", () => {
		const database = createDatabase();
		const console = new ConsoleKernel(new MemoryConsoleOutput());

		registerDatabaseCommands(console, { database, migrations });

		expect(console.list().map((command) => command.name)).toEqual([
			"db:fresh",
			"db:seed",
			"migration:rollback",
			"migration:run",
		]);
	});

	test("runs pending migrations", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult()).queueResult(queryResult());
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);

		for (const command of createDatabaseCommands({ database, migrations })) {
			console.register(command);
		}

		const exitCode = await console.run(["migration:run"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe(
			"Migrated 2 migrations in batch 1: 001_create_users, 002_add_user_status",
		);
		expect(connection.queries.at(2)?.sql).toBe(
			'create table "users" ("id" integer primary key autoincrement, "email" varchar(255) not null)',
		);
		expect((connection.queries.at(3) as ExecutedQuery).bindings[0]).toBe(
			"001_create_users",
		);
	});

	test("reports when migrations are already applied", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult()).queueResult(
			queryResult([
				{ name: "001_create_users", batch: 1 },
				{ name: "002_add_user_status", batch: 1 },
			]),
		);
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDatabaseCommands(console, { database, migrations });

		const exitCode = await console.run(["migration:run"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe("No pending migrations.");
	});

	test("rolls back the latest migration batch", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult()).queueResult(
			queryResult([
				{ name: "001_create_users", batch: 1 },
				{ name: "002_add_user_status", batch: 1 },
			]),
		);
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDatabaseCommands(console, { database, migrations });

		const exitCode = await console.run(["migration:rollback"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe(
			"Rolled back 2 migrations from batch 1: 002_add_user_status, 001_create_users",
		);
		expect(connection.queries.at(2)?.sql).toBe(
			'alter table "users" drop column "status"',
		);
		expect(connection.queries.at(4)?.sql).toBe('drop table "users"');
	});

	test("rolls back an explicit batch", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult(queryResult()).queueResult(
			queryResult([
				{ name: "001_create_users", batch: 1 },
				{ name: "002_add_user_status", batch: 2 },
			]),
		);
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDatabaseCommands(console, { database, migrations });

		const exitCode = await console.run(["migration:rollback", "--batch", "2"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe(
			"Rolled back 1 migration from batch 2: 002_add_user_status",
		);
		expect(connection.queries.at(2)?.sql).toBe(
			'alter table "users" drop column "status"',
		);
	});

	test("passes connection and migration table options to the runner", async () => {
		const database = createDatabase(["primary", "analytics"]);
		const analytics = await memoryConnection(database, "analytics");
		analytics.queueResult(queryResult()).queueResult(queryResult());
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDatabaseCommands(console, {
			database,
			migrations: [{ name: "001_create_users", migration: CreateUsers }],
		});

		const exitCode = await console.run([
			"migration:run",
			"--connection",
			"analytics",
			"--table",
			"system.migrations",
		]);

		expect(exitCode).toBe(0);
		expect(analytics.queries[0]?.sql).toBe(
			'create table if not exists "system"."migrations" ("name" varchar(255) primary key, "batch" integer not null, "created_at" timestamp not null)',
		);
	});

	test("runs seeders", async () => {
		const events: string[] = [];
		class UsersSeeder extends Seeder {
			override run(): void {
				events.push("users");
			}
		}
		class PostsSeeder extends Seeder {
			override run(): void {
				events.push("posts");
			}
		}
		const database = createDatabase();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDatabaseCommands(console, {
			database,
			seeders: [UsersSeeder, new PostsSeeder()],
		});

		const exitCode = await console.run(["db:seed"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe("Seeded 2 seeders: UsersSeeder, PostsSeeder");
		expect(events).toEqual(["users", "posts"]);
	});

	test("refreshes migrations and optionally seeds", async () => {
		const events: string[] = [];
		class UsersSeeder extends Seeder {
			override run(): void {
				events.push("users");
			}
		}
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection
			.queueResult(queryResult())
			.queueResult(
				queryResult([
					{ name: "001_create_users", batch: 1 },
					{ name: "002_add_user_status", batch: 2 },
				]),
			)
			.queueResult(queryResult())
			.queueResult(queryResult())
			.queueResult(queryResult())
			.queueResult(queryResult([{ name: "001_create_users", batch: 1 }]));
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDatabaseCommands(console, {
			database,
			migrations,
			seeders: [UsersSeeder],
		});

		const exitCode = await console.run(["db:fresh", "--seed"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe(
			[
				"Rolled back 2 migrations: 002_add_user_status, 001_create_users",
				"Migrated 2 migrations in batch 1: 001_create_users, 002_add_user_status",
				"Seeded 1 seeder: UsersSeeder",
			].join("\n"),
		);
		expect(events).toEqual(["users"]);
	});

	test("fails invalid rollback batches", async () => {
		const database = createDatabase();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDatabaseCommands(console, { database, migrations });

		const exitCode = await console.run([
			"migration:rollback",
			"--batch",
			"zero",
		]);

		expect(exitCode).toBe(1);
		expect(output.errorText()).toBe(
			"Option [batch] must be a positive integer",
		);
	});
});

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BaseModel } from "./BaseModel";
import {
	DatabaseManager,
	type QueryPrimitive,
	type QueryRow,
} from "./Database";
import { Migration, MigrationRunner, type SchemaBuilder } from "./Migration";
import { SQLiteDatabaseDriver } from "./SQLiteDatabase";

type UserRow = QueryRow & {
	id?: number | bigint;
	email: string;
	name: string;
	active: boolean | number;
};

type SimpleUserRow = QueryRow & {
	id: number;
	name: string;
};

type EventRow = QueryRow & {
	id?: number | bigint;
	occurred_at: Date | string;
};

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

function createFilename(): string {
	const directory = mkdtempSync(join(tmpdir(), "kura-sqlite-"));
	temporaryDirectories.push(directory);

	return join(directory, "nested", "database.sqlite");
}

function createDatabase(filename: string): DatabaseManager {
	const database = new DatabaseManager({
		default: "primary",
		connections: {
			primary: {
				driver: "sqlite",
				filename,
			},
		},
	});
	database.extend("sqlite", new SQLiteDatabaseDriver());

	return database;
}

describe("SQLiteDatabaseDriver", () => {
	test("executes SQL and persists rows to a SQLite file", async () => {
		const filename = createFilename();
		const database = createDatabase(filename);

		await database.query(
			'create table "users" ("id" integer primary key autoincrement, "name" text not null)',
		);
		const insert = await database.table<QueryRow>("users").insert({
			name: "Ada",
		});
		await database.closeAll();

		const reopened = createDatabase(filename);
		const users = await reopened.table<SimpleUserRow>("users").all();

		expect(existsSync(dirname(filename))).toBe(true);
		expect(insert).toMatchObject({ affectedRows: 1, insertId: 1 });
		expect(users).toEqual([{ id: 1, name: "Ada" }]);

		await reopened.closeAll();
	});

	test("serializes Date query bindings for SQLite", async () => {
		const database = createDatabase(createFilename());
		const occurredAt = new Date("2026-01-01T00:00:00.000Z");

		await database.query(
			'create table "events" ("id" integer primary key autoincrement, "occurred_at" timestamp not null)',
		);
		await database.table<EventRow>("events").insert({
			occurred_at: occurredAt,
		});

		const event = await database.table<EventRow>("events").first();

		expect(event?.occurred_at).toBe("2026-01-01T00:00:00.000Z");

		await database.closeAll();
	});

	test("rejects SQLite connections without a filename", async () => {
		const database = new DatabaseManager({
			default: "primary",
			connections: {
				primary: {
					driver: "sqlite",
				},
			},
		});
		database.extend("sqlite", new SQLiteDatabaseDriver());

		await expect(database.connection()).rejects.toThrow(
			"SQLite connection [primary] requires a string filename",
		);
	});

	test("runs migrations against SQLite", async () => {
		class CreateUsers extends Migration {
			override up(schema: SchemaBuilder): void {
				schema.createTable("users", (table) => {
					table.id();
					table.string("email").notNull().unique();
					table.boolean("active").notNull().default(true);
					table.timestamps();
				});
			}

			override down(schema: SchemaBuilder): void {
				schema.dropTable("users");
			}
		}
		const database = createDatabase(createFilename());
		const runner = new MigrationRunner(database);

		const result = await runner.run([
			{ name: "001_create_users", migration: CreateUsers },
		]);
		const applied = await database.query<{ name: string }>(
			'select "name" from "kura_migrations" where "name" = ?',
			["001_create_users"],
		);
		const tables = await database.query<{ name: string }>(
			"select name from sqlite_master where type = ? and name = ?",
			["table", "users"],
		);

		expect(result).toEqual({
			batch: 1,
			migrations: ["001_create_users"],
		});
		expect(applied.rows).toEqual([{ name: "001_create_users" }]);
		expect(tables.rows).toEqual([{ name: "users" }]);

		await database.closeAll();
	});

	test("commits SQLite transactions", async () => {
		const database = createDatabase(createFilename());
		await database.query(
			'create table "users" ("id" integer primary key autoincrement, "name" text not null)',
		);

		await database.transaction(async (transaction) => {
			await transaction.table<SimpleUserRow>("users").insert({
				name: "Ada",
			});
		});

		const users = await database.table<SimpleUserRow>("users").all();

		expect(users).toEqual([{ id: 1, name: "Ada" }]);

		await database.closeAll();
	});

	test("rolls back SQLite transactions", async () => {
		const database = createDatabase(createFilename());
		await database.query(
			'create table "users" ("id" integer primary key autoincrement, "name" text not null)',
		);

		await expect(
			database.transaction(async (transaction) => {
				await transaction.table<SimpleUserRow>("users").insert({
					name: "Grace",
				});
				throw new Error("stop");
			}),
		).rejects.toThrow("stop");

		const users = await database.table<SimpleUserRow>("users").all();

		expect(users).toEqual([]);

		await database.closeAll();
	});

	test("lets BaseModel operations use a transaction client", async () => {
		class User extends BaseModel<UserRow> {
			static override table = "users";
			static override timestamps = false;

			declare id?: number | bigint;
			declare email: string;
			declare name: string;
			declare active: boolean | number;
		}
		const database = createDatabase(createFilename());
		await database.query(
			'create table "users" ("id" integer primary key autoincrement, "email" varchar(255) not null unique, "name" varchar(255) not null, "active" boolean not null)',
		);

		await database.transaction(async (transaction) => {
			User.useDatabase(transaction);
			await User.create({
				email: "ada@kura.dev",
				name: "Ada",
				active: true,
			});
		});

		const users = await database.table<UserRow>("users").all();

		expect(users).toEqual([
			{
				id: 1,
				email: "ada@kura.dev",
				name: "Ada",
				active: 1,
			},
		]);

		await database.closeAll();
	});

	test("persists BaseModel create, find, save, and delete operations", async () => {
		class User extends BaseModel<UserRow> {
			static override table = "users";
			static override timestamps = false;

			declare id?: number | bigint;
			declare email: string;
			declare name: string;
			declare active: boolean | number;
		}
		const database = createDatabase(createFilename());
		User.useDatabase(database);
		await database.query(
			'create table "users" ("id" integer primary key autoincrement, "email" varchar(255) not null unique, "name" varchar(255) not null, "active" boolean not null)',
		);

		const user = await User.create({
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});
		const primaryKey = user.id as QueryPrimitive;
		const found = await User.find(primaryKey);
		found?.fill({ name: "Grace" });
		await found?.save();
		const updated = await User.find(primaryKey);
		const deleted = await updated?.delete();
		const missing = await User.find(primaryKey);

		expect(user.id).toBe(1);
		expect(found?.email).toBe("ada@kura.dev");
		expect(updated?.name).toBe("Grace");
		expect(deleted).toBe(true);
		expect(missing).toBeNull();

		await database.closeAll();
	});
});

import { describe, expect, test } from "bun:test";
import {
	DatabaseManager,
	MemoryDatabaseConnection,
	MemoryDatabaseDriver,
	type QueryRow,
} from "./Database";

type UserRow = QueryRow & {
	id: number;
	name: string;
};

describe("DatabaseManager", () => {
	test("resolves and caches the default connection", async () => {
		const manager = new DatabaseManager({
			default: "primary",
			connections: {
				primary: { driver: "memory" },
			},
		});
		const driver = new MemoryDatabaseDriver();

		manager.extend("memory", driver);

		const first = await manager.connection<MemoryDatabaseConnection>();
		const second = await manager.connection<MemoryDatabaseConnection>();

		expect(first).toBe(second);
		expect(driver.connection("primary")).toBe(first);
	});

	test("uses a single configured connection as the implicit default", async () => {
		const manager = new DatabaseManager({
			connections: {
				primary: { driver: "memory" },
			},
		});
		const driver = new MemoryDatabaseDriver();

		manager.extend("memory", driver);

		const connection = await manager.connection<MemoryDatabaseConnection>();

		expect(driver.connection("primary")).toBe(connection);
	});

	test("delegates queries to the selected connection", async () => {
		const manager = new DatabaseManager({
			default: "primary",
			connections: {
				primary: { driver: "memory" },
			},
		});
		manager.extend("memory", new MemoryDatabaseDriver());

		const connection = await manager.connection<MemoryDatabaseConnection>();
		connection.queueResult<UserRow>({
			rows: [{ id: 1, name: "Ada" }],
			affectedRows: 0,
		});

		const result = await manager.query<UserRow>(
			"select * from users where id = ?",
			[1],
		);

		expect(result.rows).toEqual([{ id: 1, name: "Ada" }]);
		expect(connection.queries).toEqual([
			{
				sql: "select * from users where id = ?",
				bindings: [1],
			},
		]);
	});

	test("commits successful transactions on the selected connection", async () => {
		const manager = new DatabaseManager({
			default: "primary",
			connections: {
				primary: { driver: "memory" },
			},
		});
		manager.extend("memory", new MemoryDatabaseDriver());

		const connection = await manager.connection<MemoryDatabaseConnection>();

		const result = await manager.transaction(async (transaction) => {
			await transaction.query("insert into users (name) values (?)", ["Ada"]);
			await transaction.table<UserRow>("users").insert({
				id: 1,
				name: "Ada",
			});

			return "ok";
		});

		expect(result).toBe("ok");
		expect(connection.queries).toEqual([
			{
				sql: "begin",
				bindings: [],
			},
			{
				sql: "insert into users (name) values (?)",
				bindings: ["Ada"],
			},
			{
				sql: 'insert into "users" ("id", "name") values (?, ?)',
				bindings: [1, "Ada"],
			},
			{
				sql: "commit",
				bindings: [],
			},
		]);
	});

	test("rolls back failed transactions and rethrows the failure", async () => {
		const manager = new DatabaseManager({
			default: "primary",
			connections: {
				primary: { driver: "memory" },
			},
		});
		manager.extend("memory", new MemoryDatabaseDriver());

		const connection = await manager.connection<MemoryDatabaseConnection>();

		await expect(
			manager.transaction(async (transaction) => {
				await transaction.query("insert into users (name) values (?)", [
					"Grace",
				]);
				throw new Error("transaction failed");
			}),
		).rejects.toThrow("transaction failed");

		expect(connection.queries).toEqual([
			{
				sql: "begin",
				bindings: [],
			},
			{
				sql: "insert into users (name) values (?)",
				bindings: ["Grace"],
			},
			{
				sql: "rollback",
				bindings: [],
			},
		]);
	});

	test("prevents transaction clients from querying another connection", async () => {
		const manager = new DatabaseManager({
			default: "primary",
			connections: {
				primary: { driver: "memory" },
				analytics: { driver: "memory" },
			},
		});
		manager.extend("memory", new MemoryDatabaseDriver());

		const connection = await manager.connection<MemoryDatabaseConnection>();

		await expect(
			manager.transaction((transaction) =>
				transaction.query("select 1", [], "analytics"),
			),
		).rejects.toThrow(
			"Database transaction for connection [primary] cannot query connection [analytics]",
		);
		expect(connection.queries).toEqual([
			{
				sql: "begin",
				bindings: [],
			},
			{
				sql: "rollback",
				bindings: [],
			},
		]);
	});

	test("resolves explicitly named connections", async () => {
		const manager = new DatabaseManager({
			connections: {
				primary: { driver: "memory" },
				analytics: { driver: "memory" },
			},
		});
		const driver = new MemoryDatabaseDriver();

		manager.extend("memory", driver);

		const connection =
			await manager.connection<MemoryDatabaseConnection>("analytics");

		expect(driver.connection("analytics")).toBe(connection);
	});

	test("throws when no default connection can be inferred", async () => {
		const manager = new DatabaseManager({
			connections: {
				primary: { driver: "memory" },
				analytics: { driver: "memory" },
			},
		});

		await expect(manager.connection()).rejects.toThrow(
			"No database connection name was provided and no default connection is configured",
		);
	});

	test("throws for missing connection config", async () => {
		const manager = new DatabaseManager({ default: "primary" });

		await expect(manager.connection()).rejects.toThrow(
			"Database connection [primary] is not configured",
		);
	});

	test("throws for missing database drivers", async () => {
		const manager = new DatabaseManager({
			default: "primary",
			connections: {
				primary: { driver: "memory" },
			},
		});

		await expect(manager.connection()).rejects.toThrow(
			"Database driver [memory] is not registered for connection [primary]",
		);
	});

	test("closes one cached connection", async () => {
		const manager = new DatabaseManager({
			default: "primary",
			connections: {
				primary: { driver: "memory" },
			},
		});
		manager.extend("memory", new MemoryDatabaseDriver());

		const connection = await manager.connection<MemoryDatabaseConnection>();

		await manager.close();

		expect(connection.isClosed()).toBe(true);
		expect(await manager.connection<MemoryDatabaseConnection>()).not.toBe(
			connection,
		);
	});

	test("closes every cached connection", async () => {
		const manager = new DatabaseManager({
			connections: {
				primary: { driver: "memory" },
				analytics: { driver: "memory" },
			},
		});
		manager.extend("memory", new MemoryDatabaseDriver());

		const primary =
			await manager.connection<MemoryDatabaseConnection>("primary");
		const analytics =
			await manager.connection<MemoryDatabaseConnection>("analytics");

		await manager.closeAll();

		expect(primary.isClosed()).toBe(true);
		expect(analytics.isClosed()).toBe(true);
	});
});

describe("MemoryDatabaseConnection", () => {
	test("returns an empty result when no result is queued", async () => {
		const connection = new MemoryDatabaseConnection();

		await expect(connection.query("select 1")).resolves.toEqual({
			rows: [],
			affectedRows: 0,
		});
	});

	test("throws when querying a closed connection", async () => {
		const connection = new MemoryDatabaseConnection();

		connection.close();

		await expect(connection.query("select 1")).rejects.toThrow(
			"Cannot query a closed memory database connection",
		);
	});
});

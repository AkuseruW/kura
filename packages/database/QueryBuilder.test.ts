import { describe, expect, test } from "bun:test";
import {
	DatabaseManager,
	type MemoryDatabaseConnection,
	MemoryDatabaseDriver,
} from "./Database";

type UserRow = {
	id: number;
	name: string;
	email: string;
	age: number;
	active: boolean;
	created_at: string;
	deleted_at: string | null;
};

function createDatabase() {
	const manager = new DatabaseManager({
		default: "primary",
		connections: {
			primary: { driver: "memory" },
		},
	});
	manager.extend("memory", new MemoryDatabaseDriver());

	return manager;
}

async function memoryConnection(
	manager: DatabaseManager,
): Promise<MemoryDatabaseConnection> {
	return manager.connection<MemoryDatabaseConnection>();
}

describe("QueryBuilder", () => {
	test("compiles selected columns, where clauses, ordering, and limits", () => {
		const manager = createDatabase();

		const query = manager
			.table<UserRow>("users")
			.select("id", "email")
			.where("active", true)
			.where("age", ">=", 18)
			.orWhere("email", "like", "%@example.com")
			.orderBy("created_at", "desc")
			.limit(10)
			.toSQL();

		expect(query).toEqual({
			sql: 'select "id", "email" from "users" where "active" = ? and "age" >= ? or "email" like ? order by "created_at" desc limit 10',
			bindings: [true, 18, "%@example.com"],
		});
	});

	test("quotes dotted identifiers and escaped identifier parts", () => {
		const manager = createDatabase();

		const query = manager
			.table("tenant.users")
			.select("users.*", 'display"name')
			.where("users.id", 1)
			.toSQL();

		expect(query).toEqual({
			sql: 'select "users".*, "display""name" from "tenant"."users" where "users"."id" = ?',
			bindings: [1],
		});
	});

	test("executes all() through the database manager", async () => {
		const manager = createDatabase();
		const connection = await memoryConnection(manager);
		connection.queueResult<UserRow>({
			rows: [
				{
					id: 1,
					name: "Ada",
					email: "ada@example.com",
					age: 36,
					active: true,
					created_at: "2026-01-01",
					deleted_at: null,
				},
			],
			affectedRows: 0,
		});

		const rows = await manager
			.table<UserRow>("users")
			.where("active", true)
			.all();

		expect(rows).toEqual([
			{
				id: 1,
				name: "Ada",
				email: "ada@example.com",
				age: 36,
				active: true,
				created_at: "2026-01-01",
				deleted_at: null,
			},
		]);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "users" where "active" = ?',
				bindings: [true],
			},
		]);
	});

	test("executes queries against the selected connection name", async () => {
		const manager = new DatabaseManager({
			connections: {
				primary: { driver: "memory" },
				analytics: { driver: "memory" },
			},
		});
		const driver = new MemoryDatabaseDriver();
		manager.extend("memory", driver);
		const analytics =
			await manager.connection<MemoryDatabaseConnection>("analytics");
		analytics.queueResult<UserRow>({
			rows: [
				{
					id: 1,
					name: "Ada",
					email: "ada@example.com",
					age: 36,
					active: true,
					created_at: "2026-01-01",
					deleted_at: null,
				},
			],
			affectedRows: 0,
		});

		const rows = await manager.table<UserRow>("users", "analytics").all();

		expect(rows).toHaveLength(1);
		expect(driver.connection("primary")).toBeUndefined();
		expect(analytics.queries).toEqual([
			{
				sql: 'select * from "users"',
				bindings: [],
			},
		]);
	});

	test("executes first() with a one row limit", async () => {
		const manager = createDatabase();
		const connection = await memoryConnection(manager);
		connection.queueResult<UserRow>({
			rows: [
				{
					id: 1,
					name: "Ada",
					email: "ada@example.com",
					age: 36,
					active: true,
					created_at: "2026-01-01",
					deleted_at: null,
				},
			],
			affectedRows: 0,
		});
		connection.queueResult<UserRow>({
			rows: [],
			affectedRows: 0,
		});

		const first = await manager.table<UserRow>("users").first();
		const missing = await manager.table<UserRow>("users").first();

		expect(first?.email).toBe("ada@example.com");
		expect(missing).toBeNull();
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "users" limit 1',
				bindings: [],
			},
			{
				sql: 'select * from "users" limit 1',
				bindings: [],
			},
		]);
	});

	test("compiles array and null where values", () => {
		const manager = createDatabase();

		const query = manager
			.table<UserRow>("users")
			.where("id", "in", [1, 2])
			.where("deleted_at", null)
			.orWhere("email", "is not", null)
			.toSQL();

		expect(query).toEqual({
			sql: 'select * from "users" where "id" in (?, ?) and "deleted_at" is null or "email" is not null',
			bindings: [1, 2],
		});
	});

	test("paginates with a count query and page-limited data query", async () => {
		const manager = createDatabase();
		const connection = await memoryConnection(manager);
		const rows: UserRow[] = [
			{
				id: 11,
				name: "Ada",
				email: "ada@example.com",
				age: 36,
				active: true,
				created_at: "2026-01-01",
				deleted_at: null,
			},
			{
				id: 12,
				name: "Grace",
				email: "grace@example.com",
				age: 42,
				active: true,
				created_at: "2026-01-02",
				deleted_at: null,
			},
		];
		connection.queueResult({
			rows: [{ aggregate: 21 }],
			affectedRows: 0,
		});
		connection.queueResult<UserRow>({
			rows,
			affectedRows: 0,
		});

		const result = await manager
			.table<UserRow>("users")
			.where("active", true)
			.orderBy("id")
			.paginate(2, 10);

		expect(result).toEqual({
			data: rows,
			total: 21,
			perPage: 10,
			currentPage: 2,
			lastPage: 3,
			from: 11,
			to: 12,
		});
		expect(connection.queries).toEqual([
			{
				sql: 'select count(*) as "aggregate" from "users" where "active" = ?',
				bindings: [true],
			},
			{
				sql: 'select * from "users" where "active" = ? order by "id" asc limit 10 offset 10',
				bindings: [true],
			},
		]);
	});

	test("executes count, sum, and avg aggregates", async () => {
		const manager = createDatabase();
		const connection = await memoryConnection(manager);
		connection.queueResult({
			rows: [{ aggregate: "3" }],
			affectedRows: 0,
		});
		connection.queueResult({
			rows: [{ aggregate: 114 }],
			affectedRows: 0,
		});
		connection.queueResult({
			rows: [{ aggregate: null }],
			affectedRows: 0,
		});
		const query = manager.table<UserRow>("users").where("active", true);

		await expect(query.count()).resolves.toBe(3);
		await expect(query.sum("age")).resolves.toBe(114);
		await expect(query.avg("age")).resolves.toBeNull();
		expect(connection.queries).toEqual([
			{
				sql: 'select count(*) as "aggregate" from "users" where "active" = ?',
				bindings: [true],
			},
			{
				sql: 'select sum("age") as "aggregate" from "users" where "active" = ?',
				bindings: [true],
			},
			{
				sql: 'select avg("age") as "aggregate" from "users" where "active" = ?',
				bindings: [true],
			},
		]);
	});

	test("executes insert, update, and delete mutations", async () => {
		const manager = createDatabase();
		const connection = await memoryConnection(manager);
		connection.queueResult<UserRow>({
			rows: [],
			affectedRows: 1,
			insertId: 7,
		});
		connection.queueResult<UserRow>({
			rows: [],
			affectedRows: 1,
		});
		connection.queueResult<UserRow>({
			rows: [],
			affectedRows: 1,
		});

		const inserted = await manager.table<UserRow>("users").insert({
			name: "Ada",
			email: "ada@example.com",
			active: true,
		});
		const updated = await manager
			.table<UserRow>("users")
			.where("id", 7)
			.update({ name: "Ada Lovelace", active: false });
		const deleted = await manager
			.table<UserRow>("users")
			.where("id", 7)
			.delete();

		expect(inserted.insertId).toBe(7);
		expect(updated.affectedRows).toBe(1);
		expect(deleted.affectedRows).toBe(1);
		expect(connection.queries).toEqual([
			{
				sql: 'insert into "users" ("name", "email", "active") values (?, ?, ?)',
				bindings: ["Ada", "ada@example.com", true],
			},
			{
				sql: 'update "users" set "name" = ?, "active" = ? where "id" = ?',
				bindings: ["Ada Lovelace", false, 7],
			},
			{
				sql: 'delete from "users" where "id" = ?',
				bindings: [7],
			},
		]);
	});

	test("rejects invalid query inputs", () => {
		const manager = createDatabase();

		expect(() => manager.table<UserRow>("users").select()).toThrow(
			"select() requires at least one column",
		);
		expect(() => manager.table<UserRow>("users").limit(-1)).toThrow(
			"limit() must be a non-negative integer",
		);
		expect(() =>
			manager.table<UserRow>("users").where("id", "in", []).toSQL(),
		).toThrow("where() array values cannot be empty");
		expect(() => manager.table<UserRow>("").toSQL()).toThrow(
			"Invalid query identifier []",
		);
		expect(() => manager.table<UserRow>("users").insert({})).toThrow(
			"insert() requires at least one value",
		);
		expect(() => manager.table<UserRow>("users").update({})).toThrow(
			"update() requires at least one value",
		);
		expect(() =>
			manager
				.table<UserRow>("users")
				.insert({ name: undefined } as unknown as { name: string }),
		).toThrow("insert() values cannot contain undefined");
	});

	test("rejects invalid pagination arguments", async () => {
		const manager = createDatabase();

		await expect(manager.table<UserRow>("users").paginate(0)).rejects.toThrow(
			"paginate() page must be a positive integer",
		);
		await expect(
			manager.table<UserRow>("users").paginate(1, 0),
		).rejects.toThrow("paginate() perPage must be a positive integer");
	});
});

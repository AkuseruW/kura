import { describe, expect, test } from "bun:test";
import { DatabaseManager, type QueryRow } from "./Database";
import {
	PostgresDatabaseDriver,
	type PostgresSqlClient,
	type PostgresSqlOptions,
} from "./PostgresDatabase";

type UserRow = QueryRow & {
	readonly id: number;
	readonly email: string;
};

type CapturedQuery = {
	readonly sql: string;
	readonly bindings: readonly unknown[];
};

class FakePostgresClient implements PostgresSqlClient {
	private readonly queuedRows: QueryRow[][] = [];
	private readonly transactionClient?: PostgresSqlClient;

	readonly queries: CapturedQuery[] = [];
	readonly closeCalls: { readonly timeout?: number }[] = [];
	beginCalls = 0;

	constructor(transactionClient?: PostgresSqlClient) {
		this.transactionClient = transactionClient;
	}

	queueRows(rows: readonly QueryRow[]): this {
		this.queuedRows.push([...rows]);
		return this;
	}

	async unsafe<TRow extends QueryRow = QueryRow>(
		sql: string,
		bindings: unknown[] = [],
	): Promise<readonly TRow[]> {
		this.queries.push({ sql, bindings: [...bindings] });

		return (this.queuedRows.shift() ?? []) as readonly TRow[];
	}

	async begin<TResult>(
		callback: (client: PostgresSqlClient) => TResult | Promise<TResult>,
	): Promise<TResult> {
		this.beginCalls += 1;

		return callback(this.transactionClient ?? this);
	}

	async close(options: { readonly timeout?: number } = {}): Promise<void> {
		this.closeCalls.push(options);
	}
}

describe("PostgresDatabaseDriver", () => {
	test("creates a Bun SQL client with validated PostgreSQL options", async () => {
		const client = new FakePostgresClient();
		let capturedOptions: PostgresSqlOptions | undefined;
		const driver = new PostgresDatabaseDriver((options) => {
			capturedOptions = options;
			return client;
		});
		const manager = new DatabaseManager({
			default: "primary",
			connections: {
				primary: {
					driver: "postgres",
					url: "postgres://kura:secret@localhost:5432/kura",
					max: 5,
					prepare: false,
					connection: {
						application_name: "kura",
					},
				},
			},
		});
		manager.extend("postgres", driver);

		const connection = await manager.connection();

		expect(connection).toBeTruthy();
		expect(capturedOptions).toEqual({
			adapter: "postgres",
			url: "postgres://kura:secret@localhost:5432/kura",
			max: 5,
			prepare: false,
			connection: {
				application_name: "kura",
			},
		});
	});

	test("executes raw SQL through Bun SQL with PostgreSQL placeholders", async () => {
		const client = new FakePostgresClient().queueRows([
			{ id: 1, email: "ada@kura.dev" },
		]);
		const manager = createManager(client);

		const result = await manager.query<UserRow>(
			'select * from "users" where "email" = ? and "note" = \'?\'',
			["ada@kura.dev"],
		);

		expect(result).toEqual({
			rows: [{ id: 1, email: "ada@kura.dev" }],
			affectedRows: 1,
		});
		expect(client.queries).toEqual([
			{
				sql: 'select * from "users" where "email" = $1 and "note" = \'?\'',
				bindings: ["ada@kura.dev"],
			},
		]);
	});

	test("reads insert ids from returning rows", async () => {
		const client = new FakePostgresClient().queueRows([
			{ id: 7, email: "ada@kura.dev" },
		]);
		const manager = createManager(client);

		const result = await manager
			.table<UserRow>("users")
			.returning("id")
			.insert({
				email: "ada@kura.dev",
			});

		expect(result.insertId).toBe(7);
		expect(result.rows).toEqual([{ id: 7, email: "ada@kura.dev" }]);
		expect(client.queries).toEqual([
			{
				sql: 'insert into "users" ("email") values ($1) returning "id"',
				bindings: ["ada@kura.dev"],
			},
		]);
	});

	test("does not rewrite placeholders inside comments or dollar-quoted blocks", async () => {
		const client = new FakePostgresClient();
		const manager = createManager(client);

		await manager.query(
			[
				"select ?",
				"-- ? inside comment",
				"/* ? inside block */",
				"select $$? inside dollar quote$$",
				"select $tag$? inside tagged quote$tag$",
			].join("\n"),
			[1],
		);

		expect(client.queries[0]?.sql).toBe(
			[
				"select $1",
				"-- ? inside comment",
				"/* ? inside block */",
				"select $$? inside dollar quote$$",
				"select $tag$? inside tagged quote$tag$",
			].join("\n"),
		);
	});

	test("uses Bun SQL transaction contexts instead of pooled begin queries", async () => {
		const transactionClient = new FakePostgresClient().queueRows([
			{ id: 2, email: "grace@kura.dev" },
		]);
		const client = new FakePostgresClient(transactionClient);
		const manager = createManager(client);

		const result = await manager.transaction((transaction) =>
			transaction.query<UserRow>("select * from users where id = ?", [2]),
		);

		expect(client.beginCalls).toBe(1);
		expect(client.queries).toEqual([]);
		expect(transactionClient.queries).toEqual([
			{
				sql: "select * from users where id = $1",
				bindings: [2],
			},
		]);
		expect(result.rows).toEqual([{ id: 2, email: "grace@kura.dev" }]);
	});

	test("closes the Bun SQL client immediately", async () => {
		const client = new FakePostgresClient();
		const manager = createManager(client);

		await manager.connection();
		await manager.close();

		expect(client.closeCalls).toEqual([{ timeout: 0 }]);
	});

	test("fails invalid PostgreSQL config clearly", async () => {
		const driver = new PostgresDatabaseDriver(() => new FakePostgresClient());
		const manager = new DatabaseManager({
			default: "primary",
			connections: {
				primary: {
					driver: "postgres",
					url: "",
				},
			},
		});
		manager.extend("postgres", driver);

		await expect(manager.connection()).rejects.toThrow(
			"Postgres connection [primary] option [url] cannot be empty or padded",
		);
	});
});

function createManager(client: PostgresSqlClient): DatabaseManager {
	const manager = new DatabaseManager({
		default: "primary",
		connections: {
			primary: {
				driver: "postgres",
				url: "postgres://kura:secret@localhost:5432/kura",
			},
		},
	});
	manager.extend("postgres", new PostgresDatabaseDriver(() => client));

	return manager;
}

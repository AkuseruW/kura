import { describe, expect, test } from "bun:test";
import {
	BaseModel,
	ModelNotFoundException,
	type ModelPaginatedResult,
} from "./BaseModel";
import {
	DatabaseManager,
	type MemoryDatabaseConnection,
	MemoryDatabaseDriver,
	type QueryRow,
} from "./Database";

type UserAttributes = QueryRow & {
	id: number;
	email: string;
	name: string;
	active: boolean;
};

type SessionAttributes = QueryRow & {
	uuid: string;
	user_id: number;
};

function createDatabase(connections = ["primary"]) {
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

describe("BaseModel", () => {
	test("hydrates model instances from query results", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			declare id: number;
			declare email: string;
			declare name: string;
			declare active: boolean;
		}
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<UserAttributes>({
			rows: [
				{
					id: 1,
					email: "ada@kura.dev",
					name: "Ada",
					active: true,
				},
			],
			affectedRows: 0,
		});

		const users = await User.query()
			.where("active", true)
			.orderBy("id", "desc")
			.limit(10)
			.all();

		expect(users).toHaveLength(1);
		expect(users[0]).toBeInstanceOf(User);
		expect(users[0]?.email).toBe("ada@kura.dev");
		expect(users[0]?.getAttribute("name")).toBe("Ada");
		expect(users[0]?.toObject()).toEqual({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "users" where "active" = ? order by "id" desc limit 10',
				bindings: [true],
			},
		]);
	});

	test("finds a model by the default primary key", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			declare id: number;
			declare email: string;
			declare name: string;
			declare active: boolean;
		}
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<UserAttributes>({
			rows: [
				{
					id: 1,
					email: "ada@kura.dev",
					name: "Ada",
					active: true,
				},
			],
			affectedRows: 0,
		});
		connection.queueResult<UserAttributes>({
			rows: [],
			affectedRows: 0,
		});

		const user = await User.find(1);
		const missing = await User.find(2);

		expect(user).toBeInstanceOf(User);
		expect(user?.id).toBe(1);
		expect(missing).toBeNull();
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "users" where "id" = ? limit 1',
				bindings: [1],
			},
			{
				sql: 'select * from "users" where "id" = ? limit 1',
				bindings: [2],
			},
		]);
	});

	test("throws a model not found exception from findOrFail", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
		}
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<UserAttributes>({
			rows: [],
			affectedRows: 0,
		});

		await expect(User.findOrFail(404)).rejects.toThrow(ModelNotFoundException);
		await expect(User.findOrFail(404)).rejects.toMatchObject({
			code: "E_MODEL_NOT_FOUND",
			status: 404,
		});
	});

	test("supports custom primary keys", async () => {
		class Session extends BaseModel<SessionAttributes> {
			static override table = "sessions";
			static override primaryKey = "uuid";

			declare uuid: string;
			declare user_id: number;
		}
		const database = createDatabase();
		Session.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<SessionAttributes>({
			rows: [{ uuid: "session-1", user_id: 1 }],
			affectedRows: 0,
		});

		const session = await Session.find("session-1");

		expect(session).toBeInstanceOf(Session);
		expect(session?.uuid).toBe("session-1");
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "sessions" where "uuid" = ? limit 1',
				bindings: ["session-1"],
			},
		]);
	});

	test("uses configured model connection names", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override connection = "analytics";
		}
		const database = createDatabase(["primary", "analytics"]);
		User.useDatabase(database);
		const analytics = await memoryConnection(database, "analytics");
		analytics.queueResult<UserAttributes>({
			rows: [
				{
					id: 1,
					email: "ada@kura.dev",
					name: "Ada",
					active: true,
				},
			],
			affectedRows: 0,
		});

		const users = await User.query().all();

		expect(users).toHaveLength(1);
		expect(analytics.queries).toEqual([
			{
				sql: 'select * from "users"',
				bindings: [],
			},
		]);
	});

	test("paginates hydrated model instances", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			declare id: number;
		}
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult({
			rows: [{ aggregate: 12 }],
			affectedRows: 0,
		});
		connection.queueResult<UserAttributes>({
			rows: [
				{
					id: 11,
					email: "ada@kura.dev",
					name: "Ada",
					active: true,
				},
			],
			affectedRows: 0,
		});

		const result: ModelPaginatedResult<User> = await User.query().paginate(
			2,
			10,
		);

		expect(result.total).toBe(12);
		expect(result.data[0]).toBeInstanceOf(User);
		expect(result.data[0]?.id).toBe(11);
		expect(connection.queries).toEqual([
			{
				sql: 'select count(*) as "aggregate" from "users"',
				bindings: [],
			},
			{
				sql: 'select * from "users" limit 10 offset 10',
				bindings: [],
			},
		]);
	});

	test("fills and serializes attributes", () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			declare id: number;
			declare email: string;
			declare name: string;
			declare active: boolean;
		}

		const user = new User({ id: 1, email: "ada@kura.dev" });
		user.setAttribute("name", "Ada").setAttribute("active", true);

		expect(user.email).toBe("ada@kura.dev");
		expect(user.name).toBe("Ada");
		expect(user.toJSON()).toEqual({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});
	});

	test("throws when model database or table configuration is missing", async () => {
		class MissingDatabase extends BaseModel<UserAttributes> {
			static override table = "users";
		}
		class MissingTable extends BaseModel<UserAttributes> {}
		MissingTable.useDatabase(createDatabase());

		expect(() => MissingDatabase.query()).toThrow(
			"Database manager is not configured for model [MissingDatabase]",
		);
		await expect(MissingDatabase.find(1)).rejects.toThrow(
			"Database manager is not configured for model [MissingDatabase]",
		);
		expect(() => MissingTable.query()).toThrow(
			"Database table is not configured for model [MissingTable]",
		);
	});
});

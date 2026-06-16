import { describe, expect, test } from "bun:test";
import { BaseModel } from "./BaseModel";
import {
	DatabaseManager,
	type MemoryDatabaseConnection,
	MemoryDatabaseDriver,
	type QueryRow,
} from "./Database";
import { defineFactory, runSeeders, Seeder, SeederRunner } from "./Factory";

type UserAttributes = QueryRow & {
	id: number;
	email: string;
	name: string;
	active: boolean;
	role?: string;
};

class User extends BaseModel<UserAttributes> {
	static override table = "users";
	static override timestamps = false;

	declare id: number;
	declare email: string;
	declare name: string;
	declare active: boolean;
	declare role?: string;
}

function createDatabase(): DatabaseManager {
	const database = new DatabaseManager({
		default: "primary",
		connections: {
			primary: { driver: "memory" },
		},
	});
	database.extend("memory", new MemoryDatabaseDriver());

	return database;
}

async function memoryConnection(
	database: DatabaseManager,
): Promise<MemoryDatabaseConnection> {
	return database.connection<MemoryDatabaseConnection>();
}

function userFactory() {
	return defineFactory(User, ({ sequence }) => ({
		email: `user${sequence}@kura.dev`,
		name: `User ${sequence}`,
		active: false,
	}));
}

describe("Factory", () => {
	test("makes unsaved model instances with sequence values and overrides", async () => {
		const factory = userFactory();

		const first = await factory.make({ active: true });
		const second = await factory.make((attributes, { sequence }) => ({
			name: `${attributes.name} Override`,
			email: `override${sequence}@kura.dev`,
		}));

		expect(first).toBeInstanceOf(User);
		expect(first.isPersisted()).toBe(false);
		expect(first.toObject()).toEqual({
			email: "user1@kura.dev",
			name: "User 1",
			active: true,
		});
		expect(second.toObject()).toEqual({
			email: "override2@kura.dev",
			name: "User 2 Override",
			active: false,
		});
	});

	test("creates persisted models through BaseModel.create", async () => {
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<UserAttributes>({
			rows: [],
			affectedRows: 1,
			insertId: 12,
		});

		const user = await userFactory().create({ active: true });

		expect(user.id).toBe(12);
		expect(user.isPersisted()).toBe(true);
		expect(user.toObject()).toEqual({
			email: "user1@kura.dev",
			name: "User 1",
			active: true,
			id: 12,
		});
		expect(connection.queries).toEqual([
			{
				sql: 'insert into "users" ("email", "name", "active") values (?, ?, ?)',
				bindings: ["user1@kura.dev", "User 1", true],
			},
		]);
	});

	test("makes batches with count context and shared sequence", async () => {
		const factory = defineFactory(User, ({ sequence, index, count }) => ({
			email: `user${sequence}@kura.dev`,
			name: `User ${index + 1} of ${count}`,
			active: false,
		}));

		const first = await factory.make();
		const users = await factory.count(3).make({ active: true });

		expect(first.email).toBe("user1@kura.dev");
		expect(users.map((user) => user.toObject())).toEqual([
			{
				email: "user2@kura.dev",
				name: "User 1 of 3",
				active: true,
			},
			{
				email: "user3@kura.dev",
				name: "User 2 of 3",
				active: true,
			},
			{
				email: "user4@kura.dev",
				name: "User 3 of 3",
				active: true,
			},
		]);
	});

	test("applies named states and callback variants in order", async () => {
		const factory = userFactory()
			.state("active", { active: true })
			.state("admin", (attributes, { sequence }) => ({
				role: "admin",
				name: `${attributes.name} #${sequence}`,
			}));

		const user = await factory.apply("active", "admin").make();

		expect(user.toObject()).toEqual({
			email: "user1@kura.dev",
			name: "User 1 #1",
			active: true,
			role: "admin",
		});
	});

	test("creates batches sequentially", async () => {
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		connection
			.queueResult<UserAttributes>({
				rows: [],
				affectedRows: 1,
				insertId: 1,
			})
			.queueResult<UserAttributes>({
				rows: [],
				affectedRows: 1,
				insertId: 2,
			});

		const users = await userFactory().count(2).create({ active: true });

		expect(users.map((user) => user.id)).toEqual([1, 2]);
		expect(users.every((user) => user.isPersisted())).toBe(true);
		expect(connection.queries).toEqual([
			{
				sql: 'insert into "users" ("email", "name", "active") values (?, ?, ?)',
				bindings: ["user1@kura.dev", "User 1", true],
			},
			{
				sql: 'insert into "users" ("email", "name", "active") values (?, ?, ?)',
				bindings: ["user2@kura.dev", "User 2", true],
			},
		]);
	});

	test("validates states and counts", () => {
		const factory = userFactory();

		expect(() => factory.state("", { active: true })).toThrow(
			"Factory state name cannot be empty",
		);
		expect(() => factory.apply("missing")).toThrow(
			"Factory state [missing] is not defined",
		);
		expect(() => factory.count(-1)).toThrow(
			"count() must be a non-negative integer",
		);
		expect(() => factory.count(1.5)).toThrow(
			"count() must be a non-negative integer",
		);
	});

	test("allows empty batches", async () => {
		await expect(userFactory().count(0).make()).resolves.toEqual([]);
	});
});

describe("SeederRunner", () => {
	test("runs seeder classes and instances in order", async () => {
		const events: string[] = [];
		class UsersSeeder extends Seeder {
			override async run({ index, count }: { index: number; count: number }) {
				await Promise.resolve();
				events.push(`users:${index}/${count}`);
			}
		}
		class PostsSeeder extends Seeder {
			override run({ index, count }: { index: number; count: number }): void {
				events.push(`posts:${index}/${count}`);
			}
		}

		const result = await new SeederRunner().run([
			UsersSeeder,
			new PostsSeeder(),
		]);

		expect(result).toEqual({
			seeders: ["UsersSeeder", "PostsSeeder"],
		});
		expect(events).toEqual(["users:0/2", "posts:1/2"]);
	});

	test("seeders can create records through factories", async () => {
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		connection
			.queueResult<UserAttributes>({
				rows: [],
				affectedRows: 1,
				insertId: 1,
			})
			.queueResult<UserAttributes>({
				rows: [],
				affectedRows: 1,
				insertId: 2,
			});
		const factory = userFactory().state("active", { active: true });

		class UsersSeeder extends Seeder {
			override async run(): Promise<void> {
				await factory.apply("active").count(2).create();
			}
		}

		await expect(runSeeders([UsersSeeder])).resolves.toEqual({
			seeders: ["UsersSeeder"],
		});
		expect(connection.queries).toEqual([
			{
				sql: 'insert into "users" ("email", "name", "active") values (?, ?, ?)',
				bindings: ["user1@kura.dev", "User 1", true],
			},
			{
				sql: 'insert into "users" ("email", "name", "active") values (?, ?, ?)',
				bindings: ["user2@kura.dev", "User 2", true],
			},
		]);
	});
});

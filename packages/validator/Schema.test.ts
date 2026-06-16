import { describe, expect, test } from "bun:test";
import {
	DatabaseManager,
	type MemoryDatabaseConnection,
	MemoryDatabaseDriver,
} from "../database/Database";
import { type Infer, v } from "./Schema";

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
	? [TRight] extends [TLeft]
		? true
		: false
	: false;
type Expect<T extends true> = T;

const inferredUserSchema = v.object({
	age: v.number().integer().optional(),
	deletedAt: v.date().nullable(),
	email: v.string().email(),
	tags: v.array(v.string()),
});

type InferredUser = Infer<typeof inferredUserSchema>;
type ExpectedUser = {
	age?: number;
	deletedAt: Date | null;
	email: string;
	tags: string[];
};
type _InferredUserMatches = Expect<Equal<InferredUser, ExpectedUser>>;

const crossFieldSchema = v
	.object({
		adminCode: v.string().optional(),
		backupEmail: v.string().email().optional(),
		email: v.string().email(),
		emailConfirmation: v.string().email(),
		password: v.string(),
		passwordConfirmation: v.string().optional(),
		role: v.enum(["admin", "user"]),
	})
	.confirmed("password")
	.same("emailConfirmation", "email")
	.different("backupEmail", "email")
	.requiredIf("adminCode", "role", "admin");

type CrossFieldUser = Infer<typeof crossFieldSchema>;
type ExpectedCrossFieldUser = {
	adminCode?: string;
	backupEmail?: string;
	email: string;
	emailConfirmation: string;
	password: string;
	passwordConfirmation?: string;
	role: "admin" | "user";
};
type _CrossFieldUserMatches = Expect<
	Equal<CrossFieldUser, ExpectedCrossFieldUser>
>;

function createDatabase() {
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

describe("Schema", () => {
	test("validates primitive values", () => {
		expect(v.string().parse("kura")).toBe("kura");
		expect(v.number().parse(1)).toBe(1);
		expect(v.boolean().parse(true)).toBe(true);
	});

	test("validates string rules", () => {
		expect(v.string().email().parse("dev@kura.dev")).toBe("dev@kura.dev");
		expect(v.string().min(3).max(5).parse("kura")).toBe("kura");
		expect(v.string().regex(/^ku/).parse("kura")).toBe("kura");
		expect(v.string().url().parse("https://kura.dev/docs")).toBe(
			"https://kura.dev/docs",
		);

		expect(() => v.string().email().parse("invalid")).toThrow(
			"Validation failed for string",
		);
		expect(() => v.string().min(3).parse("ku")).toThrow(
			"Validation failed for string",
		);
		expect(() => v.string().max(3).parse("kura")).toThrow(
			"Validation failed for string",
		);
		expect(() => v.string().regex(/^ku$/).parse("kura")).toThrow(
			"Validation failed for string",
		);
		expect(() => v.string().url().parse("kura")).toThrow(
			"Validation failed for string",
		);
	});

	test("validates number rules", () => {
		expect(v.number().min(1).max(10).parse(5)).toBe(5);
		expect(v.number().integer().parse(5)).toBe(5);
		expect(v.number().positive().parse(1)).toBe(1);

		expect(() => v.number().min(3).parse(2)).toThrow(
			"Validation failed for number",
		);
		expect(() => v.number().max(3).parse(4)).toThrow(
			"Validation failed for number",
		);
		expect(() => v.number().integer().parse(1.5)).toThrow(
			"Validation failed for number",
		);
		expect(() => v.number().positive().parse(0)).toThrow(
			"Validation failed for number",
		);
	});

	test("validates arrays and objects", () => {
		const schema = v.object({
			ids: v.array(v.number()),
			name: v.string(),
		});

		expect(schema.parse({ ids: [1, 2], name: "kura" })).toEqual({
			ids: [1, 2],
			name: "kura",
		});
	});

	test("validates array rules", () => {
		expect(v.array(v.number()).min(2).max(3).parse([1, 2])).toEqual([1, 2]);
		expect(v.array(v.string()).distinct().parse(["api", "http"])).toEqual([
			"api",
			"http",
		]);

		expect(() => v.array(v.number()).min(2).parse([1])).toThrow(
			"Validation failed for array",
		);
		expect(() => v.array(v.number()).max(2).parse([1, 2, 3])).toThrow(
			"Validation failed for array",
		);
		expect(() => v.array(v.string()).distinct().parse(["api", "api"])).toThrow(
			"Validation failed for array",
		);
	});

	test("validates enum values", () => {
		const schema = v.enum(["draft", "published"]);

		expect(schema.parse("draft")).toBe("draft");
		expect(() => schema.parse("archived")).toThrow(
			"Validation failed for enum",
		);
	});

	test("parses date strings into Date instances", () => {
		const date = v.date().parse("2026-01-01");

		expect(date).toBeInstanceOf(Date);
		expect(date.toISOString()).toBe("2026-01-01T00:00:00.000Z");
	});

	test("validates date rules", () => {
		const date = v
			.date()
			.after("2026-01-01")
			.before(new Date("2026-12-31"))
			.parse("2026-06-01");

		expect(date).toBeInstanceOf(Date);
		expect(date.toISOString()).toBe("2026-06-01T00:00:00.000Z");

		expect(() => v.date().after("2026-01-01").parse("2026-01-01")).toThrow(
			"Validation failed for date",
		);
		expect(() => v.date().before("2026-01-01").parse("2026-01-01")).toThrow(
			"Validation failed for date",
		);
		expect(() => v.date().after("invalid")).toThrow(
			"Invalid date for after rule",
		);
		expect(() => v.date().parse(new Date("invalid"))).toThrow(
			"Validation failed for date",
		);
	});

	test("validates file rules", () => {
		const file = new File(["kura"], "avatar.PNG", { type: "image/png" });

		expect(
			v
				.file()
				.maxSize(4)
				.mimeTypes(["image/png"])
				.extensions([".png"])
				.parse(file),
		).toBe(file);
		expect(v.file().extensions(["png"]).parse(file)).toBe(file);

		expect(() => v.file().maxSize(3).parse(file)).toThrow(
			"Validation failed for file",
		);
		expect(() => v.file().mimeTypes(["image/jpeg"]).parse(file)).toThrow(
			"Validation failed for file",
		);
		expect(() => v.file().extensions(["jpg"]).parse(file)).toThrow(
			"Validation failed for file",
		);
		expect(() => v.file().maxSize(-1)).toThrow(
			"Invalid number for maxSize rule",
		);
	});

	test("parses optional and nullable values", () => {
		expect(v.string().optional().parse(undefined)).toBeUndefined();
		expect(v.string().optional().parse("kura")).toBe("kura");
		expect(v.date().nullable().parse(null)).toBeNull();

		expect(() => v.string().optional().parse(null)).toThrow(
			"Validation failed for string",
		);
		expect(() => v.date().nullable().parse(undefined)).toThrow(
			"Validation failed for date",
		);
	});

	test("infers and parses optional object fields", () => {
		const user: InferredUser = inferredUserSchema.parse({
			deletedAt: null,
			email: "dev@kura.dev",
			tags: ["core", "http"],
		});

		expect(user).toEqual({
			age: undefined,
			deletedAt: null,
			email: "dev@kura.dev",
			tags: ["core", "http"],
		});
	});

	test("validates confirmed object fields", () => {
		const schema = v
			.object({
				password: v.string(),
				passwordConfirmation: v.string().optional(),
			})
			.confirmed("password");

		expect(
			schema.parse({
				password: "secret",
				passwordConfirmation: "secret",
			}),
		).toEqual({
			password: "secret",
			passwordConfirmation: "secret",
		});
		expect(() => schema.parse({ password: "secret" })).toThrow(
			"Validation failed for object field [passwordConfirmation]",
		);
		expect(() =>
			schema.parse({
				password: "secret",
				passwordConfirmation: "different",
			}),
		).toThrow("Validation failed for object field [passwordConfirmation]");
	});

	test("validates explicit same and different object fields", () => {
		const schema = v
			.object({
				backupEmail: v.string().email(),
				email: v.string().email(),
				emailConfirmation: v.string().email(),
			})
			.same("emailConfirmation", "email")
			.different("backupEmail", "email");

		expect(
			schema.parse({
				backupEmail: "backup@kura.dev",
				email: "dev@kura.dev",
				emailConfirmation: "dev@kura.dev",
			}),
		).toEqual({
			backupEmail: "backup@kura.dev",
			email: "dev@kura.dev",
			emailConfirmation: "dev@kura.dev",
		});
		expect(() =>
			schema.parse({
				backupEmail: "backup@kura.dev",
				email: "dev@kura.dev",
				emailConfirmation: "other@kura.dev",
			}),
		).toThrow("Validation failed for object field [emailConfirmation]");
		expect(() =>
			schema.parse({
				backupEmail: "dev@kura.dev",
				email: "dev@kura.dev",
				emailConfirmation: "dev@kura.dev",
			}),
		).toThrow("Validation failed for object field [backupEmail]");
	});

	test("skips comparison rules when the source field is missing", () => {
		const schema = v
			.object({
				backupEmail: v.string().email().optional(),
				email: v.string().email(),
				emailConfirmation: v.string().email().optional(),
				password: v.string().optional(),
				passwordConfirmation: v.string().optional(),
			})
			.confirmed("password")
			.same("emailConfirmation", "email")
			.different("backupEmail", "email");

		expect(schema.parse({ email: "dev@kura.dev" })).toEqual({
			backupEmail: undefined,
			email: "dev@kura.dev",
			emailConfirmation: undefined,
			password: undefined,
			passwordConfirmation: undefined,
		});
	});

	test("validates conditional required object fields", () => {
		const requiredIfSchema = v
			.object({
				adminCode: v.string().optional(),
				role: v.enum(["admin", "user"]),
			})
			.requiredIf("adminCode", "role", "admin");
		const requiredWithSchema = v
			.object({
				contactMethod: v.string().optional(),
				email: v.string().email().optional(),
			})
			.requiredWith("contactMethod", "email");
		const requiredWithoutSchema = v
			.object({
				email: v.string().email().optional(),
				phone: v.string().optional(),
			})
			.requiredWithout("email", "phone");

		expect(requiredIfSchema.parse({ role: "user" })).toEqual({
			adminCode: undefined,
			role: "user",
		});
		expect(
			requiredIfSchema.parse({ adminCode: "root", role: "admin" }),
		).toEqual({
			adminCode: "root",
			role: "admin",
		});
		expect(() => requiredIfSchema.parse({ role: "admin" })).toThrow(
			"Validation failed for object field [adminCode]",
		);

		expect(requiredWithSchema.parse({})).toEqual({
			contactMethod: undefined,
			email: undefined,
		});
		expect(
			requiredWithSchema.parse({
				contactMethod: "email",
				email: "dev@kura.dev",
			}),
		).toEqual({
			contactMethod: "email",
			email: "dev@kura.dev",
		});
		expect(() => requiredWithSchema.parse({ email: "dev@kura.dev" })).toThrow(
			"Validation failed for object field [contactMethod]",
		);

		expect(requiredWithoutSchema.parse({ phone: "123456" })).toEqual({
			email: undefined,
			phone: "123456",
		});
		expect(requiredWithoutSchema.parse({ email: "dev@kura.dev" })).toEqual({
			email: "dev@kura.dev",
			phone: undefined,
		});
		expect(() => requiredWithoutSchema.parse({})).toThrow(
			"Validation failed for object field [email]",
		);
	});

	test("runs unique validation with a database manager", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult({
			rows: [{ aggregate: 0 }],
			affectedRows: 0,
		});
		connection.queueResult({
			rows: [{ aggregate: 1 }],
			affectedRows: 0,
		});
		const schema = v.string().email().unique("users", "email", { database });

		await expect(schema.parseAsync("dev@kura.dev")).resolves.toBe(
			"dev@kura.dev",
		);
		await expect(schema.parseAsync("taken@kura.dev")).rejects.toThrow(
			"Validation failed for string",
		);
		expect(connection.queries).toEqual([
			{
				sql: 'select count(*) as "aggregate" from "users" where "email" = ?',
				bindings: ["dev@kura.dev"],
			},
			{
				sql: 'select count(*) as "aggregate" from "users" where "email" = ?',
				bindings: ["taken@kura.dev"],
			},
		]);
	});

	test("runs exists validation with a database manager from context", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult({
			rows: [{ aggregate: 1 }],
			affectedRows: 0,
		});
		connection.queueResult({
			rows: [{ aggregate: 0 }],
			affectedRows: 0,
		});
		const schema = v.number().integer().exists("users", "id");

		await expect(schema.parseAsync(1, { database })).resolves.toBe(1);
		await expect(schema.parseAsync(2, { database })).rejects.toThrow(
			"Validation failed for number",
		);
		expect(connection.queries).toEqual([
			{
				sql: 'select count(*) as "aggregate" from "users" where "id" = ?',
				bindings: [1],
			},
			{
				sql: 'select count(*) as "aggregate" from "users" where "id" = ?',
				bindings: [2],
			},
		]);
	});

	test("returns booleans from validateAsync", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult({
			rows: [{ aggregate: 0 }],
			affectedRows: 0,
		});
		connection.queueResult({
			rows: [{ aggregate: 1 }],
			affectedRows: 0,
		});
		const schema = v.string().unique("users", "email", { database });

		await expect(schema.validateAsync("new@kura.dev")).resolves.toBe(true);
		await expect(schema.validateAsync("taken@kura.dev")).resolves.toBe(false);
	});

	test("runs async validation in object and array schemas", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult({
			rows: [{ aggregate: 0 }],
			affectedRows: 0,
		});
		connection.queueResult({
			rows: [{ aggregate: 1 }],
			affectedRows: 0,
		});
		const schema = v.object({
			emails: v.array(v.string().email().unique("users", "email")),
		});

		await expect(
			schema.parseAsync(
				{ emails: ["new@kura.dev", "taken@kura.dev"] },
				{ database },
			),
		).rejects.toThrow("Validation failed for string");
		expect(connection.queries).toEqual([
			{
				sql: 'select count(*) as "aggregate" from "users" where "email" = ?',
				bindings: ["new@kura.dev"],
			},
			{
				sql: 'select count(*) as "aggregate" from "users" where "email" = ?',
				bindings: ["taken@kura.dev"],
			},
		]);
	});

	test("runs cross-field rules in async object parsing", async () => {
		const database = createDatabase();
		const connection = await memoryConnection(database);
		connection.queueResult({
			rows: [{ aggregate: 0 }],
			affectedRows: 0,
		});
		connection.queueResult({
			rows: [{ aggregate: 0 }],
			affectedRows: 0,
		});
		const schema = v
			.object({
				email: v.string().email().unique("users", "email"),
				emailConfirmation: v.string().email(),
			})
			.same("emailConfirmation", "email");

		await expect(
			schema.parseAsync(
				{
					email: "dev@kura.dev",
					emailConfirmation: "dev@kura.dev",
				},
				{ database },
			),
		).resolves.toEqual({
			email: "dev@kura.dev",
			emailConfirmation: "dev@kura.dev",
		});
		await expect(
			schema.parseAsync(
				{
					email: "dev@kura.dev",
					emailConfirmation: "other@kura.dev",
				},
				{ database },
			),
		).rejects.toThrow("Validation failed for object field [emailConfirmation]");
		expect(connection.queries).toEqual([
			{
				sql: 'select count(*) as "aggregate" from "users" where "email" = ?',
				bindings: ["dev@kura.dev"],
			},
			{
				sql: 'select count(*) as "aggregate" from "users" where "email" = ?',
				bindings: ["dev@kura.dev"],
			},
		]);
	});

	test("requires parseAsync for async rules", () => {
		const database = createDatabase();
		const schema = v.object({
			email: v.string().unique("users", "email", { database }),
		});

		expect(() => schema.parse({ email: "dev@kura.dev" })).toThrow(
			"Async validation rules require parseAsync()",
		);
	});

	test("requires a database manager for database validation rules", async () => {
		await expect(
			v.string().unique("users", "email").parseAsync("dev@kura.dev"),
		).rejects.toThrow("Database manager is required for unique validation");
		await expect(
			v.number().exists("users", "id").parseAsync(1),
		).rejects.toThrow("Database manager is required for exists validation");
	});

	test("throws for invalid values", () => {
		expect(() => v.string().parse(1)).toThrow("Validation failed for string");
		expect(() => v.array(v.number()).parse([1, "2"])).toThrow(
			"Validation failed for array",
		);
	});
});

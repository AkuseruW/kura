import { describe, expect, test } from "bun:test";
import {
	BaseModel,
	belongsTo,
	column,
	hasMany,
	hasOne,
	type ManyToManyRelationOptions,
	ModelNotFoundException,
	type ModelPaginatedResult,
	manyToMany,
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
	createdAt?: Date;
	updatedAt?: Date;
	ignored?: string;
};

type SessionAttributes = QueryRow & {
	uuid: string;
	user_id: number;
};

type ContactAttributes = QueryRow & {
	id: number;
	email: string;
};

type PostAttributes = QueryRow & {
	id: number;
	userId: number | null;
	title: string;
};

type ProfileAttributes = QueryRow & {
	id: number;
	userId: number;
	bio: string;
};

type RoleAttributes = QueryRow & {
	id: number;
	name: string;
};

type PermissionAttributes = QueryRow & {
	code: string;
	label: string;
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

	test("creates models with decorated columns, timestamps, and insert ids", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			@column()
			declare email: string;

			@column()
			declare name: string;

			@column()
			declare active: boolean;

			declare id: number;
			declare createdAt: Date;
			declare updatedAt: Date;
		}
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<UserAttributes>({
			rows: [],
			affectedRows: 1,
			insertId: 12,
		});

		const user = await User.create({
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
			ignored: "not persisted",
		});

		expect(user.id).toBe(12);
		expect(user.createdAt).toBeInstanceOf(Date);
		expect(user.updatedAt).toBeInstanceOf(Date);
		expect(user.isPersisted()).toBe(true);
		expect(user.isDirty()).toBe(false);
		expect(user.getOriginal("email")).toBe("ada@kura.dev");
		expect(connection.queries).toHaveLength(1);
		expect(connection.queries[0]?.sql).toBe(
			'insert into "users" ("email", "name", "active", "createdAt", "updatedAt") values (?, ?, ?, ?, ?)',
		);
		expect(connection.queries[0]?.bindings.slice(0, 3)).toEqual([
			"ada@kura.dev",
			"Ada",
			true,
		]);
		expect(connection.queries[0]?.bindings[3]).toBeInstanceOf(Date);
		expect(connection.queries[0]?.bindings[4]).toBeInstanceOf(Date);
	});

	test("saves dirty persisted models with an updated timestamp", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			@column()
			declare name: string;

			declare id: number;
			declare updatedAt: Date;
		}
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		const originalUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
			updatedAt: originalUpdatedAt,
		});
		connection.queueResult<UserAttributes>({
			rows: [],
			affectedRows: 1,
		});

		user.setAttribute("name", "Ada Lovelace");

		expect(user.isDirty()).toBe(true);
		expect(user.isDirty("name")).toBe(true);
		await user.save();

		expect(user.isDirty()).toBe(false);
		expect(user.getOriginal("name")).toBe("Ada Lovelace");
		expect(user.updatedAt).toBeInstanceOf(Date);
		expect(user.updatedAt.getTime()).not.toBe(originalUpdatedAt.getTime());
		expect(connection.queries).toHaveLength(1);
		expect(connection.queries[0]?.sql).toBe(
			'update "users" set "name" = ?, "updatedAt" = ? where "id" = ?',
		);
		expect(connection.queries[0]?.bindings[0]).toBe("Ada Lovelace");
		expect(connection.queries[0]?.bindings[1]).toBeInstanceOf(Date);
		expect(connection.queries[0]?.bindings[2]).toBe(1);
	});

	test("does not save clean persisted models", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
		}
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});

		await user.save();

		expect(user.isDirty()).toBe(false);
		expect(connection.queries).toEqual([]);
	});

	test("deletes persisted models by primary key", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
		}
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});
		connection.queueResult<UserAttributes>({
			rows: [],
			affectedRows: 1,
		});

		await expect(user.delete()).resolves.toBe(true);

		expect(user.isPersisted()).toBe(false);
		expect(connection.queries).toEqual([
			{
				sql: 'delete from "users" where "id" = ?',
				bindings: [1],
			},
		]);
	});

	test("returns false when deleting unsaved models", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
		}
		const database = createDatabase();
		User.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = new User({ email: "ada@kura.dev" });

		await expect(user.delete()).resolves.toBe(false);

		expect(connection.queries).toEqual([]);
	});

	test("maps decorated property names to database column names", async () => {
		class Contact extends BaseModel<ContactAttributes> {
			static override table = "contacts";
			static override timestamps = false;

			@column({ name: "email_address" })
			declare email: string;

			declare id: number;
		}
		const database = createDatabase();
		Contact.useDatabase(database);
		const connection = await memoryConnection(database);
		const contact = Contact.hydrate({
			id: 1,
			email_address: "ada@kura.dev",
		} as unknown as ContactAttributes);
		connection.queueResult<ContactAttributes>({
			rows: [],
			affectedRows: 1,
		});

		contact.setAttribute("email", "ada@example.com");
		await contact.save();

		expect(contact.email).toBe("ada@example.com");
		expect(contact.getOriginal("email")).toBe("ada@example.com");
		expect(connection.queries).toEqual([
			{
				sql: 'update "contacts" set "email_address" = ? where "id" = ?',
				bindings: ["ada@example.com", 1],
			},
		]);
	});

	test("loads belongsTo relations through decorators and caches the result", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			declare id: number;
			declare email: string;
		}
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";
			static override timestamps = false;

			@belongsTo(() => User, { foreignKey: "userId" })
			declare user: User | null;

			declare id: number;
			declare userId: number;
			declare title: string;
		}
		const database = createDatabase();
		User.useDatabase(database);
		Post.useDatabase(database);
		const connection = await memoryConnection(database);
		const post: Post = Post.hydrate({
			id: 10,
			userId: 1,
			title: "Relations",
		} as PostAttributes);
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

		const user = await post.related<User>("user");
		const cached = await post.related<User>("user");

		expect(user).toBeInstanceOf(User);
		expect(user?.id).toBe(1);
		expect(post.user).toBe(user);
		expect(cached).toBe(user);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "users" where "id" = ? limit 1',
				bindings: [1],
			},
		]);
	});

	test("loads hasOne relations with mapped foreign key columns", async () => {
		class Profile extends BaseModel<ProfileAttributes> {
			static override table = "profiles";
			static override timestamps = false;

			declare id: number;

			@column({ name: "user_id" })
			declare userId: number;

			@column()
			declare bio: string;
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			@hasOne(() => Profile, { foreignKey: "userId" })
			declare profile: Profile | null;

			declare id: number;
		}
		const database = createDatabase();
		User.useDatabase(database);
		Profile.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});
		connection.queueResult<ProfileAttributes>({
			rows: [
				{
					id: 5,
					user_id: 1,
					bio: "Mathematician",
				} as unknown as ProfileAttributes,
			],
			affectedRows: 0,
		});

		const profile = await user.related<Profile>("profile");

		expect(profile).toBeInstanceOf(Profile);
		expect(profile?.userId).toBe(1);
		expect(profile?.bio).toBe("Mathematician");
		expect(user.profile).toBe(profile);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "profiles" where "user_id" = ? limit 1',
				bindings: [1],
			},
		]);
	});

	test("returns null for relations with missing local keys without querying", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
		}
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";

			@belongsTo(() => User, { foreignKey: "userId" })
			declare user: User | null;
		}
		const database = createDatabase();
		User.useDatabase(database);
		Post.useDatabase(database);
		const connection = await memoryConnection(database);
		const post: Post = Post.hydrate({
			id: 10,
			userId: null,
			title: "Draft",
		} as PostAttributes);

		const user = await post.related<User>("user");

		expect(user).toBeNull();
		expect(post.user).toBeNull();
		expect(connection.queries).toEqual([]);
	});

	test("loads relation methods that return ModelRelation instances", async () => {
		class Profile extends BaseModel<ProfileAttributes> {
			static override table = "profiles";
			static override timestamps = false;

			declare id: number;
			declare userId: number;
			declare bio: string;
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			profile() {
				return this.hasOne(Profile, { foreignKey: "userId" });
			}
		}
		const database = createDatabase();
		User.useDatabase(database);
		Profile.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});
		connection.queueResult<ProfileAttributes>({
			rows: [
				{
					id: 5,
					userId: 1,
					bio: "Mathematician",
				},
			],
			affectedRows: 0,
		});

		const profile = await user.related<Profile>("profile");

		expect(profile).toBeInstanceOf(Profile);
		expect(profile?.bio).toBe("Mathematician");
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "profiles" where "userId" = ? limit 1',
				bindings: [1],
			},
		]);
	});

	test("loads hasMany relations through decorators and caches the collection", async () => {
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";
			static override timestamps = false;

			declare id: number;

			@column({ name: "user_id" })
			declare userId: number;

			@column()
			declare title: string;
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			@hasMany(() => Post, { foreignKey: "userId" })
			declare posts: readonly Post[];

			declare id: number;
		}
		const database = createDatabase();
		User.useDatabase(database);
		Post.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});
		connection.queueResult<PostAttributes>({
			rows: [
				{
					id: 10,
					user_id: 1,
					title: "Relations",
				} as unknown as PostAttributes,
				{
					id: 11,
					user_id: 1,
					title: "Collections",
				} as unknown as PostAttributes,
			],
			affectedRows: 0,
		});

		const posts = await user.relatedMany<Post>("posts");
		const cached = await user.relatedMany<Post>("posts");

		expect(posts).toHaveLength(2);
		expect(posts[0]).toBeInstanceOf(Post);
		expect(posts[0]?.userId).toBe(1);
		expect(posts[1]?.title).toBe("Collections");
		expect(user.posts).toBe(posts);
		expect(cached).toBe(posts);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "posts" where "user_id" = ?',
				bindings: [1],
			},
		]);
	});

	test("loads hasMany relation methods", async () => {
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";
			static override timestamps = false;

			declare id: number;
			declare userId: number;
			declare title: string;
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			posts() {
				return this.hasMany(Post, { foreignKey: "userId" });
			}
		}
		const database = createDatabase();
		User.useDatabase(database);
		Post.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});
		connection.queueResult<PostAttributes>({
			rows: [
				{
					id: 10,
					userId: 1,
					title: "Relations",
				},
			],
			affectedRows: 0,
		});

		const posts = await user.relatedMany<Post>("posts");

		expect(posts).toHaveLength(1);
		expect(posts[0]).toBeInstanceOf(Post);
		expect(posts[0]?.title).toBe("Relations");
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "posts" where "userId" = ?',
				bindings: [1],
			},
		]);
	});

	test("returns an empty collection for hasMany relations with missing local keys", async () => {
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			@hasMany(() => Post, { foreignKey: "userId" })
			declare posts: readonly Post[];
		}
		const database = createDatabase();
		User.useDatabase(database);
		Post.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = User.hydrate({
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		} as UserAttributes);

		const posts = await user.relatedMany<Post>("posts");

		expect(posts).toEqual([]);
		expect(user.posts).toBe(posts);
		expect(connection.queries).toEqual([]);
	});

	test("rejects loading collection relations through related()", async () => {
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			@hasMany(() => Post, { foreignKey: "userId" })
			declare posts: readonly Post[];
		}
		const database = createDatabase();
		User.useDatabase(database);
		Post.useDatabase(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});

		await expect(user.related("posts")).rejects.toThrow(
			"Relation [posts] on model [User] is a collection relation; use relatedMany()",
		);
	});

	test("loads manyToMany relations through decorators and caches the collection", async () => {
		class Role extends BaseModel<RoleAttributes> {
			static override table = "roles";
			static override timestamps = false;

			declare id: number;
			declare name: string;
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			@manyToMany(() => Role, {
				pivotTable: "role_user",
				foreignPivotKey: "user_id",
				relatedPivotKey: "role_id",
			})
			declare roles: readonly Role[];

			declare id: number;
		}
		const database = createDatabase();
		User.useDatabase(database);
		Role.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});
		connection.queueResult<QueryRow>({
			rows: [
				{ user_id: 1, role_id: 2 },
				{ user_id: 1, role_id: 3 },
			],
			affectedRows: 0,
		});
		connection.queueResult<RoleAttributes>({
			rows: [
				{ id: 3, name: "editor" },
				{ id: 2, name: "admin" },
			],
			affectedRows: 0,
		});

		const roles = await user.relatedMany<Role>("roles");
		const cached = await user.relatedMany<Role>("roles");

		expect(roles.map((role) => role.name)).toEqual(["admin", "editor"]);
		expect(user.roles).toBe(roles);
		expect(cached).toBe(roles);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "role_user" where "user_id" = ?',
				bindings: [1],
			},
			{
				sql: 'select * from "roles" where "id" in (?, ?)',
				bindings: [2, 3],
			},
		]);
	});

	test("loads manyToMany relation methods with custom keys", async () => {
		class Permission extends BaseModel<PermissionAttributes> {
			static override table = "permissions";
			static override primaryKey = "code";
			static override timestamps = false;

			declare code: string;
			declare label: string;
		}
		class Team extends BaseModel<QueryRow> {
			static override table = "teams";
			static override primaryKey = "uuid";
			static override timestamps = false;

			declare uuid: string;

			permissions() {
				return this.manyToMany(Permission, {
					pivotTable: "permission_team",
					foreignPivotKey: "team_uuid",
					relatedPivotKey: "permission_code",
					localKey: "uuid",
					relatedKey: "code",
				});
			}
		}
		const database = createDatabase();
		Team.useDatabase(database);
		Permission.useDatabase(database);
		const connection = await memoryConnection(database);
		const team = Team.hydrate({
			uuid: "team-1",
			name: "Core",
		});
		connection.queueResult<QueryRow>({
			rows: [
				{ team_uuid: "team-1", permission_code: "deploy" },
				{ team_uuid: "team-1", permission_code: "review" },
			],
			affectedRows: 0,
		});
		connection.queueResult<PermissionAttributes>({
			rows: [
				{ code: "review", label: "Review pull requests" },
				{ code: "deploy", label: "Deploy releases" },
			],
			affectedRows: 0,
		});

		const permissions = await team.relatedMany<Permission>("permissions");

		expect(permissions.map((permission) => permission.code)).toEqual([
			"deploy",
			"review",
		]);
		expect(
			(
				team as unknown as {
					readonly permissions: readonly Permission[];
				}
			).permissions,
		).toBe(permissions);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "permission_team" where "team_uuid" = ?',
				bindings: ["team-1"],
			},
			{
				sql: 'select * from "permissions" where "code" in (?, ?)',
				bindings: ["deploy", "review"],
			},
		]);
	});

	test("returns an empty collection for manyToMany relations with missing local keys", async () => {
		class Role extends BaseModel<RoleAttributes> {
			static override table = "roles";
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			@manyToMany(() => Role, {
				pivotTable: "role_user",
				foreignPivotKey: "user_id",
				relatedPivotKey: "role_id",
			})
			declare roles: readonly Role[];
		}
		const database = createDatabase();
		User.useDatabase(database);
		Role.useDatabase(database);
		const connection = await memoryConnection(database);
		const user = User.hydrate({
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		} as UserAttributes);

		const roles = await user.relatedMany<Role>("roles");

		expect(roles).toEqual([]);
		expect(user.roles).toBe(roles);
		expect(connection.queries).toEqual([]);
	});

	test("rejects loading manyToMany relations through related()", async () => {
		class Role extends BaseModel<RoleAttributes> {
			static override table = "roles";
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			@manyToMany(() => Role, {
				pivotTable: "role_user",
				foreignPivotKey: "user_id",
				relatedPivotKey: "role_id",
			})
			declare roles: readonly Role[];
		}
		const database = createDatabase();
		User.useDatabase(database);
		Role.useDatabase(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});

		await expect(user.related("roles")).rejects.toThrow(
			"Relation [roles] on model [User] is a collection relation; use relatedMany()",
		);
	});

	test("preloads belongsTo relations in batches and caches the result", async () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			declare id: number;
			declare email: string;
			declare name: string;
			declare active: boolean;
		}
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";
			static override timestamps = false;

			@belongsTo(() => User, { foreignKey: "userId" })
			declare user: User | null;

			declare id: number;
			declare userId: number | null;
			declare title: string;
		}
		const database = createDatabase();
		User.useDatabase(database);
		Post.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<PostAttributes>({
			rows: [
				{ id: 10, userId: 1, title: "Relations" },
				{ id: 11, userId: 2, title: "Preloads" },
				{ id: 12, userId: null, title: "Draft" },
			],
			affectedRows: 0,
		});
		connection.queueResult<UserAttributes>({
			rows: [
				{
					id: 1,
					email: "ada@kura.dev",
					name: "Ada",
					active: true,
				},
				{
					id: 2,
					email: "grace@kura.dev",
					name: "Grace",
					active: true,
				},
			],
			affectedRows: 0,
		});

		const posts = await Post.query().preload("user").orderBy("id").all();
		const cached = await posts[0]?.related<User>("user");

		expect(posts).toHaveLength(3);
		expect(posts[0]?.user).toBeInstanceOf(User);
		expect(posts[0]?.user?.name).toBe("Ada");
		expect(posts[1]?.user?.name).toBe("Grace");
		expect(posts[2]?.user).toBeNull();
		expect(cached).toBe(posts[0]?.user);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "posts" order by "id" asc',
				bindings: [],
			},
			{
				sql: 'select * from "users" where "id" in (?, ?)',
				bindings: [1, 2],
			},
		]);
	});

	test("preloads hasOne and hasMany relations in batches", async () => {
		class Profile extends BaseModel<ProfileAttributes> {
			static override table = "profiles";
			static override timestamps = false;

			declare id: number;
			declare userId: number;
			declare bio: string;
		}
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";
			static override timestamps = false;

			declare id: number;

			@column({ name: "user_id" })
			declare userId: number;

			@column()
			declare title: string;
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			@hasOne(() => Profile, { foreignKey: "userId" })
			declare profile: Profile | null;

			@hasMany(() => Post, { foreignKey: "userId" })
			declare posts: readonly Post[];

			declare id: number;
			declare email: string;
			declare name: string;
			declare active: boolean;
		}
		const database = createDatabase();
		User.useDatabase(database);
		Profile.useDatabase(database);
		Post.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<UserAttributes>({
			rows: [
				{
					id: 1,
					email: "ada@kura.dev",
					name: "Ada",
					active: true,
				},
				{
					id: 2,
					email: "grace@kura.dev",
					name: "Grace",
					active: true,
				},
			],
			affectedRows: 0,
		});
		connection.queueResult<ProfileAttributes>({
			rows: [{ id: 5, userId: 1, bio: "Mathematician" }],
			affectedRows: 0,
		});
		connection.queueResult<PostAttributes>({
			rows: [
				{
					id: 10,
					user_id: 1,
					title: "Relations",
				} as unknown as PostAttributes,
				{
					id: 11,
					user_id: 1,
					title: "Collections",
				} as unknown as PostAttributes,
				{
					id: 12,
					user_id: 2,
					title: "Preloads",
				} as unknown as PostAttributes,
			],
			affectedRows: 0,
		});

		const users = await User.query().preload("profile").preload("posts").all();
		const cachedProfile = await users[0]?.related<Profile>("profile");
		const cachedPosts = await users[0]?.relatedMany<Post>("posts");

		expect(users[0]?.profile).toBeInstanceOf(Profile);
		expect(users[0]?.profile?.bio).toBe("Mathematician");
		expect(users[1]?.profile).toBeNull();
		expect(users[0]?.posts.map((post) => post.title)).toEqual([
			"Relations",
			"Collections",
		]);
		expect(users[1]?.posts.map((post) => post.title)).toEqual(["Preloads"]);
		expect(cachedProfile).toBe(users[0]?.profile);
		expect(cachedPosts).toBe(users[0]?.posts);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "users"',
				bindings: [],
			},
			{
				sql: 'select * from "profiles" where "userId" in (?, ?)',
				bindings: [1, 2],
			},
			{
				sql: 'select * from "posts" where "user_id" in (?, ?)',
				bindings: [1, 2],
			},
		]);
	});

	test("preloads relations on first and paginated results", async () => {
		class Profile extends BaseModel<ProfileAttributes> {
			static override table = "profiles";
			static override timestamps = false;

			declare id: number;
			declare userId: number;
			declare bio: string;
		}
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";
			static override timestamps = false;

			declare id: number;
			declare userId: number;
			declare title: string;
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			@hasOne(() => Profile, { foreignKey: "userId" })
			declare profile: Profile | null;

			@hasMany(() => Post, { foreignKey: "userId" })
			declare posts: readonly Post[];

			declare id: number;
			declare email: string;
			declare name: string;
			declare active: boolean;
		}
		const database = createDatabase();
		User.useDatabase(database);
		Profile.useDatabase(database);
		Post.useDatabase(database);
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
		connection.queueResult<PostAttributes>({
			rows: [{ id: 10, userId: 1, title: "Relations" }],
			affectedRows: 0,
		});
		connection.queueResult({
			rows: [{ aggregate: 12 }],
			affectedRows: 0,
		});
		connection.queueResult<UserAttributes>({
			rows: [
				{
					id: 2,
					email: "grace@kura.dev",
					name: "Grace",
					active: true,
				},
			],
			affectedRows: 0,
		});
		connection.queueResult<ProfileAttributes>({
			rows: [{ id: 5, userId: 2, bio: "Compiler pioneer" }],
			affectedRows: 0,
		});

		const firstUser = await User.query().preload("posts").first();
		const page = await User.query().preload("profile").paginate(2, 10);

		expect(firstUser?.posts).toHaveLength(1);
		expect(firstUser?.posts[0]?.title).toBe("Relations");
		expect(page.total).toBe(12);
		expect(page.data[0]?.profile?.bio).toBe("Compiler pioneer");
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "users" limit 1',
				bindings: [],
			},
			{
				sql: 'select * from "posts" where "userId" in (?)',
				bindings: [1],
			},
			{
				sql: 'select count(*) as "aggregate" from "users"',
				bindings: [],
			},
			{
				sql: 'select * from "users" limit 10 offset 10',
				bindings: [],
			},
			{
				sql: 'select * from "profiles" where "userId" in (?)',
				bindings: [2],
			},
		]);
	});

	test("preloads manyToMany relations in batches and caches the collection", async () => {
		class Role extends BaseModel<RoleAttributes> {
			static override table = "roles";
			static override timestamps = false;

			declare id: number;
			declare name: string;
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
			static override timestamps = false;

			@manyToMany(() => Role, {
				pivotTable: "role_user",
				foreignPivotKey: "user_id",
				relatedPivotKey: "role_id",
			})
			declare roles: readonly Role[];

			declare id: number;
			declare email: string;
			declare name: string;
			declare active: boolean;
		}
		const database = createDatabase();
		User.useDatabase(database);
		Role.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<UserAttributes>({
			rows: [
				{
					id: 1,
					email: "ada@kura.dev",
					name: "Ada",
					active: true,
				},
				{
					id: 2,
					email: "grace@kura.dev",
					name: "Grace",
					active: true,
				},
				{
					id: 3,
					email: "katherine@kura.dev",
					name: "Katherine",
					active: true,
				},
			],
			affectedRows: 0,
		});
		connection.queueResult<QueryRow>({
			rows: [
				{ user_id: 1, role_id: 2 },
				{ user_id: 1, role_id: 3 },
				{ user_id: 2, role_id: 3 },
			],
			affectedRows: 0,
		});
		connection.queueResult<RoleAttributes>({
			rows: [
				{ id: 2, name: "admin" },
				{ id: 3, name: "editor" },
			],
			affectedRows: 0,
		});

		const users = await User.query().preload("roles").all();
		const cached = await users[0]?.relatedMany<Role>("roles");

		expect(users[0]?.roles.map((role) => role.name)).toEqual([
			"admin",
			"editor",
		]);
		expect(users[1]?.roles.map((role) => role.name)).toEqual(["editor"]);
		expect(users[2]?.roles).toEqual([]);
		expect(cached).toBe(users[0]?.roles);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "users"',
				bindings: [],
			},
			{
				sql: 'select * from "role_user" where "user_id" in (?, ?, ?)',
				bindings: [1, 2, 3],
			},
			{
				sql: 'select * from "roles" where "id" in (?, ?)',
				bindings: [2, 3],
			},
		]);
	});

	test("throws for misconfigured manyToMany relations", async () => {
		class Role extends BaseModel<RoleAttributes> {
			static override table = "roles";
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			roles() {
				return this.manyToMany(
					Role,
					{} as unknown as ManyToManyRelationOptions,
				);
			}
		}
		const database = createDatabase();
		User.useDatabase(database);
		Role.useDatabase(database);
		const user = User.hydrate({
			id: 1,
			email: "ada@kura.dev",
			name: "Ada",
			active: true,
		});

		await expect(user.relatedMany("roles")).rejects.toThrow(
			"Relation [roles] is missing pivotTable",
		);
	});

	test("does not query relations when preloading empty results", async () => {
		class Post extends BaseModel<PostAttributes> {
			static override table = "posts";
		}
		class User extends BaseModel<UserAttributes> {
			static override table = "users";

			@hasMany(() => Post, { foreignKey: "userId" })
			declare posts: readonly Post[];
		}
		const database = createDatabase();
		User.useDatabase(database);
		Post.useDatabase(database);
		const connection = await memoryConnection(database);
		connection.queueResult<UserAttributes>({
			rows: [],
			affectedRows: 0,
		});

		const users = await User.query().preload("posts").all();

		expect(users).toEqual([]);
		expect(connection.queries).toEqual([
			{
				sql: 'select * from "users"',
				bindings: [],
			},
		]);
	});

	test("rejects empty preload relation names", () => {
		class User extends BaseModel<UserAttributes> {
			static override table = "users";
		}
		User.useDatabase(createDatabase());

		expect(() => User.query().preload("")).toThrow(
			"preload() relation name cannot be empty",
		);
		expect(() => User.query().preload("   ")).toThrow(
			"preload() relation name cannot be empty",
		);
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

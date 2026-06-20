import { moduleImport } from "./ScaffoldPaths";
import type { NewAppChoices } from "./Types";

export function makeAuthController(choices: NewAppChoices): string {
	const authServiceImport = moduleImport(
		choices,
		"auth",
		"auth_service",
		"#services/auth_service",
		"application",
	);

	return `import { KuraResponse, type Context } from "kura/http";
import { authService } from "${authServiceImport}";

export class AuthController {
	async me(ctx: Context): Promise<Response> {
		const user = await authService.authenticate(ctx);

		if (!user) {
			return KuraResponse.unauthenticated();
		}

		return KuraResponse.ok({
			guard: ctx.auth?.guard ?? "${choices.auth === "session" ? "session" : "api"}",
			user,
		});
	}

	async login(ctx: Context): Promise<Response> {
		const input = normalizeCredentials(ctx.validatedBody<LoginInput>());

		if (!input) {
			return KuraResponse.validation({
				body: ["Validated credentials are required."],
			});
		}

		const result = await authService.login(input.email, input.password);

		if (!result) {
			return KuraResponse.error({
				code: "E_INVALID_CREDENTIALS",
				message: "Invalid credentials.",
				status: 401,
			});
		}

		return KuraResponse.ok(result.body, { headers: result.headers });
	}

	async register(ctx: Context): Promise<Response> {
		const input = normalizeCredentials(ctx.validatedBody<RegisterInput>());

		if (!input) {
			return KuraResponse.validation({
				body: ["Validated credentials are required."],
			});
		}

		const result = await authService.register(input.email, input.password);

		if (!result) {
			return KuraResponse.error({
				code: "E_EMAIL_ALREADY_REGISTERED",
				message: "Email is already registered.",
				status: 409,
			});
		}

		return KuraResponse.created(result.body, { headers: result.headers });
	}

	async logout(ctx: Context): Promise<Response> {
		const result = await authService.logout(ctx);

		if (!result) {
			return KuraResponse.unauthenticated();
		}

		return KuraResponse.ok(result.body, { headers: result.headers });
	}
}

type LoginInput = {
	readonly email: string;
	readonly password: string;
};

type RegisterInput = LoginInput;

function normalizeCredentials(input: LoginInput | undefined): LoginInput | null {
	if (!input) {
		return null;
	}

	const email = input.email.trim().toLowerCase();
	const password = input.password;

	if (!email || !password) {
		return null;
	}

	return { email, password };
}
`;
}

export function makeAuthService(choices: NewAppChoices): string {
	return choices.auth === "session"
		? makeSessionAuthService()
		: makeAccessTokenAuthService();
}

function makeAccessTokenAuthService(): string {
	return `import {
	AccessTokenManager,
	MemoryAccessTokenStore,
} from "kura/auth";
import { Hash } from "kura/hash";
import type { Context } from "kura/http";

type DemoUser = {
	readonly id: number;
	readonly email: string;
	readonly passwordHash: string;
};

type PublicUser = {
	readonly id: number;
	readonly email: string;
};

type AuthServiceResult = {
	readonly body: Record<string, unknown>;
	readonly headers?: Record<string, string>;
};

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "password";
const TOKEN_TTL_SECONDS = 60 * 60 * 2;
const tokenStore = new MemoryAccessTokenStore<number>();

class AuthService {
	private readonly users = new Map<number, DemoUser>();
	private nextUserId = 1;
	private readonly tokens = new AccessTokenManager<DemoUser>({
		store: tokenStore,
		resolveUser: async (id) => this.findUserById(Number(id)),
	});

	async register(
		email: string,
		password: string,
	): Promise<AuthServiceResult | null> {
		await this.ensureDemoUser();

		if (await this.findUserByEmail(email)) {
			return null;
		}

		const user = await this.createUser(email, password);

		return this.createLoginResult(user);
	}

	async login(
		email: string,
		password: string,
	): Promise<AuthServiceResult | null> {
		const user = await this.findUserByEmail(email);

		if (!user) {
			return null;
		}

		const validCredentials =
			email === user.email && (await Hash.verify(user.passwordHash, password));

		if (!validCredentials) {
			return null;
		}

		return this.createLoginResult(user);
	}

	async authenticate(ctx: Context): Promise<PublicUser | null> {
		const token = bearerToken(ctx.request);
		const auth = await this.tokens.authenticate(token);

		if (!auth) {
			return null;
		}

		const user = publicUser(auth.user);
		ctx.auth = {
			guard: "api",
			user,
			token: auth.token,
			claims: {
				abilities: [...auth.record.abilities],
				tokenIdentifier: auth.record.identifier,
			},
		};

		return user;
	}

	async logout(ctx: Context): Promise<AuthServiceResult | null> {
		const token = bearerToken(ctx.request);

		if (!token || !(await this.tokens.authenticate(token))) {
			return null;
		}

		await this.tokens.revoke(token);

		return { body: { ok: true } };
	}

	private async createLoginResult(user: DemoUser): Promise<AuthServiceResult> {
		const token = await this.tokens.create(user, {
			type: "api",
			name: "login",
			expiresIn: TOKEN_TTL_SECONDS,
		});

		return {
			body: {
				token: token.value,
				tokenType: "Bearer",
				expiresIn: TOKEN_TTL_SECONDS,
				user: publicUser(user),
			},
		};
	}

	private async findUserById(id: number): Promise<DemoUser | null> {
		await this.ensureDemoUser();

		return this.users.get(id) ?? null;
	}

	private async findUserByEmail(email: string): Promise<DemoUser | null> {
		await this.ensureDemoUser();

		return (
			[...this.users.values()].find((user) => user.email === email) ?? null
		);
	}

	private async ensureDemoUser(): Promise<void> {
		if (this.users.size > 0) {
			return;
		}

		await this.createUser(DEMO_EMAIL, DEMO_PASSWORD);
	}

	private async createUser(email: string, password: string): Promise<DemoUser> {
		const user = {
			id: this.nextUserId,
			email,
			passwordHash: await Hash.make(password),
		};

		this.nextUserId += 1;
		this.users.set(user.id, user);

		return user;
	}
}

export const authService = new AuthService();

function bearerToken(request: Request): string | null {
	return (
		request.headers.get("authorization")?.match(/^Bearer\\s+(.+)$/i)?.[1] ?? null
	);
}

function publicUser(user: DemoUser): PublicUser {
	return {
		id: user.id,
		email: user.email,
	};
}
`;
}

function makeSessionAuthService(): string {
	return `import { Hash } from "kura/hash";
import type { Context } from "kura/http";

type DemoUser = {
	readonly id: number;
	readonly email: string;
	readonly passwordHash: string;
};

type PublicUser = {
	readonly id: number;
	readonly email: string;
};

type SessionRecord = {
	readonly id: string;
	readonly userId: number;
	readonly expiresAt: Date;
};

type AuthServiceResult = {
	readonly body: Record<string, unknown>;
	readonly headers?: Record<string, string>;
};

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "password";
const SESSION_COOKIE_NAME = "kura-session";
const SESSION_TTL_SECONDS = 60 * 60 * 2;

class AuthService {
	private readonly users = new Map<number, DemoUser>();
	private nextUserId = 1;
	private readonly sessions = new Map<string, SessionRecord>();

	async register(
		email: string,
		password: string,
	): Promise<AuthServiceResult | null> {
		await this.ensureDemoUser();

		if (await this.findUserByEmail(email)) {
			return null;
		}

		const user = await this.createUser(email, password);

		return this.createLoginResult(user);
	}

	async login(
		email: string,
		password: string,
	): Promise<AuthServiceResult | null> {
		const user = await this.findUserByEmail(email);

		if (!user) {
			return null;
		}

		const validCredentials =
			email === user.email && (await Hash.verify(user.passwordHash, password));

		if (!validCredentials) {
			return null;
		}

		return this.createLoginResult(user);
	}

	async authenticate(ctx: Context): Promise<PublicUser | null> {
		const sessionId = readSessionCookie(ctx.request);
		const session = sessionId ? this.sessions.get(sessionId) : null;

		if (!session || session.expiresAt.getTime() <= Date.now()) {
			return null;
		}

		const user = await this.findUserById(session.userId);

		if (!user) {
			return null;
		}

		const publicProfile = publicUser(user);
		ctx.auth = {
			guard: "session",
			user: publicProfile,
			token: session.id,
			claims: { sessionId: session.id },
		};

		return publicProfile;
	}

	async logout(ctx: Context): Promise<AuthServiceResult | null> {
		const sessionId = readSessionCookie(ctx.request);

		if (!sessionId || !this.sessions.delete(sessionId)) {
			return null;
		}

		return {
			body: { ok: true },
			headers: {
				"Set-Cookie": serializeSessionCookie("", 0),
			},
		};
	}

	private createLoginResult(user: DemoUser): AuthServiceResult {
		const session = this.createSession(user.id);

		return {
			body: {
				token: null,
				tokenType: "Cookie",
				expiresIn: SESSION_TTL_SECONDS,
				user: publicUser(user),
			},
			headers: {
				"Set-Cookie": serializeSessionCookie(session.id, SESSION_TTL_SECONDS),
			},
		};
	}

	private async findUserById(id: number): Promise<DemoUser | null> {
		await this.ensureDemoUser();

		return this.users.get(id) ?? null;
	}

	private async findUserByEmail(email: string): Promise<DemoUser | null> {
		await this.ensureDemoUser();

		return (
			[...this.users.values()].find((user) => user.email === email) ?? null
		);
	}

	private async ensureDemoUser(): Promise<void> {
		if (this.users.size > 0) {
			return;
		}

		await this.createUser(DEMO_EMAIL, DEMO_PASSWORD);
	}

	private async createUser(email: string, password: string): Promise<DemoUser> {
		const user = {
			id: this.nextUserId,
			email,
			passwordHash: await Hash.make(password),
		};

		this.nextUserId += 1;
		this.users.set(user.id, user);

		return user;
	}

	private createSession(userId: number): SessionRecord {
		const session: SessionRecord = {
			id: crypto.randomUUID(),
			userId,
			expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
		};

		this.sessions.set(session.id, session);

		return session;
	}
}

export const authService = new AuthService();

function readSessionCookie(request: Request): string | null {
	const cookieHeader = request.headers.get("cookie");

	if (!cookieHeader) {
		return null;
	}

	for (const cookie of cookieHeader.split(";")) {
		const [name, value] = cookie.trim().split("=");

		if (name === SESSION_COOKIE_NAME && value) {
			return decodeURIComponent(value);
		}
	}

	return null;
}

function serializeSessionCookie(sessionId: string, maxAge: number): string {
	const secure = Bun.env.NODE_ENV === "production" ? "; Secure" : "";

	return [
		SESSION_COOKIE_NAME + "=" + encodeURIComponent(sessionId),
		"HttpOnly",
		"SameSite=Lax",
		"Path=/",
		"Max-Age=" + String(maxAge),
		secure,
	]
		.filter(Boolean)
		.join("; ");
}

function publicUser(user: DemoUser): PublicUser {
	return {
		id: user.id,
		email: user.email,
	};
}
`;
}
export function makeUserModel(): string {
	return `import { BaseModel, column, type QueryRow } from "kura/database";

export type UserAttributes = QueryRow & {
\tid?: number;
\temail: string;
\tpassword: string;
\tcreated_at?: Date;
\tupdated_at?: Date;
};

export class User extends BaseModel<UserAttributes> {
\tstatic override table = "users";

\t@column()
\tdeclare id?: number;

\t@column()
\tdeclare email: string;

\t@column()
\tdeclare password: string;

\t@column({ name: "created_at" })
\tdeclare createdAt?: Date;

\t@column({ name: "updated_at" })
\tdeclare updatedAt?: Date;
}
`;
}

export function makeDomainUserEntity(): string {
	return `export type UserId = number;

export type UserProperties = {
\treadonly id?: UserId;
\treadonly email: string;
\treadonly passwordHash: string;
\treadonly createdAt?: Date;
\treadonly updatedAt?: Date;
};

export class User {
\tprivate constructor(private readonly properties: UserProperties) {}

\tstatic register(input: {
\t\treadonly email: string;
\t\treadonly passwordHash: string;
\t}): User {
\t\treturn new User({
\t\t\temail: input.email,
\t\t\tpasswordHash: input.passwordHash,
\t\t});
\t}

\tstatic hydrate(properties: UserProperties): User {
\t\treturn new User(properties);
\t}

\tget id(): UserId | undefined {
\t\treturn this.properties.id;
\t}

\tget email(): string {
\t\treturn this.properties.email;
\t}

\tget passwordHash(): string {
\t\treturn this.properties.passwordHash;
\t}

\tget createdAt(): Date | undefined {
\t\treturn this.properties.createdAt;
\t}

\tget updatedAt(): Date | undefined {
\t\treturn this.properties.updatedAt;
\t}

\ttoJSON(): UserProperties {
\t\treturn this.properties;
\t}
}
`;
}

export function makeUserRepositoryPort(): string {
	return `import type { User } from "./user";

export interface UserRepository {
\tfindByEmail(email: string): Promise<User | null>;
\tsave(user: User): Promise<void>;
}
`;
}

export function makeRegisterUserUseCase(): string {
	return `import { User } from "../domain/user";
import type { UserRepository } from "../domain/user_repository";

export type RegisterUserCommand = {
\treadonly email: string;
\treadonly passwordHash: string;
};

export class RegisterUser {
\tconstructor(private readonly users: UserRepository) {}

\tasync handle(command: RegisterUserCommand): Promise<User> {
\t\tconst existing = await this.users.findByEmail(command.email);

\t\tif (existing) {
\t\t\tthrow new Error("A user with this email already exists");
\t\t}

\t\tconst user = User.register(command);
\t\tawait this.users.save(user);

\t\treturn user;
\t}
}
`;
}

export function makeUserRecord(): string {
	return `import { BaseModel, column, type QueryRow } from "kura/database";

export type UserRecordAttributes = QueryRow & {
\tid?: number;
\temail: string;
\tpassword: string;
\tcreated_at?: Date;
\tupdated_at?: Date;
};

export class UserRecord extends BaseModel<UserRecordAttributes> {
\tstatic override table = "users";

\t@column()
\tdeclare id?: number;

\t@column()
\tdeclare email: string;

\t@column()
\tdeclare password: string;

\t@column({ name: "created_at" })
\tdeclare createdAt?: Date;

\t@column({ name: "updated_at" })
\tdeclare updatedAt?: Date;
}
`;
}

export function makeSqlUserRepository(): string {
	return `import { User } from "../../domain/user";
import type { UserRepository } from "../../domain/user_repository";
import { UserRecord } from "./user_record";

export class SqlUserRepository implements UserRepository {
\tasync findByEmail(email: string): Promise<User | null> {
\t\tconst record = await UserRecord.query().where("email", email).first();

\t\treturn record ? toDomain(record) : null;
\t}

\tasync save(user: User): Promise<void> {
\t\tconst data = user.toJSON();

\t\tif (data.id !== undefined) {
\t\t\tconst record = await UserRecord.find(data.id);

\t\t\tif (!record) {
\t\t\t\tthrow new Error("Cannot save missing user record");
\t\t\t}

\t\t\trecord.email = data.email;
\t\t\trecord.password = data.passwordHash;
\t\t\tawait record.save();
\t\t\treturn;
\t\t}

\t\tawait UserRecord.create({
\t\t\temail: data.email,
\t\t\tpassword: data.passwordHash,
\t\t});
\t}
}

function toDomain(record: UserRecord): User {
\treturn User.hydrate({
\t\tid: record.id,
\t\temail: record.email,
\t\tpasswordHash: record.password,
\t\tcreatedAt: record.createdAt,
\t\tupdatedAt: record.updatedAt,
\t});
}
`;
}

export function makeUsersMigration(): string {
	return `import { Migration, type SchemaBuilder } from "kura/database";

export default class CreateUsers extends Migration {
\toverride up(schema: SchemaBuilder): void {
\t\tschema.createTable("users", (table) => {
\t\t\ttable.id();
\t\t\ttable.string("email").notNull().unique();
\t\t\ttable.string("password").notNull();
\t\t\ttable.timestamps();
\t\t});
\t}

\toverride down(schema: SchemaBuilder): void {
\t\tschema.dropTable("users");
\t}
}
`;
}

export function makeAccessTokensMigration(): string {
	return `import { Migration, type SchemaBuilder } from "kura/database";

export default class CreateAccessTokens extends Migration {
\toverride up(schema: SchemaBuilder): void {
\t\tschema.createTable("auth_access_tokens", (table) => {
\t\t\ttable.id();
\t\t\ttable.integer("tokenable_id").notNull();
\t\t\ttable.string("type").notNull();
\t\t\ttable.string("name").nullable();
\t\t\ttable.string("token_hash").notNull().unique();
\t\t\ttable.text("abilities").notNull();
\t\t\ttable.timestamp("last_used_at").nullable();
\t\t\ttable.timestamp("expires_at").nullable();
\t\t\ttable.timestamps();
\t\t});
\t}

\toverride down(schema: SchemaBuilder): void {
\t\tschema.dropTable("auth_access_tokens");
\t}
}
`;
}

export function makeSessionsMigration(): string {
	return `import { Migration, type SchemaBuilder } from "kura/database";

export default class CreateSessions extends Migration {
\toverride up(schema: SchemaBuilder): void {
\t\tschema.createTable("sessions", (table) => {
\t\t\ttable.string("id").primary();
\t\t\ttable.integer("user_id").nullable();
\t\t\ttable.text("payload").notNull();
\t\t\ttable.timestamp("expires_at").notNull();
\t\t\ttable.timestamps();
\t\t});
\t}

\toverride down(schema: SchemaBuilder): void {
\t\tschema.dropTable("sessions");
\t}
}
`;
}

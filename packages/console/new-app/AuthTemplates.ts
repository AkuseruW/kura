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
		? makeSessionAuthService(choices)
		: makeAccessTokenAuthService(choices);
}

function makeAccessTokenAuthService(choices: NewAppChoices): string {
	if (choices.architecture === "domain") {
		return makeDomainAccessTokenAuthService();
	}

	return makeModelAccessTokenAuthService(choices);
}

function makeModelAccessTokenAuthService(choices: NewAppChoices): string {
	const userImport = moduleImport(choices, "auth", "user", "#models/user");

	return `import { database } from "#database/connection";
import { AccessTokenManager, DatabaseAccessTokenStore } from "kura/auth";
import { Hash } from "kura/hash";
import type { Context } from "kura/http";
import { User } from "${userImport}";

type AuthUser = {
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

const TOKEN_TTL_SECONDS = 60 * 60 * 2;

class AuthService {
	private readonly tokens = new AccessTokenManager<AuthUser>({
		store: new DatabaseAccessTokenStore<number>(database),
		resolveUser: async (id) => this.findUserById(Number(id)),
		tokenPrefix: "oat_",
	});

	async register(
		email: string,
		password: string,
	): Promise<AuthServiceResult | null> {
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

	private async createLoginResult(user: AuthUser): Promise<AuthServiceResult> {
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

	private async findUserById(id: number): Promise<AuthUser | null> {
		const user = await User.find(id);

		return user ? toAuthUser(user) : null;
	}

	private async findUserByEmail(email: string): Promise<AuthUser | null> {
		const user = await User.query().where("email", email).first();

		return user ? toAuthUser(user) : null;
	}

	private async createUser(email: string, password: string): Promise<AuthUser> {
		const user = await User.create({
			email,
			password: await Hash.make(password),
		});

		if (user.id !== undefined) {
			return toAuthUser(user);
		}

		const persisted = await this.findUserByEmail(email);
		if (!persisted) {
			throw new Error("Created user record was not found");
		}

		return persisted;
	}
}

export const authService = new AuthService();

function bearerToken(request: Request): string | null {
	return (
		request.headers.get("authorization")?.match(/^Bearer\\s+(.+)$/i)?.[1] ?? null
	);
}

function publicUser(user: AuthUser): PublicUser {
	return {
		id: user.id,
		email: user.email,
	};
}

function toAuthUser(user: User): AuthUser {
	if (user.id === undefined) {
		throw new Error("Authenticated user record is missing an id");
	}

	return {
		id: user.id,
		email: user.email,
		passwordHash: user.password,
	};
}
`;
}

function makeDomainAccessTokenAuthService(): string {
	return `import { database } from "#database/connection";
import { AccessTokenManager, DatabaseAccessTokenStore } from "kura/auth";
import { Hash } from "kura/hash";
import type { Context } from "kura/http";
import type { User } from "../domain/user";
import { RegisterUser } from "./register_user";
import { SqlUserRepository } from "../infrastructure/persistence/sql_user_repository";

type AuthUser = {
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

const TOKEN_TTL_SECONDS = 60 * 60 * 2;
const users = new SqlUserRepository();
const registerUser = new RegisterUser(users);

class AuthService {
	private readonly tokens = new AccessTokenManager<AuthUser>({
		store: new DatabaseAccessTokenStore<number>(database),
		resolveUser: async (id) => this.findUserById(Number(id)),
		tokenPrefix: "oat_",
	});

	async register(
		email: string,
		password: string,
	): Promise<AuthServiceResult | null> {
		if (await users.findByEmail(email)) {
			return null;
		}

		const user = await registerUser.handle({
			email,
			passwordHash: await Hash.make(password),
		});

		return this.createLoginResult(toAuthUser(user));
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

	private async createLoginResult(user: AuthUser): Promise<AuthServiceResult> {
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

	private async findUserById(id: number): Promise<AuthUser | null> {
		const user = await users.find(id);

		return user ? toAuthUser(user) : null;
	}

	private async findUserByEmail(email: string): Promise<AuthUser | null> {
		const user = await users.findByEmail(email);

		return user ? toAuthUser(user) : null;
	}
}

export const authService = new AuthService();

function bearerToken(request: Request): string | null {
	return (
		request.headers.get("authorization")?.match(/^Bearer\\s+(.+)$/i)?.[1] ?? null
	);
}

function publicUser(user: AuthUser): PublicUser {
	return {
		id: user.id,
		email: user.email,
	};
}

function toAuthUser(user: User): AuthUser {
	const id = user.id;

	if (id === undefined) {
		throw new Error("Authenticated user record is missing an id");
	}

	return {
		id,
		email: user.email,
		passwordHash: user.passwordHash,
	};
}
`;
}

function makeSessionAuthService(choices: NewAppChoices): string {
	if (choices.architecture === "domain") {
		return makeDomainSessionAuthService();
	}

	return makeModelSessionAuthService(choices);
}

function makeModelSessionAuthService(choices: NewAppChoices): string {
	const userImport = moduleImport(choices, "auth", "user", "#models/user");

	return `import { database } from "#database/connection";
import type { QueryRow } from "kura/database";
import { Hash } from "kura/hash";
import type { Context } from "kura/http";
import { User } from "${userImport}";

type AuthUser = {
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

const SESSION_COOKIE_NAME = "kura-session";
const SESSION_TTL_SECONDS = 60 * 60 * 2;

type SessionRow = QueryRow & {
	readonly id: string;
	readonly user_id: number | null;
	readonly payload: string;
	readonly expires_at: Date | string;
	readonly created_at?: Date | string;
	readonly updated_at?: Date | string;
};

class AuthService {
	async register(
		email: string,
		password: string,
	): Promise<AuthServiceResult | null> {
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
		const session = sessionId ? await this.findSession(sessionId) : null;

		if (!session || session.expiresAt.getTime() <= Date.now()) {
			if (sessionId) {
				await this.deleteSession(sessionId);
			}
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

		if (!sessionId || !(await this.findSession(sessionId))) {
			return null;
		}

		await this.deleteSession(sessionId);

		return {
			body: { ok: true },
			headers: {
				"Set-Cookie": serializeSessionCookie("", 0),
			},
		};
	}

	private async createLoginResult(user: AuthUser): Promise<AuthServiceResult> {
		const session = await this.createSession(user.id);

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

	private async findUserById(id: number): Promise<AuthUser | null> {
		const user = await User.find(id);

		return user ? toAuthUser(user) : null;
	}

	private async findUserByEmail(email: string): Promise<AuthUser | null> {
		const user = await User.query().where("email", email).first();

		return user ? toAuthUser(user) : null;
	}

	private async createUser(email: string, password: string): Promise<AuthUser> {
		const user = await User.create({
			email,
			password: await Hash.make(password),
		});

		if (user.id !== undefined) {
			return toAuthUser(user);
		}

		const persisted = await this.findUserByEmail(email);
		if (!persisted) {
			throw new Error("Created user record was not found");
		}

		return persisted;
	}

	private async createSession(userId: number): Promise<SessionRecord> {
		const session: SessionRecord = {
			id: crypto.randomUUID(),
			userId,
			expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
		};
		const now = new Date();

		await database.table<SessionRow>("sessions").insert({
			id: session.id,
			user_id: session.userId,
			payload: "{}",
			expires_at: session.expiresAt,
			created_at: now,
			updated_at: now,
		});

		return session;
	}

	private async findSession(sessionId: string): Promise<SessionRecord | null> {
		const row = await database
			.table<SessionRow>("sessions")
			.where("id", sessionId)
			.first();

		if (!row || row.user_id === null) {
			return null;
		}

		return {
			id: row.id,
			userId: row.user_id,
			expiresAt: readDate(row.expires_at),
		};
	}

	private async deleteSession(sessionId: string): Promise<void> {
		await database.table<SessionRow>("sessions").where("id", sessionId).delete();
	}
}

export const authService = new AuthService();

${sessionHelpers()}

function toAuthUser(user: User): AuthUser {
	if (user.id === undefined) {
		throw new Error("Authenticated user record is missing an id");
	}

	return {
		id: user.id,
		email: user.email,
		passwordHash: user.password,
	};
}
`;
}

function makeDomainSessionAuthService(): string {
	return `import { database } from "#database/connection";
import type { QueryRow } from "kura/database";
import { Hash } from "kura/hash";
import type { Context } from "kura/http";
import type { User } from "../domain/user";
import { RegisterUser } from "./register_user";
import { SqlUserRepository } from "../infrastructure/persistence/sql_user_repository";

type AuthUser = {
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

const SESSION_COOKIE_NAME = "kura-session";
const SESSION_TTL_SECONDS = 60 * 60 * 2;
const users = new SqlUserRepository();
const registerUser = new RegisterUser(users);

type SessionRow = QueryRow & {
	readonly id: string;
	readonly user_id: number | null;
	readonly payload: string;
	readonly expires_at: Date | string;
	readonly created_at?: Date | string;
	readonly updated_at?: Date | string;
};

class AuthService {
	async register(
		email: string,
		password: string,
	): Promise<AuthServiceResult | null> {
		if (await users.findByEmail(email)) {
			return null;
		}

		const user = await registerUser.handle({
			email,
			passwordHash: await Hash.make(password),
		});

		return this.createLoginResult(toAuthUser(user));
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
		const session = sessionId ? await this.findSession(sessionId) : null;

		if (!session || session.expiresAt.getTime() <= Date.now()) {
			if (sessionId) {
				await this.deleteSession(sessionId);
			}
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

		if (!sessionId || !(await this.findSession(sessionId))) {
			return null;
		}

		await this.deleteSession(sessionId);

		return {
			body: { ok: true },
			headers: {
				"Set-Cookie": serializeSessionCookie("", 0),
			},
		};
	}

	private async createLoginResult(user: AuthUser): Promise<AuthServiceResult> {
		const session = await this.createSession(user.id);

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

	private async findUserById(id: number): Promise<AuthUser | null> {
		const user = await users.find(id);

		return user ? toAuthUser(user) : null;
	}

	private async findUserByEmail(email: string): Promise<AuthUser | null> {
		const user = await users.findByEmail(email);

		return user ? toAuthUser(user) : null;
	}

	private async createSession(userId: number): Promise<SessionRecord> {
		const session: SessionRecord = {
			id: crypto.randomUUID(),
			userId,
			expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
		};
		const now = new Date();

		await database.table<SessionRow>("sessions").insert({
			id: session.id,
			user_id: session.userId,
			payload: "{}",
			expires_at: session.expiresAt,
			created_at: now,
			updated_at: now,
		});

		return session;
	}

	private async findSession(sessionId: string): Promise<SessionRecord | null> {
		const row = await database
			.table<SessionRow>("sessions")
			.where("id", sessionId)
			.first();

		if (!row || row.user_id === null) {
			return null;
		}

		return {
			id: row.id,
			userId: row.user_id,
			expiresAt: readDate(row.expires_at),
		};
	}

	private async deleteSession(sessionId: string): Promise<void> {
		await database.table<SessionRow>("sessions").where("id", sessionId).delete();
	}
}

export const authService = new AuthService();

${sessionHelpers()}

function toAuthUser(user: User): AuthUser {
	const id = user.id;

	if (id === undefined) {
		throw new Error("Authenticated user record is missing an id");
	}

	return {
		id,
		email: user.email,
		passwordHash: user.passwordHash,
	};
}
`;
}

function sessionHelpers(): string {
	return `function readSessionCookie(request: Request): string | null {
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

function publicUser(user: AuthUser): PublicUser {
	return {
		id: user.id,
		email: user.email,
	};
}

function readDate(value: Date | string): Date {
	if (value instanceof Date) {
		return value;
	}

	return new Date(value);
}`;
}
export function makeUserModel(): string {
	return `import database from "#database/connection";
import { BaseModel, column, type QueryRow } from "kura/database";

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

User.useDatabase(database);
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
	return `import type { User, UserId } from "./user";

export interface UserRepository {
\tfind(id: UserId): Promise<User | null>;
\tfindByEmail(email: string): Promise<User | null>;
\tsave(user: User): Promise<User>;
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
\t\treturn this.users.save(user);
\t}
}
`;
}

export function makeUserRecord(): string {
	return `import database from "#database/connection";
import { BaseModel, column, type QueryRow } from "kura/database";

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

UserRecord.useDatabase(database);
`;
}

export function makeSqlUserRepository(): string {
	return `import { User } from "../../domain/user";
import type { UserRepository } from "../../domain/user_repository";
import { UserRecord } from "./user_record";

export class SqlUserRepository implements UserRepository {
\tasync find(id: number): Promise<User | null> {
\t\tconst record = await UserRecord.find(id);

\t\treturn record ? toDomain(record) : null;
\t}

\tasync findByEmail(email: string): Promise<User | null> {
\t\tconst record = await UserRecord.query().where("email", email).first();

\t\treturn record ? toDomain(record) : null;
\t}

\tasync save(user: User): Promise<User> {
\t\tconst data = user.toJSON();

\t\tif (data.id !== undefined) {
\t\t\tconst record = await UserRecord.find(data.id);

\t\t\tif (!record) {
\t\t\t\tthrow new Error("Cannot save missing user record");
\t\t\t}

\t\t\trecord.email = data.email;
\t\t\trecord.password = data.passwordHash;
\t\t\tawait record.save();
\t\t\treturn toDomain(record);
\t\t}

\t\tconst record = await UserRecord.create({
\t\t\temail: data.email,
\t\t\tpassword: data.passwordHash,
\t\t});

\t\tif (record.id !== undefined) {
\t\t\treturn toDomain(record);
\t\t}

\t\tconst persisted = await this.findByEmail(data.email);
\t\tif (!persisted) {
\t\t\tthrow new Error("Created user record was not found");
\t\t}

\t\treturn persisted;
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
\t\t\ttable.string("identifier").notNull().unique();
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

import type { NewAppChoices, NewAppDirectory, NewAppFile } from "./Types";

export function makeNewAppFiles(options: {
	readonly appName: string;
	readonly choices: NewAppChoices;
	readonly packageVersion: string;
}): readonly NewAppFile[] {
	const { appName, choices, packageVersion } = options;

	return [
		{
			path: "package.json",
			content: `${JSON.stringify(makePackageJson(appName, packageVersion), null, "\t")}\n`,
		},
		{
			path: "tsconfig.json",
			content: `{
\t"compilerOptions": {
\t\t"lib": ["ESNext"],
\t\t"target": "ESNext",
\t\t"module": "Preserve",
\t\t"moduleResolution": "bundler",
\t\t"baseUrl": ".",
\t\t"paths": {
\t\t\t"#controllers/*": ["app/controllers/*"],
\t\t\t"#exceptions/*": ["app/exceptions/*"],
\t\t\t"#models/*": ["app/models/*"],
\t\t\t"#mails/*": ["app/mails/*"],
\t\t\t"#services/*": ["app/services/*"],
\t\t\t"#listeners/*": ["app/listeners/*"],
\t\t\t"#generated/*": [".kura/server/*"],
\t\t\t"#events/*": ["app/events/*"],
\t\t\t"#middleware/*": ["app/middleware/*"],
\t\t\t"#validators/*": ["app/validators/*"],
\t\t\t"#providers/*": ["providers/*"],
\t\t\t"#policies/*": ["app/policies/*"],
\t\t\t"#database/*": ["database/*"],
\t\t\t"#tests/*": ["tests/*"],
\t\t\t"#start/*": ["start/*"],
\t\t\t"#config/*": ["config/*"]
\t\t},
\t\t"experimentalDecorators": true,
\t\t"strict": true,
\t\t"noEmit": true,
\t\t"skipLibCheck": true,
\t\t"types": ["bun"]
\t},
\t"include": ["**/*.ts"]
}
`,
		},
		{
			path: ".gitignore",
			content: `# Dependencies and Kura build
node_modules
.kura
build
dist
tmp/

# Secrets
.env
.env.local
.env.production.local
.env.development.local

# Build logs
*.log

# Editors
.fleet
.idea
.vscode

# Platform
.DS_Store
`,
		},
		{
			path: ".editorconfig",
			content: `# http://editorconfig.org

[*]
indent_style = tab
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
`,
		},
		{
			path: ".prettierignore",
			content: `.kura
node_modules
build
dist
`,
		},
		{
			path: ".env.example",
			content: makeEnvExample(choices),
		},
		{
			path: ".env",
			content: makeEnv(choices),
		},
		{
			path: ".env.test",
			content: `NODE_ENV=test
PORT=3333
HOST=localhost
LOG_LEVEL=silent
`,
		},
		{
			path: "kura.config.ts",
			content: makeKuraConfig(),
		},
		{
			path: "bin/console.ts",
			content: `import {
\tcreateConsole,
\tregisterGeneratorCommands,
\tregisterServeCommand,
} from "kura";

await import("#start/env");

const appConsole = createConsole();

registerGeneratorCommands(appConsole);
registerServeCommand(appConsole, {
\tentry: "bin/server.ts",
});

const exitCode = await appConsole.run(Bun.argv.slice(2));
process.exit(exitCode);
`,
		},
		{
			path: "bin/server.ts",
			content: `import { type Context, MiddlewarePipeline, Server } from "kura";
import env from "#start/env";
import { routerMiddleware, serverMiddleware } from "#start/kernel";
import { router } from "#start/routes";

export { router };
export default router;

export function createServer(): Server {
\tconst server = new Server({
\t\tport: env.number("PORT", 3333) ?? 3333,
\t});

\tconst pipeline = new MiddlewarePipeline();

\tfor (const middleware of serverMiddleware) {
\t\tpipeline.use(middleware);
\t}

\tfor (const middleware of routerMiddleware) {
\t\tpipeline.use(middleware);
\t}

\tserver.setHandler((ctx) => pipeline.run(ctx, async () => dispatchRouter(ctx)));

\treturn server;
}

function dispatchRouter(ctx: Context): Response | Promise<Response> {
\tconst url = new URL(ctx.request.url);
\tconst match = router.match(ctx.request.method, url.pathname);

\tif (!match) {
\t\treturn new Response("Not Found", { status: 404 });
\t}

\tctx.params = match.params;
\treturn match.handler(ctx);
}

if (import.meta.main) {
\tconst server = createServer();
\tserver.start();
\tconsole.log(
\t\t\`Kura app listening on http://\${env.get("HOST", "localhost")}:\${env.number("PORT", 3333)}\`,
\t);
}
`,
		},
		{
			path: "bin/test.ts",
			content: `Bun.env.NODE_ENV = "test";

await import("#start/env");
const { router } = await import("#start/routes");

export { router };
`,
		},
		{
			path: "start/env.ts",
			content: `import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Env } from "kura";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = new Env();

await env.load(resolve(appRoot, ".env")).catch(() => undefined);

if (Bun.env.NODE_ENV === "test") {
\tawait env.load(resolve(appRoot, ".env.test")).catch(() => undefined);
}

export default env;
`,
		},
		{
			path: "start/kernel.ts",
			content: `import { BodyParser, Cors, type Middleware, RequestId } from "kura";

export const serverMiddleware: readonly Middleware[] = [RequestId, Cors()];

export const routerMiddleware: readonly Middleware[] = [BodyParser];

export const namedMiddleware = {};
`,
		},
		{
			path: "config/app.ts",
			content: makeAppConfig(choices),
		},
		{
			path: "config/auth.ts",
			content: makeAuthConfig(choices),
		},
		{
			path: "config/bodyparser.ts",
			content: makeBodyParserConfig(),
		},
		{
			path: "config/cache.ts",
			content: makeCacheConfig(choices),
		},
		{
			path: "config/database.ts",
			content: makeDatabaseConfig(choices),
		},
		{
			path: "config/encryption.ts",
			content: makeEncryptionConfig(),
		},
		{
			path: "config/hash.ts",
			content: makeHashConfig(),
		},
		{
			path: "config/logger.ts",
			content: makeLoggerConfig(),
		},
		{
			path: "config/queue.ts",
			content: makeQueueConfig(choices),
		},
		{
			path: "config/session.ts",
			content: makeSessionConfig(choices),
		},
		{
			path: "config/shield.ts",
			content: makeShieldConfig(choices),
		},
		{
			path: "config/static.ts",
			content: makeStaticConfig(choices),
		},
		...(choices.preset === "api"
			? []
			: [
					{
						path: "config/vite.ts",
						content: makeViteConfig(),
					},
				]),
		{
			path: "start/routes.ts",
			content: makeRoutes(choices),
		},
		...makePresetFiles(choices),
		...makeAuthFiles(choices),
		...makeOptionalModuleFiles(choices),
		...makeNewAppDirectories([
			"app/controllers",
			"app/events",
			"app/exceptions",
			"app/jobs",
			"app/listeners",
			"app/mails",
			"app/middleware",
			"app/models",
			"app/policies",
			"app/services",
			"app/abilities",
			"app/transformers",
			"app/validators",
			"commands",
			"database/migrations",
			"database/seeders",
			"database/factories",
		]),
		{
			path: "database/schema.ts",
			content: `export const schema = {};
`,
		},
		{
			path: "database/schema_rules.ts",
			content: `export const schemaRules = {};
`,
		},
		...makeNewAppDirectories(["providers", "tests"]),
		{
			path: "tests/bootstrap.ts",
			content: `export const runnerHooks = {
\tsetup: [],
\tteardown: [],
};
`,
		},
		...makeNewAppDirectories(["tmp", "public", "resources/views"]),
		{
			path: "README.md",
			content: makeReadme(appName, choices),
		},
	];
}

function makeNewAppDirectories(
	paths: readonly string[],
): readonly NewAppDirectory[] {
	return paths.map((path) => ({ kind: "directory" as const, path }));
}

function makePresetFiles(choices: NewAppChoices): readonly NewAppFile[] {
	const files: NewAppFile[] = [];

	if (choices.preset === "api" || choices.preset === "full") {
		files.push({
			path: "app/controllers/ApiController.ts",
			content: makeApiController(choices),
		});
	}

	if (choices.preset === "web" || choices.preset === "full") {
		files.push(
			{
				path: "app/controllers/HomeController.ts",
				content: makeHomeController(),
			},
			{
				path: "resources/views/home.html",
				content: makeHomeView(choices),
			},
		);
	}

	return files;
}

function makeAuthFiles(choices: NewAppChoices): readonly NewAppFile[] {
	if (choices.auth === "none") {
		return [];
	}

	const files: NewAppFile[] = [
		{
			path: "app/controllers/AuthController.ts",
			content: makeAuthController(choices),
		},
		{
			path: "app/models/User.ts",
			content: makeUserModel(),
		},
		{
			path: "database/migrations/00000000000000_create_users.ts",
			content: makeUsersMigration(),
		},
	];

	if (choices.auth === "session") {
		files.push({
			path: "database/migrations/00000000000001_create_sessions.ts",
			content: makeSessionsMigration(),
		});
	}

	return files;
}

function makeOptionalModuleFiles(
	choices: NewAppChoices,
): readonly NewAppFile[] {
	const files: NewAppFile[] = [];
	const modules = new Set(choices.modules);

	if (modules.has("mail")) {
		files.push(
			{
				path: "config/mail.ts",
				content: makeMailConfig(),
			},
			{
				path: "app/mails/WelcomeMail.ts",
				content: makeWelcomeMail(),
			},
		);
	}

	if (modules.has("storage")) {
		files.push(
			{
				path: "config/storage.ts",
				content: makeStorageConfig(),
			},
			{
				path: "app/services/StorageService.ts",
				content: makeStorageService(),
			},
		);
	}

	if (modules.has("i18n")) {
		files.push(
			{
				path: "config/i18n.ts",
				content: makeI18nConfig(),
			},
			{
				path: "resources/lang/en/messages.ts",
				content: makeEnglishMessages(),
			},
		);
	}

	if (modules.has("websockets")) {
		files.push(
			{
				path: "config/websockets.ts",
				content: makeWebSocketsConfig(),
			},
			{
				path: "app/services/WebSocketService.ts",
				content: makeWebSocketService(),
			},
		);
	}

	return files;
}

function makePackageJson(appName: string, packageVersion: string) {
	return {
		name: slugify(appName),
		version: "0.0.0",
		type: "module",
		private: true,
		license: "UNLICENSED",
		engines: {
			bun: ">=1.3.0",
		},
		scripts: {
			kura: "bun bin/console.ts",
			dev: "bun bin/console.ts serve --watch",
			start: "bun bin/console.ts serve --host 0.0.0.0",
			test: "bun bin/test.ts",
			typecheck: "tsc --noEmit",
			build:
				"bun build bin/server.ts --target=bun --outdir=build --packages=external",
		},
		imports: {
			"#controllers/*": "./app/controllers/*.ts",
			"#exceptions/*": "./app/exceptions/*.ts",
			"#models/*": "./app/models/*.ts",
			"#mails/*": "./app/mails/*.ts",
			"#services/*": "./app/services/*.ts",
			"#listeners/*": "./app/listeners/*.ts",
			"#generated/*": "./.kura/server/*.ts",
			"#events/*": "./app/events/*.ts",
			"#middleware/*": "./app/middleware/*.ts",
			"#validators/*": "./app/validators/*.ts",
			"#providers/*": "./providers/*.ts",
			"#policies/*": "./app/policies/*.ts",
			"#database/*": "./database/*.ts",
			"#tests/*": "./tests/*.ts",
			"#start/*": "./start/*.ts",
			"#config/*": "./config/*.ts",
		},
		dependencies: {
			kura: packageVersion,
		},
		devDependencies: {
			"@types/bun": "^1.3.6",
			typescript: "^5.9.3",
		},
	};
}

function makeEnvExample(choices: NewAppChoices): string {
	return makeEnvFile(choices, "change-me-in-production");
}

function makeEnv(choices: NewAppChoices): string {
	return makeEnvFile(choices, "local-development-key");
}

function makeEnvFile(choices: NewAppChoices, appKey: string): string {
	const lines = [
		`APP_NAME=${choices.preset === "api" ? "Kura API" : "Kura"}`,
		"TZ=UTC",
		"PORT=3333",
		"HOST=localhost",
		"NODE_ENV=development",
		"LOG_LEVEL=info",
		`APP_KEY=${appKey}`,
		`APP_URL=http://\${HOST}:\${PORT}`,
		"HASH_DRIVER=bcrypt",
		`CACHE_STORE=${choices.cache}`,
		`QUEUE_CONNECTION=${choices.queue}`,
		`SESSION_DRIVER=${choices.auth === "session" ? "cookie" : "memory"}`,
		`AUTH_GUARD=${choices.auth === "session" ? "web" : choices.auth === "jwt" ? "api" : "none"}`,
	];

	if (choices.database !== "none") {
		lines.push(`DB_CONNECTION=${choices.database}`);
		lines.push("DATABASE_URL=");
	}

	if (choices.cache === "redis" || choices.queue === "redis") {
		lines.push("REDIS_URL=");
	}

	return `${lines.join("\n")}\n`;
}

function makeKuraConfig(): string {
	return `import { defineConfig } from "kura";

export default defineConfig({
\tcommands: ["./commands"],
\tproviders: ["./providers"],
\tpreloads: ["#start/env", "#start/kernel", "#start/routes"],
\ttests: {
\t\tsuites: [
\t\t\t{
\t\t\t\tfiles: ["tests/unit/**/*.test.ts"],
\t\t\t\tname: "unit",
\t\t\t\ttimeout: 2000,
\t\t\t},
\t\t\t{
\t\t\t\tfiles: ["tests/functional/**/*.test.ts"],
\t\t\t\tname: "functional",
\t\t\t\ttimeout: 30000,
\t\t\t},
\t\t],
\t},
\taliases: {
\t\tcontrollers: "#controllers/*",
\t\texceptions: "#exceptions/*",
\t\tmodels: "#models/*",
\t\tmails: "#mails/*",
\t\tservices: "#services/*",
\t\tlisteners: "#listeners/*",
\t\tgenerated: "#generated/*",
\t\tevents: "#events/*",
\t\tmiddleware: "#middleware/*",
\t\tvalidators: "#validators/*",
\t\tproviders: "#providers/*",
\t\tpolicies: "#policies/*",
\t\tdatabase: "#database/*",
\t\ttests: "#tests/*",
\t\tstart: "#start/*",
\t\tconfig: "#config/*",
\t},
});
`;
}

function makeAppConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura";
import env from "#start/env";

/**
 * The app URL is used whenever Kura needs to build absolute URLs.
 */
export const appUrl = env.get("APP_URL", "http://localhost:3333");

/**
 * Application and HTTP server configuration.
 */
const appConfig = defineConfig({
\tname: env.get("APP_NAME", "Kura"),
\tenvironment: env.get<string>("NODE_ENV", "development"),
\tappKey: env.required("APP_KEY"),
\turl: appUrl,

\thttp: {
\t\tgenerateRequestId: true,
\t\tallowMethodSpoofing: ${choices.preset === "api" ? "false" : "true"},
\t\tuseAsyncLocalStorage: false,
\t\tredirect: {
\t\t\tforwardQueryString: true,
\t\t},
\t\tcookie: {
\t\t\tdomain: "",
\t\t\tpath: "/",
\t\t\tmaxAge: "2h",
\t\t\thttpOnly: true,
\t\t\tsecure: env.get<string>("NODE_ENV", "development") === "production",
\t\t\tsameSite: "lax",
\t\t},
\t},

\tstarter: {
\t\tpreset: "${choices.preset}",
\t\tdatabase: "${choices.database}",
\t\tauth: "${choices.auth}",
\t\tcache: "${choices.cache}",
\t\tqueue: "${choices.queue}",
\t\tmodules: ${JSON.stringify(choices.modules)},
\t},
});

export default appConfig;
`;
}

function makeAuthConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura";
import env from "#start/env";

/**
 * Authentication configuration.
 */
const authConfig = defineConfig({
\tenabled: ${choices.auth === "none" ? "false" : "true"},
\tdefault: env.get("AUTH_GUARD", "${choices.auth === "session" ? "web" : choices.auth === "jwt" ? "api" : "none"}"),

\tguards: {
\t\tweb: {
\t\t\tdriver: "session",
\t\t\tuseRememberMeTokens: false,
\t\t\tprovider: {
\t\t\t\ttype: "model",
\t\t\t\tmodel: "#models/user",
\t\t\t},
\t\t},

\t\tapi: {
\t\t\tdriver: "jwt",
\t\t\ttoken: {
\t\t\t\texpiresIn: "2h",
\t\t\t\tsecret: env.required("APP_KEY"),
\t\t\t},
\t\t\tprovider: {
\t\t\t\ttype: "model",
\t\t\t\tmodel: "#models/user",
\t\t\t},
\t\t},
\t},
});

export default authConfig;
`;
}

function makeBodyParserConfig(): string {
	return `import { defineConfig } from "kura";

/**
 * Body parser configuration.
 */
const bodyParserConfig = defineConfig({
\tallowedMethods: ["POST", "PUT", "PATCH", "DELETE"],

\tform: {
\t\tconvertEmptyStringsToNull: true,
\t\ttrimWhitespaces: true,
\t\ttypes: ["application/x-www-form-urlencoded"],
\t},

\tjson: {
\t\tconvertEmptyStringsToNull: true,
\t\ttrimWhitespaces: true,
\t\ttypes: [
\t\t\t"application/json",
\t\t\t"application/json-patch+json",
\t\t\t"application/vnd.api+json",
\t\t\t"application/csp-report",
\t\t],
\t},

\tmultipart: {
\t\tautoProcess: true,
\t\tconvertEmptyStringsToNull: true,
\t\ttrimWhitespaces: true,
\t\tprocessManually: [],
\t\tlimit: "20mb",
\t\ttypes: ["multipart/form-data"],
\t},
});

export default bodyParserConfig;
`;
}

function makeCacheConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura";
import env from "#start/env";

/**
 * Cache configuration.
 */
const cacheConfig = defineConfig({
\tdefault: env.get("CACHE_STORE", "${choices.cache}"),

\tstores: {
\t\tmemory: {
\t\t\tdriver: "memory",
\t\t},

\t\tfile: {
\t\t\tdriver: "file",
\t\t\tdirectory: "tmp/cache",
\t\t\tprefix: env.get("APP_NAME", "kura"),
\t\t},

\t\tredis: {
\t\t\tdriver: "redis",
\t\t\turl: env.get("REDIS_URL", "redis://localhost:6379"),
\t\t\tprefix: env.get("APP_NAME", "kura"),
\t\t},
\t},
});

export default cacheConfig;
`;
}

function makeDatabaseConfig(choices: NewAppChoices): string {
	const defaultConnection =
		choices.database === "none" ? "memory" : choices.database;

	return `import { defineConfig } from "kura";
import env from "#start/env";

/**
 * Database configuration.
 */
const databaseConfig = defineConfig({
\tdefault: env.get("DB_CONNECTION", "${defaultConnection}"),
\tprettyPrintDebugQueries:
\t\tenv.get<string>("NODE_ENV", "development") !== "production",

\tconnections: {
\t\tmemory: {
\t\t\tdriver: "memory",
\t\t},

\t\tsqlite: {
\t\t\tdriver: "sqlite",
\t\t\tfilename: "database/database.sqlite",
\t\t\tmigrations: {
\t\t\t\tnaturalSort: true,
\t\t\t\tpaths: ["database/migrations"],
\t\t\t},
\t\t\tdebug: env.get<string>("NODE_ENV", "development") === "development",
\t\t},

\t\tpostgres: {
\t\t\tdriver: "postgres",
\t\t\turl: env.get("DATABASE_URL", ""),
\t\t\tmigrations: {
\t\t\t\tnaturalSort: true,
\t\t\t\tpaths: ["database/migrations"],
\t\t\t},
\t\t\tdebug: env.get<string>("NODE_ENV", "development") === "development",
\t\t},

\t\tmysql: {
\t\t\tdriver: "mysql",
\t\t\turl: env.get("DATABASE_URL", ""),
\t\t\tmigrations: {
\t\t\t\tnaturalSort: true,
\t\t\t\tpaths: ["database/migrations"],
\t\t\t},
\t\t\tdebug: env.get<string>("NODE_ENV", "development") === "development",
\t\t},
\t},
});

export default databaseConfig;
`;
}

function makeEncryptionConfig(): string {
	return `import { defineConfig } from "kura";
import env from "#start/env";

/**
 * Encryption configuration.
 */
const encryptionConfig = defineConfig({
\tdefault: "gcm",

\tlist: {
\t\tgcm: {
\t\t\tdriver: "aes-256-gcm",
\t\t\tkeys: [env.required("APP_KEY")],
\t\t\tid: "gcm",
\t\t},
\t},
});

export default encryptionConfig;
`;
}

function makeHashConfig(): string {
	return `import { defineConfig } from "kura";
import env from "#start/env";

/**
 * Hashing configuration.
 */
const hashConfig = defineConfig({
\tdefault: env.get("HASH_DRIVER", "bcrypt"),

\tlist: {
\t\tbcrypt: {
\t\t\tdriver: "bcrypt",
\t\t\talgorithm: "bcrypt",
\t\t\tcost: 12,
\t\t},

\t\targon2id: {
\t\t\tdriver: "argon2id",
\t\t\talgorithm: "argon2id",
\t\t\tmemoryCost: 65536,
\t\t\ttimeCost: 3,
\t\t\tparallelism: 4,
\t\t},

\t\targon2i: {
\t\t\tdriver: "argon2i",
\t\t\talgorithm: "argon2i",
\t\t\tmemoryCost: 65536,
\t\t\ttimeCost: 3,
\t\t\tparallelism: 4,
\t\t},
\t},
});

export default hashConfig;
`;
}

function makeLoggerConfig(): string {
	return `import { defineConfig } from "kura";
import env from "#start/env";

/**
 * Logger configuration.
 */
const loggerConfig = defineConfig({
\tdefault: "app",

\tloggers: {
\t\tapp: {
\t\t\tenabled: true,
\t\t\tname: env.get("APP_NAME", "kura"),
\t\t\tlevel: env.get("LOG_LEVEL", "info"),
\t\t\ttransport: {
\t\t\t\ttargets: [
\t\t\t\t\t{
\t\t\t\t\t\ttarget: "stdout",
\t\t\t\t\t\tlevel: env.get("LOG_LEVEL", "info"),
\t\t\t\t\t},
\t\t\t\t],
\t\t\t},
\t\t},
\t},
});

export default loggerConfig;
`;
}

function makeQueueConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura";
import env from "#start/env";

/**
 * Queue configuration.
 */
const queueConfig = defineConfig({
\tdefault: env.get("QUEUE_CONNECTION", "${choices.queue}"),

\tconnections: {
\t\tnone: {
\t\t\tdriver: "none",
\t\t},

\t\tmemory: {
\t\t\tdriver: "memory",
\t\t\tqueue: "default",
\t\t},

\t\tsqlite: {
\t\t\tdriver: "sqlite",
\t\t\tfilename: "database/queue.sqlite",
\t\t\ttable: "jobs",
\t\t\tqueue: "default",
\t\t},

\t\tredis: {
\t\t\tdriver: "redis",
\t\t\turl: env.get("REDIS_URL", "redis://localhost:6379"),
\t\t\tqueue: "default",
\t\t},
\t},
});

export default queueConfig;
`;
}

function makeSessionConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura";
import env from "#start/env";

/**
 * Session configuration.
 */
const sessionConfig = defineConfig({
\tenabled: ${choices.auth === "session" ? "true" : "false"},
\tcookieName: env.get("SESSION_COOKIE_NAME", "kura-session"),
\tclearWithBrowser: false,
\tage: "2h",

\tcookie: {
\t\tpath: "/",
\t\thttpOnly: true,
\t\tsecure: env.get<string>("NODE_ENV", "development") === "production",
\t\tsameSite: "lax",
\t},

\tstore: env.get("SESSION_DRIVER", "${choices.auth === "session" ? "cookie" : "memory"}"),

\tstores: {
\t\tmemory: {
\t\t\tdriver: "memory",
\t\t},

\t\tcookie: {
\t\t\tdriver: "cookie",
\t\t},

\t\tdatabase: {
\t\t\tdriver: "database",
\t\t\tconnection: env.get("DB_CONNECTION", "sqlite"),
\t\t\ttable: "sessions",
\t\t},
\t},
});

export default sessionConfig;
`;
}

function makeShieldConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura";

/**
 * Security header and CSRF configuration.
 */
const shieldConfig = defineConfig({
\tenabled: ${choices.preset === "api" ? "false" : "true"},

\tcsp: {
\t\tenabled: false,
\t\tdirectives: {},
\t\treportOnly: false,
\t},

\tcsrf: {
\t\tenabled: ${choices.preset === "api" ? "false" : "true"},
\t\texceptRoutes: [],
\t\tenableXsrfCookie: false,
\t\tmethods: ["POST", "PUT", "PATCH", "DELETE"],
\t},

\txFrame: {
\t\tenabled: true,
\t\taction: "DENY",
\t},

\thsts: {
\t\tenabled: true,
\t\tmaxAge: "180 days",
\t},

\tcontentTypeSniffing: {
\t\tenabled: true,
\t},
});

export default shieldConfig;
`;
}

function makeStaticConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura";

/**
 * Static file server configuration.
 */
const staticServerConfig = defineConfig({
\tenabled: ${choices.preset === "api" ? "false" : "true"},
\troot: "public",
\tetag: true,
\tlastModified: true,
\tdotFiles: "ignore",
});

export default staticServerConfig;
`;
}

function makeViteConfig(): string {
	return `import { defineConfig } from "kura";

/**
 * Frontend asset pipeline configuration.
 */
const viteConfig = defineConfig({
\tbuildDirectory: "public/assets",
\tmanifestFile: "public/assets/.vite/manifest.json",
\tassetsUrl: "/assets",
\tscriptAttributes: {
\t\tdefer: true,
\t},
});

export default viteConfig;
`;
}

function makeApiController(choices: NewAppChoices): string {
	return `import type { Context } from "kura";

export class ApiController {
\tindex(_ctx: Context): Response {
\t\treturn Response.json({
\t\t\tframework: "kura",
\t\t\tpreset: "${choices.preset}",
\t\t\tok: true,
\t\t});
\t}

\thealth(_ctx: Context): Response {
\t\treturn Response.json({ status: "up" });
\t}
}
`;
}

function makeHomeController(): string {
	return `import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "kura";

const homeViewPath = join(import.meta.dir, "../../resources/views/home.html");

export class HomeController {
\tasync index(_ctx: Context): Promise<Response> {
\t\tconst html = await readFile(homeViewPath, "utf8");

\t\treturn new Response(html, {
\t\t\theaders: {
\t\t\t\t"Content-Type": "text/html; charset=utf-8",
\t\t\t},
\t\t});
\t}
}
`;
}

function makeHomeView(choices: NewAppChoices): string {
	return `<!doctype html>
<html lang="en">
\t<head>
\t\t<meta charset="utf-8">
\t\t<meta name="viewport" content="width=device-width, initial-scale=1">
\t\t<title>Kura</title>
\t\t<style>
\t\t\t:root {
\t\t\t\tcolor-scheme: light dark;
\t\t\t\tfont-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
\t\t\t}

\t\t\tbody {
\t\t\t\tmargin: 0;
\t\t\t\tmin-height: 100vh;
\t\t\t\tdisplay: grid;
\t\t\t\tplace-items: center;
\t\t\t\tbackground: #101318;
\t\t\t\tcolor: #f5f7fb;
\t\t\t}

\t\t\tmain {
\t\t\t\twidth: min(680px, calc(100vw - 48px));
\t\t\t}

\t\t\th1 {
\t\t\t\tfont-size: clamp(2.4rem, 7vw, 5rem);
\t\t\t\tline-height: 1;
\t\t\t\tmargin: 0 0 1rem;
\t\t\t}

\t\t\tp {
\t\t\t\tcolor: #aeb7c8;
\t\t\t\tfont-size: 1.1rem;
\t\t\t\tline-height: 1.6;
\t\t\t}

\t\t\tcode {
\t\t\t\tbackground: #202633;
\t\t\t\tborder-radius: 6px;
\t\t\t\tpadding: 0.2rem 0.4rem;
\t\t\t}
\t\t</style>
\t</head>
\t<body>
\t\t<main>
\t\t\t<h1>Kura</h1>
\t\t\t<p>Your ${choices.preset} app is running. Edit <code>resources/views/home.html</code> or <code>app/controllers/HomeController.ts</code> to start building.</p>
\t\t</main>
\t</body>
</html>
`;
}

function makeAuthController(choices: NewAppChoices): string {
	return `import type { Context } from "kura";

export class AuthController {
\tme(ctx: Context): Response {
\t\treturn json({
\t\t\tguard: ctx.auth?.guard ?? "${choices.auth}",
\t\t\tuser: ctx.auth?.user ?? null,
\t\t});
\t}

\tlogin(_ctx: Context): Response {
\t\treturn json(
\t\t\t{
\t\t\t\tmessage: "Wire this action to your ${choices.auth} guard and user provider.",
\t\t\t},
\t\t\t501,
\t\t);
\t}

\tlogout(_ctx: Context): Response {
\t\treturn json({ ok: true });
\t}
}

function json(data: Record<string, unknown>, status = 200): Response {
\treturn new Response(JSON.stringify(data), {
\t\tstatus,
\t\theaders: {
\t\t\t"Content-Type": "application/json",
\t\t},
\t});
}
`;
}

function makeUserModel(): string {
	return `import { BaseModel, column, type QueryRow } from "kura";

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

function makeUsersMigration(): string {
	return `import { Migration, type SchemaBuilder } from "kura";

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

function makeSessionsMigration(): string {
	return `import { Migration, type SchemaBuilder } from "kura";

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

function makeMailConfig(): string {
	return `import { defineConfig } from "kura";
import env from "#start/env";

const mailConfig = defineConfig({
\tdefault: env.get("MAIL_MAILER", "log"),

\tmailers: {
\t\tlog: {
\t\t\tdriver: "log",
\t\t},
\t},
});

export default mailConfig;
`;
}

function makeWelcomeMail(): string {
	return `export type WelcomeMailData = {
\treadonly name: string;
};

export class WelcomeMail {
\tconstructor(public readonly data: WelcomeMailData) {}

\tsubject(): string {
\t\treturn "Welcome to Kura";
\t}

\thtml(): string {
\t\treturn \`<p>Welcome, \${this.data.name}.</p>\`;
\t}
}
`;
}

function makeStorageConfig(): string {
	return `import { defineConfig } from "kura";

const storageConfig = defineConfig({
\tdefault: "local",

\tdisks: {
\t\tlocal: {
\t\t\tdriver: "local",
\t\t\troot: "storage/app",
\t\t},
\t},
});

export default storageConfig;
`;
}

function makeStorageService(): string {
	return `import { join } from "node:path";

export class StorageService {
\tconstructor(private readonly root = "storage/app") {}

\tpath(key: string): string {
\t\treturn join(this.root, key);
\t}

\tfile(key: string): Bun.BunFile {
\t\treturn Bun.file(this.path(key));
\t}
}
`;
}

function makeI18nConfig(): string {
	return `import { defineConfig } from "kura";

const i18nConfig = defineConfig({
\tdefaultLocale: "en",
\tfallbackLocale: "en",
\tloaders: {
\t\tmessages: "resources/lang/{locale}/messages.ts",
\t},
});

export default i18nConfig;
`;
}

function makeEnglishMessages(): string {
	return `export const messages = {
\twelcome: "Welcome to Kura",
} as const;
`;
}

function makeWebSocketsConfig(): string {
	return `import { defineConfig } from "kura";

const websocketsConfig = defineConfig({
\tenabled: true,
\tpath: "/ws",
\theartbeatInterval: 30000,
});

export default websocketsConfig;
`;
}

function makeWebSocketService(): string {
	return `export class WebSocketService {
\tprivate readonly clients = new Set<WebSocket>();

\tadd(client: WebSocket): void {
\t\tthis.clients.add(client);
\t}

\tremove(client: WebSocket): void {
\t\tthis.clients.delete(client);
\t}

\tbroadcast(message: string): void {
\t\tfor (const client of this.clients) {
\t\t\tclient.send(message);
\t\t}
\t}
}
`;
}

function makeRoutes(choices: NewAppChoices): string {
	const imports = ['import { Router } from "kura";'];
	const lines = ["export const router = new Router();"];

	if (choices.preset === "api" || choices.preset === "full") {
		imports.push('import { ApiController } from "#controllers/ApiController";');
		lines.push("", "const apiController = new ApiController();");
	}

	if (choices.preset === "web" || choices.preset === "full") {
		imports.push(
			'import { HomeController } from "#controllers/HomeController";',
		);
		lines.push("", "const homeController = new HomeController();");
	}

	if (choices.auth !== "none") {
		imports.push(
			'import { AuthController } from "#controllers/AuthController";',
		);
		lines.push("", "const authController = new AuthController();");
	}

	if (choices.preset === "api") {
		lines.push(
			"",
			'router.get("/", (ctx) => apiController.index(ctx)).as("home");',
			'router.get("/health", (ctx) => apiController.health(ctx)).as("health");',
		);
	}

	if (choices.preset === "web") {
		lines.push(
			"",
			'router.get("/", (ctx) => homeController.index(ctx)).as("home");',
			'router.get("/health", () => Response.json({ status: "up" })).as("health");',
		);
	}

	if (choices.preset === "full") {
		lines.push(
			"",
			'router.get("/", (ctx) => homeController.index(ctx)).as("home");',
			"",
			'router.group().prefix("/api").as("api.").routes((api) => {',
			'\tapi.get("/", (ctx) => apiController.index(ctx)).as("index");',
			'\tapi.get("/health", (ctx) => apiController.health(ctx)).as("health");',
			"});",
		);
	}

	if (choices.auth !== "none") {
		lines.push(
			"",
			'router.group().prefix("/auth").as("auth.").routes((auth) => {',
			'\tauth.get("/me", (ctx) => authController.me(ctx)).as("me");',
			'\tauth.post("/login", (ctx) => authController.login(ctx)).as("login");',
			'\tauth.post("/logout", (ctx) => authController.logout(ctx)).as("logout");',
			"});",
		);
	}

	return `${imports.join("\n")}\n\n${lines.join("\n")}\n`;
}

function makeReadme(appName: string, choices: NewAppChoices): string {
	return `# ${appName}

Generated with Kura.

## Stack

- Preset: ${choices.preset}
- Database: ${choices.database}
- Auth: ${choices.auth}
- Cache: ${choices.cache}
- Queue: ${choices.queue}
- Modules: ${choices.modules.length > 0 ? choices.modules.join(", ") : "none"}

## Generated Starter

${makeGeneratedStarterBullets(choices)}

## Development

\`\`\`sh
bun install
bun kura
bun run dev
\`\`\`

Open http://localhost:3333.

## Commands

\`\`\`sh
bun kura
bun kura make:controller Home
bun kura serve --watch
\`\`\`

## Structure

- \`app/\`: controllers, middleware, models, policies, validators, and domain code.
- \`bin/\`: console, server, and test entrypoints.
- \`config/\`: application and module configuration.
- \`database/\`: migrations, seeders, factories, and generated schema metadata.
- \`start/\`: environment, kernel, and routes loaded during boot.
- \`kura.config.ts\`: Kura application manifest.
`;
}

function makeGeneratedStarterBullets(choices: NewAppChoices): string {
	const bullets = [
		"- HTTP kernel: `bin/server.ts` loads `start/kernel.ts` middleware before dispatching routes.",
	];

	if (choices.preset === "api" || choices.preset === "full") {
		bullets.push(
			"- API: `app/controllers/ApiController.ts` backs the JSON routes.",
		);
	}

	if (choices.preset === "web" || choices.preset === "full") {
		bullets.push(
			"- Web: `app/controllers/HomeController.ts` serves `resources/views/home.html`.",
		);
	}

	if (choices.auth !== "none") {
		bullets.push(
			"- Auth: `app/controllers/AuthController.ts`, `app/models/User.ts`, and user migrations are scaffolded.",
		);
	}

	for (const module of choices.modules) {
		bullets.push(
			`- ${formatModuleName(module)}: starter config and source files are scaffolded.`,
		);
	}

	return bullets.join("\n");
}

function formatModuleName(module: string): string {
	if (module === "i18n") {
		return "i18n";
	}

	if (module === "websockets") {
		return "WebSockets";
	}

	return module.charAt(0).toUpperCase() + module.slice(1);
}

function slugify(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_.-]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return slug || "kura-app";
}

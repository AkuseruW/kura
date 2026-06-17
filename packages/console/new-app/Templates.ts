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
			content: `import { Server } from "kura";
import env from "#start/env";
import { router } from "#start/routes";

export { router };
export default router;

export function createServer(): Server {
\tconst server = new Server({
\t\tport: env.number("PORT", 3333) ?? 3333,
\t});

\tserver.setRouter(router);

\treturn server;
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
		...makeNewAppDirectories(["providers", ".kura/server", "tests"]),
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

function makeRoutes(choices: NewAppChoices): string {
	return `import { Router } from "kura";

export const router = new Router();

router.get("/", () =>
\tResponse.json({
\t\tframework: "kura",
\t\tpreset: "${choices.preset}",
\t\tok: true,
\t}),
);

router.get("/health", () => Response.json({ status: "up" }));
`;
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

function slugify(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_.-]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return slug || "kura-app";
}

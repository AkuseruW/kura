import { moduleImport, usesDatabaseFiles } from "./ScaffoldPaths";
import type { NewAppChoices } from "./Types";

export function makePackageJson(
	appName: string,
	packageVersion: string,
	choices: NewAppChoices,
) {
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
			routes: "bun bin/console.ts routes",
			doctor: "bun bin/console.ts doctor",
			env: "bun bin/console.ts env",
			config: "bun bin/console.ts config",
			test: "bun bin/test.ts",
			typecheck: "tsc --noEmit",
			build: makeBuildScript(choices),
		},
		imports: {
			"#controllers/*": "./app/controllers/*.ts",
			"#modules/*": "./app/modules/*.ts",
			"#domains/*": "./app/domains/*.ts",
			"#contracts/*": "./app/contracts/*.ts",
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

function makeBuildScript(choices: NewAppChoices): string {
	const rootOption = choices.preset === "full" ? " --root ." : "";

	return `bun build bin/server.ts --target=bun --production --outdir=build --packages=external${rootOption}`;
}

export function makeTsConfig(choices: NewAppChoices): string {
	const libs = choices.preset === "full" ? ["ESNext", "DOM"] : ["ESNext"];
	const libJson = `[${libs.map((lib) => `"${lib}"`).join(", ")}]`;

	return `{
\t"compilerOptions": {
\t\t"lib": ${libJson},
\t\t"target": "ESNext",
\t\t"module": "Preserve",
\t\t"moduleResolution": "bundler",
\t\t"baseUrl": ".",
\t\t"paths": {
\t\t\t"#controllers/*": ["app/controllers/*"],
\t\t\t"#modules/*": ["app/modules/*"],
\t\t\t"#domains/*": ["app/domains/*"],
\t\t\t"#contracts/*": ["app/contracts/*"],
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
`;
}

export function makeConsoleEntrypoint(choices: NewAppChoices): string {
	const devToolStaticRoutes =
		choices.preset === "full"
			? `,\n\tloadStaticRoutes: async () => {\n\t\tconst server = await import("./server");\n\t\treturn server.staticRoutes;\n\t}`
			: "";

	return `import {
\tcreateConsole,
\tregisterDevToolCommands,
\tregisterGeneratorCommands,
\tregisterServeCommand,
} from "kura/console";

await import("#start/env");

const appConsole = createConsole();

registerGeneratorCommands(appConsole, {
\tarchitecture: "${choices.architecture}",
});
registerServeCommand(appConsole, {
\tentry: "bin/server.ts",
});
registerDevToolCommands(appConsole, {
\troot: process.cwd(),
\tloadRouter: async () => {
\t\tconst routes = await import("#start/routes");
\t\treturn routes.router;
\t}${devToolStaticRoutes},
});

const exitCode = await appConsole.run(Bun.argv.slice(2));
process.exit(exitCode);
`;
}

export function makeServerEntrypoint(choices: NewAppChoices): string {
	const imports =
		choices.preset === "full"
			? `import {
\ttype BunDevelopmentOptions,
\ttype BunStaticRouteMap,
\ttype Context,
\tMiddlewarePipeline,
\tServer,
} from "kura/http";
import home from "../resources/pages/home.html";
import handleException from "#exceptions/handler";
import env from "#start/env";
import { routerMiddleware, serverMiddleware } from "#start/kernel";
import { router } from "#start/routes";`
			: `import { type Context, MiddlewarePipeline, Server } from "kura/http";
import handleException from "#exceptions/handler";
import env from "#start/env";
import { routerMiddleware, serverMiddleware } from "#start/kernel";
import { router } from "#start/routes";`;
	const staticRouteExports =
		choices.preset === "full"
			? `
export const staticRoutes = {
\t"/": home,
} satisfies BunStaticRouteMap;

export const development = (
\tenv.get<string>("NODE_ENV", "development") === "production"
\t\t? false
\t\t: {
\t\t\t\thmr: true,
\t\t\t\tconsole: true,
\t\t\t}
) satisfies BunDevelopmentOptions;
`
			: "";
	const serverOptions =
		choices.preset === "full"
			? `{
\t\tport: env.number("PORT", 3333) ?? 3333,
\t\thostname: env.get("HOST", "localhost"),
\t\tenvironment: env.get("NODE_ENV", "development"),
\t\terrorHandler: handleException,
\t\tstaticRoutes,
\t\tdevelopment,
\t}`
			: `{
\t\tport: env.number("PORT", 3333) ?? 3333,
\t\thostname: env.get("HOST", "localhost"),
\t\tenvironment: env.get("NODE_ENV", "development"),
\t\terrorHandler: handleException,
\t}`;

	return `${imports}

export { router };
export default router;
${staticRouteExports}
export const handler = createHandler();

function createHandler() {
\tconst pipeline = new MiddlewarePipeline();

\tfor (const middleware of serverMiddleware) {
\t\tpipeline.use(middleware);
\t}

\tfor (const middleware of routerMiddleware) {
\t\tpipeline.use(middleware);
\t}

\treturn pipeline.toHandler(dispatchRouter);
}

export function createServer(): Server {
\tconst server = new Server(${serverOptions});

\tserver.setHandler(handler);

\treturn server;
}

function dispatchRouter(ctx: Context): Response | Promise<Response> {
\treturn router.dispatch(ctx);
}

if (import.meta.main) {
\tconst server = createServer();
\tserver.start();
\tconsole.log(
\t\t\`Kura app listening on http://\${env.get("HOST", "localhost")}:\${env.number("PORT", 3333)}\`,
\t);
}
`;
}

export function makeEnvExample(choices: NewAppChoices): string {
	return makeEnvFile(choices, "change-me-in-production");
}

export function makeEnv(choices: NewAppChoices): string {
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
	];

	if (choices.auth !== "none") {
		lines.push("HASH_DRIVER=bcrypt");
		lines.push(
			`AUTH_GUARD=${choices.auth === "session" ? "web" : choices.auth === "access-token" ? "api" : "none"}`,
		);
	}

	if (choices.auth === "session") {
		lines.push("SESSION_DRIVER=cookie");
	}

	if (choices.cache !== "memory") {
		lines.push(`CACHE_STORE=${choices.cache}`);
	}

	if (choices.queue !== "none") {
		lines.push(`QUEUE_CONNECTION=${choices.queue}`);
	}

	if (usesDatabaseFiles(choices)) {
		lines.push(
			`DB_CONNECTION=${choices.database === "none" ? "memory" : choices.database}`,
		);
		lines.push("DATABASE_URL=");
	}

	if (choices.cache === "redis" || choices.queue === "redis") {
		lines.push("REDIS_URL=");
	}

	return `${lines.join("\n")}\n`;
}

export function makeKuraConfig(): string {
	return `import { defineConfig } from "kura/config";

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
\t\tmodules: "#modules/*",
\t\tdomains: "#domains/*",
\t\tcontracts: "#contracts/*",
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

export function makeAppConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura/config";
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
\t\tarchitecture: "${choices.architecture}",
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

export function makeAuthConfig(choices: NewAppChoices): string {
	const userModelImport =
		choices.architecture === "domain"
			? "#domains/auth/infrastructure/persistence/user_record"
			: moduleImport(choices, "auth", "user", "#models/user");

	return `import { defineConfig } from "kura/config";
import env from "#start/env";

/**
 * Authentication configuration.
 *
 * Support level: starter. The generated auth service uses demo persistence;
 * review storage, token/session security, and password policy before production.
 */
const authConfig = defineConfig({
\tenabled: ${choices.auth === "none" ? "false" : "true"},
\tdefault: env.get("AUTH_GUARD", "${choices.auth === "session" ? "web" : choices.auth === "access-token" ? "api" : "none"}"),

\tguards: {
\t\tweb: {
\t\t\tdriver: "session",
\t\t\tuseRememberMeTokens: false,
\t\t\tprovider: {
\t\t\t\ttype: "model",
\t\t\t\tmodel: "${userModelImport}",
\t\t\t},
\t\t},

\t\tapi: {
\t\t\tdriver: "access_tokens",
\t\t\tprovider: {
\t\t\t\ttype: "model",
\t\t\t\tmodel: "${userModelImport}",
\t\t\t},
\t\t},
\t},
});

export default authConfig;
`;
}

export function makeBodyParserConfig(): string {
	return `import { defineConfig } from "kura/config";

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

export function makeCacheConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura/config";
import env from "#start/env";

/**
 * Cache configuration.
 *
 * Support level: runtime-ready for memory/file stores; config-only for Redis
 * until a Redis client is registered in the application.
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

export function makeDatabaseConfig(choices: NewAppChoices): string {
	const defaultConnection =
		choices.database === "none" ? "memory" : choices.database;

	return `import { defineConfig } from "kura/config";
import env from "#start/env";

/**
 * Database configuration.
 *
 * Support level: config-only for SQL connections. Register a database driver
 * before running real queries or migrations.
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

export function makeEncryptionConfig(): string {
	return `import { defineConfig } from "kura/config";
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

export function makeHashConfig(): string {
	return `import { defineConfig } from "kura/config";
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

export function makeLoggerConfig(): string {
	return `import { defineConfig } from "kura/config";
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

export function makeQueueConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura/config";
import env from "#start/env";

/**
 * Queue configuration.
 *
 * Support level: runtime-ready for memory/sqlite workers; config-only for Redis
 * until a Redis client is registered in the application.
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

export function makeSessionConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura/config";
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

export function makeShieldConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura/config";

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

export function makeStaticConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura/config";

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

function slugify(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_.-]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return slug || "kura-app";
}

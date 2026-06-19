import { featureSupportRows } from "./FeatureStatus";
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
			content: makeTsConfig(choices),
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
			content: makeConsoleEntrypoint(choices),
		},
		{
			path: "bin/server.ts",
			content: makeServerEntrypoint(choices),
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
			path: "config/bodyparser.ts",
			content: makeBodyParserConfig(),
		},
		{
			path: "config/logger.ts",
			content: makeLoggerConfig(),
		},
		...makeFeatureConfigFiles(choices),
		{
			path: "start/routes.ts",
			content: makeRoutes(choices),
		},
		...makePresetFiles(choices),
		...makeAuthFiles(choices),
		...makeOptionalModuleFiles(choices),
		...makeScaffoldDirectories(choices),
		...makeDatabaseMetadataFiles(choices),
		{
			path: "tests/bootstrap.ts",
			content: `export const runnerHooks = {
\tsetup: [],
\tteardown: [],
};
`,
		},
		{
			path: "README.md",
			content: makeReadme(appName, choices),
		},
	];
}

function makeFeatureConfigFiles(choices: NewAppChoices): readonly NewAppFile[] {
	const files: NewAppFile[] = [];

	if (choices.auth !== "none") {
		files.push(
			{
				path: "config/auth.ts",
				content: makeAuthConfig(choices),
			},
			{
				path: "config/encryption.ts",
				content: makeEncryptionConfig(),
			},
			{
				path: "config/hash.ts",
				content: makeHashConfig(),
			},
		);
	}

	if (choices.auth === "session") {
		files.push({
			path: "config/session.ts",
			content: makeSessionConfig(choices),
		});
	}

	if (usesDatabaseFiles(choices)) {
		files.push({
			path: "config/database.ts",
			content: makeDatabaseConfig(choices),
		});
	}

	if (choices.cache !== "memory") {
		files.push({
			path: "config/cache.ts",
			content: makeCacheConfig(choices),
		});
	}

	if (choices.queue !== "none") {
		files.push({
			path: "config/queue.ts",
			content: makeQueueConfig(choices),
		});
	}

	if (choices.preset !== "api") {
		files.push(
			{
				path: "config/shield.ts",
				content: makeShieldConfig(choices),
			},
			{
				path: "config/static.ts",
				content: makeStaticConfig(choices),
			},
		);
	}

	return files;
}

function makeDatabaseMetadataFiles(
	choices: NewAppChoices,
): readonly NewAppFile[] {
	if (!usesDatabaseFiles(choices)) {
		return [];
	}

	return [
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
	];
}

function usesDatabaseFiles(choices: NewAppChoices): boolean {
	return choices.database !== "none" || choices.auth !== "none";
}

function makeScaffoldDirectories(
	choices: NewAppChoices,
): readonly NewAppDirectory[] {
	const directories = new Set<string>();

	if (choices.cache === "file") {
		directories.add("tmp/cache");
	}

	if (choices.preset !== "api") {
		directories.add("public");
	}

	if (choices.modules.includes("storage")) {
		directories.add("storage/app");
	}

	return makeNewAppDirectories([...directories].sort());
}

function makeNewAppDirectories(
	paths: readonly string[],
): readonly NewAppDirectory[] {
	return paths.map((path) => ({ kind: "directory" as const, path }));
}

function apiControllerPath(choices: NewAppChoices): string {
	return sourcePath(
		choices,
		"api",
		"api_controller.ts",
		"app/controllers",
		"http",
	);
}

function homeControllerPath(choices: NewAppChoices): string {
	return sourcePath(
		choices,
		"web",
		"home_controller.ts",
		"app/controllers",
		"http",
	);
}

function authControllerPath(choices: NewAppChoices): string {
	return sourcePath(
		choices,
		"auth",
		"auth_controller.ts",
		"app/controllers",
		"http",
	);
}

function authServicePath(choices: NewAppChoices): string {
	return sourcePath(
		choices,
		"auth",
		"auth_service.ts",
		"app/services",
		"application",
	);
}

function userModelPath(choices: NewAppChoices): string {
	if (choices.architecture === "domain") {
		return "app/domains/auth/infrastructure/persistence/user_record.ts";
	}

	return sourcePath(choices, "auth", "user.ts", "app/models");
}

function userDomainEntityPath(): string {
	return "app/domains/auth/domain/user.ts";
}

function userRepositoryPath(): string {
	return "app/domains/auth/domain/user_repository.ts";
}

function registerUserUseCasePath(): string {
	return "app/domains/auth/application/register_user.ts";
}

function sqlUserRepositoryPath(): string {
	return "app/domains/auth/infrastructure/persistence/sql_user_repository.ts";
}

function moduleSourcePath(
	choices: NewAppChoices,
	moduleName: "mail" | "storage" | "websockets",
	fileName: string,
): string {
	if (choices.architecture === "domain") {
		return `app/domains/${moduleName}/infrastructure/${fileName}`;
	}

	if (choices.architecture === "modular") {
		return `app/modules/${moduleName}/${fileName}`;
	}

	if (moduleName === "mail") {
		return `app/mails/${fileName}`;
	}

	return `app/services/${fileName}`;
}

function sourcePath(
	choices: NewAppChoices,
	moduleName: string,
	fileName: string,
	standardDirectory: string,
	domainLayer = "domain",
): string {
	if (choices.architecture === "domain") {
		return `app/domains/${moduleName}/${domainLayer}/${fileName}`;
	}

	if (choices.architecture === "modular") {
		return `app/modules/${moduleName}/${fileName}`;
	}

	return `${standardDirectory}/${fileName}`;
}

function moduleImport(
	choices: NewAppChoices,
	moduleName: string,
	fileNameWithoutExtension: string,
	standardAlias: string,
	domainLayer = "domain",
): string {
	if (choices.architecture === "domain") {
		return `#domains/${moduleName}/${domainLayer}/${fileNameWithoutExtension}`;
	}

	if (choices.architecture === "modular") {
		return `#modules/${moduleName}/${fileNameWithoutExtension}`;
	}

	return standardAlias;
}

function makePresetFiles(choices: NewAppChoices): readonly NewAppFile[] {
	const files: NewAppFile[] = [];

	if (choices.preset === "api" || choices.preset === "full") {
		files.push({
			path: apiControllerPath(choices),
			content: makeApiController(choices),
		});
	}

	if (choices.preset === "web") {
		files.push(
			{
				path: homeControllerPath(choices),
				content: makeHomeController(choices),
			},
			{
				path: "resources/views/home.kura.html",
				content: makeHomeView(choices),
			},
		);
	}

	if (choices.preset === "full") {
		files.push(
			{
				path: "resources/pages/home.html",
				content: makeFullstackHomePage(),
			},
			{
				path: "resources/client/app.ts",
				content: makeFullstackClient(),
			},
			{
				path: "resources/css/app.css",
				content: makeFullstackCss(),
			},
		);
	}

	return files;
}

function makeAuthFiles(choices: NewAppChoices): readonly NewAppFile[] {
	if (choices.auth === "none") {
		return [];
	}

	if (choices.architecture === "domain") {
		return [
			{
				path: authControllerPath(choices),
				content: makeAuthController(choices),
			},
			{
				path: authServicePath(choices),
				content: makeAuthService(choices),
			},
			{
				path: userDomainEntityPath(),
				content: makeDomainUserEntity(),
			},
			{
				path: userRepositoryPath(),
				content: makeUserRepositoryPort(),
			},
			{
				path: registerUserUseCasePath(),
				content: makeRegisterUserUseCase(),
			},
			{
				path: userModelPath(choices),
				content: makeUserRecord(),
			},
			{
				path: sqlUserRepositoryPath(),
				content: makeSqlUserRepository(),
			},
			{
				path: "database/migrations/00000000000000_create_users.ts",
				content: makeUsersMigration(),
			},
			...(choices.auth === "access-token"
				? [
						{
							path: "database/migrations/00000000000001_create_access_tokens.ts",
							content: makeAccessTokensMigration(),
						},
					]
				: []),
			...(choices.auth === "session"
				? [
						{
							path: "database/migrations/00000000000001_create_sessions.ts",
							content: makeSessionsMigration(),
						},
					]
				: []),
		];
	}

	const files: NewAppFile[] = [
		{
			path: authControllerPath(choices),
			content: makeAuthController(choices),
		},
		{
			path: authServicePath(choices),
			content: makeAuthService(choices),
		},
		{
			path: userModelPath(choices),
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

	if (choices.auth === "access-token") {
		files.push({
			path: "database/migrations/00000000000001_create_access_tokens.ts",
			content: makeAccessTokensMigration(),
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
				path: moduleSourcePath(choices, "mail", "welcome_mail.ts"),
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
				path: moduleSourcePath(choices, "storage", "storage_service.ts"),
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
				path: moduleSourcePath(choices, "websockets", "websocket_service.ts"),
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
			routes: "bun bin/console.ts routes",
			doctor: "bun bin/console.ts doctor",
			env: "bun bin/console.ts env",
			config: "bun bin/console.ts config",
			test: "bun bin/test.ts",
			typecheck: "tsc --noEmit",
			build:
				"bun build bin/server.ts --target=bun --production --outdir=build --packages=external",
		},
		imports: {
			"#controllers/*": "./app/controllers/*.ts",
			"#modules/*": "./app/modules/*.ts",
			"#domains/*": "./app/domains/*.ts",
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

function makeTsConfig(choices: NewAppChoices): string {
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

function makeConsoleEntrypoint(choices: NewAppChoices): string {
	const devToolStaticRoutes =
		choices.preset === "full"
			? `,\n\tloadStaticRoutes: async () => {\n\t\tconst server = await import("./server");\n\t\treturn server.staticRoutes;\n\t}`
			: "";

	return `import {
\tcreateConsole,
\tregisterDevToolCommands,
\tregisterGeneratorCommands,
\tregisterServeCommand,
} from "kura";

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

function makeServerEntrypoint(choices: NewAppChoices): string {
	const imports =
		choices.preset === "full"
			? `import {
\ttype BunDevelopmentOptions,
\ttype BunStaticRouteMap,
\ttype Context,
\tMiddlewarePipeline,
\tServer,
} from "kura";
import home from "../resources/pages/home.html";
import env from "#start/env";
import { routerMiddleware, serverMiddleware } from "#start/kernel";
import { router } from "#start/routes";`
			: `import { type Context, MiddlewarePipeline, Server } from "kura";
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
\t\tstaticRoutes,
\t\tdevelopment,
\t}`
			: `{
\t\tport: env.number("PORT", 3333) ?? 3333,
\t\thostname: env.get("HOST", "localhost"),
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
`;
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
\t\tmodules: "#modules/*",
\t\tdomains: "#domains/*",
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

function makeAuthConfig(choices: NewAppChoices): string {
	const userModelImport =
		choices.architecture === "domain"
			? "#domains/auth/infrastructure/persistence/user_record"
			: moduleImport(choices, "auth", "user", "#models/user");

	return `import { defineConfig } from "kura";
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

function makeDatabaseConfig(choices: NewAppChoices): string {
	const defaultConnection =
		choices.database === "none" ? "memory" : choices.database;

	return `import { defineConfig } from "kura";
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

function makeHomeController(choices: NewAppChoices): string {
	return `import { type Context, view } from "kura";

export class HomeController {
\tasync index(_ctx: Context): Promise<Response> {
\t\treturn view("home", {
\t\t\tpreset: "${choices.preset}",
\t\t});
\t}
}
`;
}

function makeHomeView(_choices: NewAppChoices): string {
	return `<!doctype html>
<html lang="en">
\t<head>
\t\t<meta charset="utf-8">
\t\t<meta name="viewport" content="width=device-width, initial-scale=1">
\t\t<title>Kura</title>
\t</head>
\t<body>
\t\t<h1>Kura</h1>
\t\t<p>{{ preset }} app</p>
\t</body>
</html>
`;
}

function makeFullstackHomePage(): string {
	return `<!doctype html>
<html lang="en">
\t<head>
\t\t<meta charset="utf-8">
\t\t<meta name="viewport" content="width=device-width, initial-scale=1">
\t\t<title>Kura</title>
\t\t<link rel="stylesheet" href="../css/app.css">
\t</head>
\t<body>
\t\t<main>
\t\t\t<h1>Kura</h1>
\t\t\t<p data-status>Loading application status...</p>
\t\t</main>
\t\t<script type="module" src="../client/app.ts"></script>
\t</body>
</html>
`;
}

function makeFullstackClient(): string {
	return `export {};

const statusElement = document.querySelector("[data-status]");

if (statusElement) {
\tconst response = await fetch("/api/health");
\tconst health = (await response.json()) as { readonly status: string };

\tstatusElement.textContent = \`API status: \${health.status}\`;
}
`;
}

function makeFullstackCss(): string {
	return `:root {
\tcolor-scheme: light dark;
\tfont-family:
\t\tInter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
\t\tsans-serif;
\tline-height: 1.5;
}

body {
\tdisplay: grid;
\tmin-height: 100vh;
\tmargin: 0;
\tplace-items: center;
\tbackground: Canvas;
\tcolor: CanvasText;
}

main {
\twidth: min(100% - 48px, 720px);
}

h1 {
\tmargin: 0 0 12px;
\tfont-size: 72px;
\tfont-weight: 800;
}

p {
\tmargin: 0;
\tcolor: color-mix(in srgb, CanvasText 72%, transparent);
\tfont-size: 18px;
}

@media (max-width: 560px) {
\th1 {
\t\tfont-size: 48px;
\t}
}
`;
}

function makeAuthController(choices: NewAppChoices): string {
	const authServiceImport = moduleImport(
		choices,
		"auth",
		"auth_service",
		"#services/auth_service",
		"application",
	);

	return `import type { Context } from "kura";
import { authService } from "${authServiceImport}";

export class AuthController {
	async me(ctx: Context): Promise<Response> {
		const user = await authService.authenticate(ctx);

		if (!user) {
			return json({ message: "Unauthenticated" }, 401);
		}

		return json({
			guard: ctx.auth?.guard ?? "${choices.auth === "session" ? "session" : "api"}",
			user,
		});
	}

	async login(ctx: Context): Promise<Response> {
		const input = readLoginInput(ctx);

		if (!input) {
			return json({ message: "Email and password are required." }, 422);
		}

		const result = await authService.login(input.email, input.password);

		if (!result) {
			return json({ message: "Invalid credentials." }, 401);
		}

		return json(result.body, 200, result.headers);
	}

	async register(ctx: Context): Promise<Response> {
		const input = readRegisterInput(ctx);

		if (!input) {
			return json({ message: "Email and password are required." }, 422);
		}

		const result = await authService.register(input.email, input.password);

		if (!result) {
			return json({ message: "Email is already registered." }, 409);
		}

		return json(result.body, 201, result.headers);
	}

	async logout(ctx: Context): Promise<Response> {
		const result = await authService.logout(ctx);

		if (!result) {
			return json({ message: "Unauthenticated" }, 401);
		}

		return json(result.body, 200, result.headers);
	}
}

type LoginInput = {
	readonly email: string;
	readonly password: string;
};

type RegisterInput = LoginInput;

function readLoginInput(ctx: Context): LoginInput | null {
	return readCredentialsInput(ctx);
}

function readRegisterInput(ctx: Context): RegisterInput | null {
	return readCredentialsInput(ctx);
}

function readCredentialsInput(ctx: Context): LoginInput | null {
	if (!isRecord(ctx.body)) {
		return null;
	}

	const email =
		typeof ctx.body.email === "string"
			? ctx.body.email.trim().toLowerCase()
			: "";
	const password =
		typeof ctx.body.password === "string" ? ctx.body.password : "";

	if (!email || !password) {
		return null;
	}

	return { email, password };
}

function json(
	body: Record<string, unknown>,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
`;
}

function makeAuthService(choices: NewAppChoices): string {
	return choices.auth === "session"
		? makeSessionAuthService()
		: makeAccessTokenAuthService();
}

function makeAccessTokenAuthService(): string {
	return `import {
	AccessTokenManager,
	Hash,
	MemoryAccessTokenStore,
	type Context,
} from "kura";

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
	return `import { Hash, type Context } from "kura";

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

function makeDomainUserEntity(): string {
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

function makeUserRepositoryPort(): string {
	return `import type { User } from "./user";

export interface UserRepository {
\tfindByEmail(email: string): Promise<User | null>;
\tsave(user: User): Promise<void>;
}
`;
}

function makeRegisterUserUseCase(): string {
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

function makeUserRecord(): string {
	return `import { BaseModel, column, type QueryRow } from "kura";

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

function makeSqlUserRepository(): string {
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

function makeAccessTokensMigration(): string {
	return `import { Migration, type SchemaBuilder } from "kura";

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

/**
 * Mail configuration.
 *
 * Support level: starter. Connect a real transport before sending email.
 */
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

/**
 * Storage configuration.
 *
 * Support level: starter. Review disks and public access before production.
 */
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

/**
 * i18n configuration.
 *
 * Support level: starter. Add locales and loaders as your app grows.
 */
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

/**
 * WebSocket configuration.
 *
 * Support level: starter. Wire upgrades and auth before production realtime.
 */
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
	const imports = [
		choices.preset === "api" || choices.preset === "full"
			? 'import { registerOpenApiRoutes, Router } from "kura";'
			: 'import { Router } from "kura";',
	];
	const lines = ["export const router = new Router();"];

	if (choices.preset === "api" || choices.preset === "full") {
		imports.push(
			`import { ApiController } from "${moduleImport(
				choices,
				"api",
				"api_controller",
				"#controllers/api_controller",
				"http",
			)}";`,
		);
		lines.push("", "const apiController = new ApiController();");
	}

	if (choices.preset === "web") {
		imports.push(
			`import { HomeController } from "${moduleImport(
				choices,
				"web",
				"home_controller",
				"#controllers/home_controller",
				"http",
			)}";`,
		);
		lines.push("", "const homeController = new HomeController();");
	}

	if (choices.auth !== "none") {
		imports.push(
			`import { AuthController } from "${moduleImport(
				choices,
				"auth",
				"auth_controller",
				"#controllers/auth_controller",
				"http",
			)}";`,
		);
		lines.push("", "const authController = new AuthController();");
	}

	const openApiSchemaDefinitions = makeOpenApiSchemaDefinitions(choices);
	if (openApiSchemaDefinitions.length > 0) {
		lines.push("", ...openApiSchemaDefinitions);
	}

	if (choices.preset === "api") {
		lines.push(
			"",
			'router.get("/", (ctx) => apiController.index(ctx)).as("home").openapi({',
			'\ttags: ["App"],',
			'\tsummary: "Application information",',
			"\tresponses: {",
			"\t\t200: appInfoResponseSchema,",
			"\t},",
			"});",
			'router.get("/health", (ctx) => apiController.health(ctx)).as("health").openapi({',
			'\ttags: ["Health"],',
			'\tsummary: "Health check",',
			"\tresponses: {",
			"\t\t200: healthResponseSchema,",
			"\t},",
			"});",
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
			'router.get("/health", (ctx) => apiController.health(ctx)).as("health").openapi({',
			'\ttags: ["Health"],',
			'\tsummary: "Health check",',
			"\tresponses: {",
			"\t\t200: healthResponseSchema,",
			"\t},",
			"});",
			'router.group().prefix("/api").as("api.").routes((api) => {',
			'\tapi.get("/", (ctx) => apiController.index(ctx)).as("index").openapi({',
			'\t\ttags: ["App"],',
			'\t\tsummary: "Application information",',
			"\t\tresponses: {",
			"\t\t\t200: appInfoResponseSchema,",
			"\t\t},",
			"\t});",
			'\tapi.get("/health", (ctx) => apiController.health(ctx)).as("health").openapi({',
			'\t\ttags: ["Health"],',
			'\t\tsummary: "Health check",',
			"\t\tresponses: {",
			"\t\t\t200: healthResponseSchema,",
			"\t\t},",
			"\t});",
			"});",
		);
	}

	if (choices.auth !== "none") {
		lines.push(
			"",
			'router.group().prefix("/auth").as("auth.").routes((auth) => {',
			'\tauth.get("/me", (ctx) => authController.me(ctx)).as("me").openapi({',
			'\t\ttags: ["Auth"],',
			'\t\tsummary: "Current authenticated user",',
			...(choices.auth === "access-token"
				? ["\t\tsecurity: [{ bearerAuth: [] }],"]
				: []),
			"\t\tresponses: {",
			"\t\t\t200: authCurrentUserResponseSchema,",
			'\t\t\t401: { description: "Unauthenticated", body: authMessageResponseSchema },',
			"\t\t},",
			"\t});",
			'\tauth.post("/login", (ctx) => authController.login(ctx)).as("login").openapi({',
			'\t\ttags: ["Auth"],',
			'\t\tsummary: "Login",',
			"\t\tbody: authLoginRequestSchema,",
			"\t\tresponses: {",
			"\t\t\t200: authLoginResponseSchema,",
			'\t\t\t401: { description: "Invalid credentials", body: authMessageResponseSchema },',
			'\t\t\t422: { description: "Validation error", body: authMessageResponseSchema },',
			"\t\t},",
			"\t});",
			'\tauth.post("/register", (ctx) => authController.register(ctx)).as("register").openapi({',
			'\t\ttags: ["Auth"],',
			'\t\tsummary: "Register",',
			"\t\tbody: authRegisterRequestSchema,",
			"\t\tresponses: {",
			"\t\t\t201: authLoginResponseSchema,",
			'\t\t\t409: { description: "Email already registered", body: authMessageResponseSchema },',
			'\t\t\t422: { description: "Validation error", body: authMessageResponseSchema },',
			"\t\t},",
			"\t});",
			'\tauth.post("/logout", (ctx) => authController.logout(ctx)).as("logout").openapi({',
			'\t\ttags: ["Auth"],',
			'\t\tsummary: "Logout",',
			...(choices.auth === "access-token"
				? ["\t\tsecurity: [{ bearerAuth: [] }],"]
				: []),
			"\t\tresponses: {",
			"\t\t\t200: okResponseSchema,",
			'\t\t\t401: { description: "Unauthenticated", body: authMessageResponseSchema },',
			"\t\t},",
			"\t});",
			"});",
		);
	}

	if (choices.preset === "api" || choices.preset === "full") {
		lines.push(
			"",
			...(choices.auth === "access-token"
				? [
						"registerOpenApiRoutes(router, {",
						'\ttitle: "Kura API",',
						'\tversion: "0.1.0",',
						"\tcomponents: {",
						"\t\tsecuritySchemes: {",
						'\t\t\tbearerAuth: { type: "http", scheme: "bearer" },',
						"\t\t},",
						"\t},",
						"});",
					]
				: [
						'registerOpenApiRoutes(router, { title: "Kura API", version: "0.1.0" });',
					]),
		);
	}

	return `${imports.join("\n")}\n\n${lines.join("\n")}\n`;
}

function makeOpenApiSchemaDefinitions(choices: NewAppChoices): string[] {
	const lines: string[] = [];

	if (choices.preset === "api" || choices.preset === "full") {
		lines.push(
			"const appInfoResponseSchema = {",
			'\ttype: "object",',
			"\tproperties: {",
			'\t\tframework: { type: "string", enum: ["kura"] },',
			`\t\tpreset: { type: "string", enum: ["${choices.preset}"] },`,
			'\t\tok: { type: "boolean" },',
			"\t},",
			'\trequired: ["framework", "preset", "ok"],',
			"} as const;",
			"",
			"const healthResponseSchema = {",
			'\ttype: "object",',
			"\tproperties: {",
			'\t\tstatus: { type: "string", enum: ["up"] },',
			"\t},",
			'\trequired: ["status"],',
			"} as const;",
		);
	}

	if (choices.auth !== "none") {
		if (lines.length > 0) {
			lines.push("");
		}

		lines.push(
			"const authCurrentUserResponseSchema = {",
			'\ttype: "object",',
			"\tproperties: {",
			`\t\tguard: { type: "string", enum: ["${choices.auth === "session" ? "session" : "api"}"] },`,
			'\t\tuser: { type: ["object", "null"], additionalProperties: true },',
			"\t},",
			'\trequired: ["guard", "user"],',
			"} as const;",
			"",
			"const authLoginRequestSchema = {",
			'\ttype: "object",',
			"\tproperties: {",
			'\t\temail: { type: "string", format: "email" },',
			'\t\tpassword: { type: "string", format: "password" },',
			"\t},",
			'\trequired: ["email", "password"],',
			"} as const;",
			"",
			"const authRegisterRequestSchema = {",
			'\ttype: "object",',
			"\tproperties: {",
			'\t\temail: { type: "string", format: "email" },',
			'\t\tpassword: { type: "string", format: "password" },',
			"\t},",
			'\trequired: ["email", "password"],',
			"} as const;",
			"",
			"const authLoginResponseSchema = {",
			'\ttype: "object",',
			"\tproperties: {",
			`\t\ttoken: { type: ${choices.auth === "session" ? '["string", "null"]' : '"string"'} },`,
			`\t\ttokenType: { type: "string", enum: ["${choices.auth === "session" ? "Cookie" : "Bearer"}"] },`,
			'\t\texpiresIn: { type: "number" },',
			'\t\tuser: { type: "object", additionalProperties: true },',
			"\t},",
			'\trequired: ["token", "tokenType", "expiresIn", "user"],',
			"} as const;",
			"",
			"const authMessageResponseSchema = {",
			'\ttype: "object",',
			"\tproperties: {",
			'\t\tmessage: { type: "string" },',
			"\t},",
			'\trequired: ["message"],',
			"} as const;",
			"",
			"const okResponseSchema = {",
			'\ttype: "object",',
			"\tproperties: {",
			'\t\tok: { type: "boolean" },',
			"\t},",
			'\trequired: ["ok"],',
			"} as const;",
		);
	}

	return lines;
}

function makeReadme(appName: string, choices: NewAppChoices): string {
	return `# ${appName}

Generated with Kura.

## Stack

- Preset: ${choices.preset}
- Structure: ${choices.architecture}
- Database: ${choices.database}
- Auth: ${choices.auth}
- Cache: ${choices.cache}
- Queue: ${choices.queue}
- Modules: ${choices.modules.length > 0 ? choices.modules.join(", ") : "none"}

## Feature Status

${makeFeatureSupportBullets(choices)}

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
bun kura routes
bun kura doctor
bun kura env
bun kura config app.starter
bun kura make:controller Home
bun kura serve --watch
\`\`\`

## Structure

${makeArchitectureStructureBullets(choices)}
- \`bin/\`: console, server, and test entrypoints.
- \`config/\`: application and module configuration.
${makeDatabaseStructureBullet(choices)}
${makeResourcesStructureBullet(choices)}
- \`start/\`: environment, kernel, and routes loaded during boot.
- \`kura.config.ts\`: Kura application manifest.
`;
}

function makeFeatureSupportBullets(choices: NewAppChoices): string {
	return featureSupportRows(choices)
		.map((row) => `- ${row.name} (${row.status}): ${row.message}`)
		.join("\n");
}

function makeGeneratedStarterBullets(choices: NewAppChoices): string {
	const bullets = [
		"- HTTP kernel: `bin/server.ts` loads `start/kernel.ts` middleware before dispatching routes.",
	];

	if (choices.preset === "api" || choices.preset === "full") {
		bullets.push(
			`- API: \`${apiControllerPath(choices)}\` backs the JSON routes.`,
			"- API docs: `/docs` renders the OpenAPI UI and `/openapi.json` exposes the spec.",
		);
	}

	if (choices.preset === "web") {
		bullets.push(
			`- Web: \`${homeControllerPath(choices)}\` serves \`resources/views/home.kura.html\`.`,
		);
	}

	if (choices.preset === "full") {
		bullets.push(
			"- Web: `resources/pages/home.html` is served by Bun's fullstack HTML route at `/`.",
		);
	}

	if (choices.auth !== "none") {
		if (choices.architecture === "domain") {
			bullets.push(
				`- Auth: \`${authControllerPath(choices)}\`, \`${userDomainEntityPath()}\`, \`${userRepositoryPath()}\`, \`${registerUserUseCasePath()}\`, \`${userModelPath(choices)}\`, and user migrations are scaffolded.`,
			);
		} else {
			bullets.push(
				`- Auth: \`${authControllerPath(choices)}\`, \`${userModelPath(choices)}\`, and user migrations are scaffolded.`,
			);
		}
	}

	for (const module of choices.modules) {
		bullets.push(
			`- ${formatModuleName(module)}: starter config and source files are scaffolded.`,
		);
	}

	return bullets.join("\n");
}

function makeArchitectureStructureBullets(choices: NewAppChoices): string {
	if (choices.architecture === "domain") {
		return "- `app/domains/`: clean architecture contexts with `domain`, `application`, `infrastructure`, and `http` boundaries.";
	}

	if (choices.architecture === "modular") {
		return "- `app/modules/`: feature-based application modules created by the selected preset and later generators.";
	}

	return "- `app/`: application code created by the selected preset and later `make:*` commands.";
}

function makeDatabaseStructureBullet(choices: NewAppChoices): string {
	if (!usesDatabaseFiles(choices)) {
		return "- `database/`: added when database or auth features need schema files.";
	}

	return "- `database/`: generated schema metadata and migrations for selected features.";
}

function makeResourcesStructureBullet(choices: NewAppChoices): string {
	if (choices.preset === "full") {
		return "- `resources/pages`, `resources/client`, and `resources/css`: Bun fullstack HTML entrypoints and browser assets.";
	}

	if (choices.preset === "web") {
		return "- `resources/views`: server-rendered `.kura.html` views.";
	}

	return "";
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

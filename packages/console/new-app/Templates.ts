import {
	makeAccessTokensMigration,
	makeAuthController,
	makeAuthService,
	makeDomainUserEntity,
	makeRegisterUserUseCase,
	makeSessionsMigration,
	makeSqlUserRepository,
	makeUserModel,
	makeUserRecord,
	makeUserRepositoryPort,
	makeUsersMigration,
} from "./AuthTemplates";
import { featureSupportRows } from "./FeatureStatus";
import {
	makeEnglishMessages,
	makeI18nConfig,
	makeMailConfig,
	makeStorageConfig,
	makeStorageService,
	makeWebSocketService,
	makeWebSocketsConfig,
	makeWelcomeMail,
} from "./OptionalModuleTemplates";
import {
	makeAppConfig,
	makeAuthConfig,
	makeBodyParserConfig,
	makeCacheConfig,
	makeConsoleEntrypoint,
	makeDatabaseConfig,
	makeEncryptionConfig,
	makeEnv,
	makeEnvExample,
	makeHashConfig,
	makeKuraConfig,
	makeLoggerConfig,
	makePackageJson,
	makeQueueConfig,
	makeServerEntrypoint,
	makeSessionConfig,
	makeShieldConfig,
	makeStaticConfig,
	makeTsConfig,
} from "./RuntimeTemplates";
import {
	apiControllerPath,
	authControllerPath,
	authServicePath,
	homeControllerPath,
	makeDatabaseMetadataFiles,
	makeScaffoldDirectories,
	moduleImport,
	moduleSourcePath,
	registerUserUseCasePath,
	sqlUserRepositoryPath,
	userDomainEntityPath,
	userModelPath,
	userRepositoryPath,
	usesDatabaseFiles,
} from "./ScaffoldPaths";
import type { NewAppChoices, NewAppFile } from "./Types";

export function makeNewAppFiles(options: {
	readonly appName: string;
	readonly choices: NewAppChoices;
	readonly packageVersion: string;
}): readonly NewAppFile[] {
	const { appName, choices, packageVersion } = options;

	return [
		{
			path: "package.json",
			content: `${JSON.stringify(makePackageJson(appName, packageVersion, choices), null, "\t")}\n`,
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
			content: `import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Env } from "kura/env";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot =
\tbasename(runtimeRoot) === "build" ? resolve(runtimeRoot, "..") : runtimeRoot;
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
			content: `import { BodyLimit, Cors, type Middleware, RequestId, RequestTimeout } from "kura/http";

export const serverMiddleware: readonly Middleware[] = [
\tRequestId,
\tCors(),
\tRequestTimeout({ ms: 30_000 }),
\tBodyLimit({ maxBytes: 1_048_576 }),
];

export const routerMiddleware: readonly Middleware[] = [];

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

function makeApiController(choices: NewAppChoices): string {
	return `import type { Context } from "kura/http";

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
	return `import type { Context } from "kura/http";
import { view } from "kura/view";

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

function makeRoutes(choices: NewAppChoices): string {
	const imports = ['import { Router } from "kura/http";'];
	const lines = ["export const router = new Router();"];

	if (choices.preset === "api" || choices.preset === "full") {
		imports.push('import { registerOpenApiRoutes } from "kura/openapi";');
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
		imports.push('import { v } from "kura/validation";');
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
			'\t\t\t401: { description: "Unauthenticated", body: authErrorResponseSchema },',
			"\t\t},",
			"\t});",
			'\tauth.post("/login", (ctx) => authController.login(ctx)).as("login").schema({',
			"\t\tbody: authLoginRequestSchema,",
			"\t}).openapi({",
			'\t\ttags: ["Auth"],',
			'\t\tsummary: "Login",',
			"\t\tbody: authLoginRequestSchema,",
			"\t\tresponses: {",
			"\t\t\t200: authLoginResponseSchema,",
			'\t\t\t401: { description: "Invalid credentials", body: authErrorResponseSchema },',
			'\t\t\t422: { description: "Validation error", body: authErrorResponseSchema },',
			"\t\t},",
			"\t});",
			'\tauth.post("/register", (ctx) => authController.register(ctx)).as("register").schema({',
			"\t\tbody: authRegisterRequestSchema,",
			"\t}).openapi({",
			'\t\ttags: ["Auth"],',
			'\t\tsummary: "Register",',
			"\t\tbody: authRegisterRequestSchema,",
			"\t\tresponses: {",
			"\t\t\t201: authLoginResponseSchema,",
			'\t\t\t409: { description: "Email already registered", body: authErrorResponseSchema },',
			'\t\t\t422: { description: "Validation error", body: authErrorResponseSchema },',
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
			'\t\t\t401: { description: "Unauthenticated", body: authErrorResponseSchema },',
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
			"const authLoginRequestSchema = v.object({",
			"\temail: v.string().email(),",
			"\tpassword: v.string().min(1),",
			"});",
			"",
			"const authRegisterRequestSchema = v.object({",
			"\temail: v.string().email(),",
			"\tpassword: v.string().min(1),",
			"});",
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
			"const authErrorResponseSchema = {",
			'\ttype: "object",',
			"\tproperties: {",
			"\t\terror: {",
			'\t\t\ttype: "object",',
			"\t\t\tproperties: {",
			'\t\t\t\tcode: { type: "string" },',
			'\t\t\t\tmessage: { type: "string" },',
			'\t\t\t\tstatus: { type: "number" },',
			'\t\t\t\tdetails: { type: "object", additionalProperties: true },',
			"\t\t\t},",
			'\t\t\trequired: ["code", "message", "status"],',
			"\t\t},",
			"\t},",
			'\trequired: ["error"],',
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

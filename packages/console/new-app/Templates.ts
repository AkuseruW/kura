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
	makeDatabaseConnection,
	makeDatabaseMigrations,
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
	makeStartEnv,
	makeStaticConfig,
	makeTsConfig,
} from "./RuntimeTemplates";
import {
	apiControllerPath,
	authControllerPath,
	authMiddlewarePath,
	authServicePath,
	authValidatorImport,
	authValidatorPath,
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
			path: ".dockerignore",
			content: makeDockerIgnore(),
		},
		{
			path: "Dockerfile",
			content: makeDockerfile(choices),
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
			content: makeStartEnv(choices),
		},
		{
			path: "start/kernel.ts",
			content: makeKernel(choices),
		},
		{
			path: "app/exceptions/handler.ts",
			content: makeExceptionHandler(),
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
			content: makeStartRoutes(choices),
		},
		...makeRouteFiles(choices),
		...makeRouteSupportFiles(choices),
		...makePresetFiles(choices),
		...makeAuthFiles(choices),
		...makeOptionalModuleFiles(choices),
		...makeScaffoldDirectories(choices),
		...makeDatabaseMetadataFiles(choices),
		...makeDatabaseRuntimeFiles(choices),
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
		{
			path: "DEPLOYMENT.md",
			content: makeDeploymentGuide(appName, choices),
		},
	];
}

function makeDatabaseRuntimeFiles(
	choices: NewAppChoices,
): readonly NewAppFile[] {
	if (!usesDatabaseFiles(choices)) {
		return [];
	}

	return [
		{
			path: "database/connection.ts",
			content: makeDatabaseConnection(),
		},
		{
			path: "database/migrations.ts",
			content: makeDatabaseMigrations(choices),
		},
	];
}

function makeDockerIgnore(): string {
	return `.git
.github
.kura
node_modules
build
dist
tmp
coverage

# Local environment and secrets
.env
.env.*
!.env.example

# Local persistence
database/*.sqlite
database/*.sqlite-*
storage/app

# Logs and OS files
*.log
.DS_Store
`;
}

function makeDockerfile(choices: NewAppChoices): string {
	const volumes = makeDockerVolumePaths(choices);
	const volumeBlock =
		volumes.length > 0
			? `\nVOLUME [${volumes.map((path) => JSON.stringify(path)).join(", ")}]\n`
			: "\n";

	return `# syntax=docker/dockerfile:1

FROM oven/bun:1.3 AS build

WORKDIR /app
COPY . .

RUN if [ -f bun.lock ]; then bun install --frozen-lockfile; else bun install; fi
RUN bun run build
RUN bun install --production

FROM oven/bun:1.3 AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3333

COPY --from=build /app ./
${volumeBlock}EXPOSE 3333

CMD ["bun", "bin/console.ts", "preview", "--no-build", "--host", "0.0.0.0"]
`;
}

function makeDeploymentGuide(appName: string, choices: NewAppChoices): string {
	const imageName = dockerImageName(appName);
	const volumeNotes = makeDeploymentVolumeNotes(choices);
	const envNotes = makeDeploymentEnvNotes(choices);

	return `# Deployment

This app ships with a production-oriented Docker template for Bun hosts and Docker-style platforms.

## Local Production Check

\`\`\`sh
bun install
bun run build
bun run preview
bun run deploy:doctor
\`\`\`

## Docker

\`\`\`sh
docker build -t ${imageName} .
docker run --rm -p 3333:3333 --env-file .env -e HOST=0.0.0.0 -e PORT=3333 ${imageName}
\`\`\`

The container runs the built server through:

\`\`\`sh
bun bin/console.ts preview --no-build --host 0.0.0.0
\`\`\`

## Runtime Environment

- Set \`NODE_ENV=production\`.
- Set \`HOST=0.0.0.0\` and provide the platform \`PORT\`.
- Keep \`.env\` out of git and inject secrets through your host.
${envNotes}

## Persistence

${volumeNotes}

## Platform Notes

- Docker, Railway, Render, Fly.io, and similar Bun-capable hosts should run the generated Dockerfile or an equivalent build/start flow.
- Kura serves HTTP/1.1 directly by default. Put a proxy/CDN in front for public HTTP/2, or set \`HTTP3=true\` with \`TLS_CERT\` and \`TLS_KEY\` on hosts that expose UDP/QUIC.
- Serverless and edge hosts need an adapter before they can run the Bun HTTP server directly.
- Run \`bun kura deploy:doctor\` after changing dependencies, scripts, or selected features.
`;
}

function makeDockerVolumePaths(choices: NewAppChoices): readonly string[] {
	const paths = new Set<string>();

	if (choices.database === "sqlite" || choices.queue === "sqlite") {
		paths.add("/app/database");
	}

	if (choices.cache === "file") {
		paths.add("/app/tmp");
	}

	if (choices.modules.includes("storage")) {
		paths.add("/app/storage");
	}

	return [...paths];
}

function makeDeploymentVolumeNotes(choices: NewAppChoices): string {
	const notes: string[] = [];

	if (choices.database === "sqlite" || choices.queue === "sqlite") {
		notes.push(
			"- SQLite stores data under `/app/database`; mount a volume for production containers.",
		);
	}

	if (choices.cache === "file") {
		notes.push(
			"- File cache stores records under `/app/tmp`; mount a volume or use a remote cache for multi-instance deployments.",
		);
	}

	if (choices.modules.includes("storage")) {
		notes.push(
			"- Local storage writes to `/app/storage`; mount a volume or replace it with object storage before production use.",
		);
	}

	if (notes.length === 0) {
		return "This starter does not require a persistent container volume by default.";
	}

	return notes.join("\n");
}

function makeDeploymentEnvNotes(choices: NewAppChoices): string {
	const notes = ["- `APP_KEY` must be stable across deploys."];

	if (choices.database === "postgres" || choices.database === "mysql") {
		notes.push("- `DATABASE_URL` must point at your production database.");
	}

	if (choices.cache === "redis" || choices.queue === "redis") {
		notes.push("- `REDIS_URL` must point at your production Redis service.");
	}

	if (choices.auth !== "none") {
		notes.push(
			"- Review generated auth persistence and token/session settings before accepting production traffic.",
		);
	}

	return notes.join("\n");
}

function dockerImageName(appName: string): string {
	const name = appName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return name.length > 0 ? name : "kura-app";
}

function makeKernel(choices: NewAppChoices): string {
	const usesCsrf = choices.auth === "session" && choices.preset !== "api";
	const namedMiddleware = [
		choices.auth !== "none" ? "\tauth: authMiddleware," : "",
		usesCsrf ? "\tcsrf: csrfProtection," : "",
	]
		.filter(Boolean)
		.join("\n");
	const csrfImport = usesCsrf ? ", CsrfProtection" : "";
	const csrfSetup = usesCsrf
		? `const csrfProtection = CsrfProtection({
\tcookieName: env.get("CSRF_COOKIE_NAME", "kura-csrf-token"),
\tsecure: env.get<string>("NODE_ENV", "development") === "production",
});

`
		: "";
	const csrfMiddleware = usesCsrf ? "\tcsrfProtection,\n" : "";
	const imports = [
		`import { BodyLimit, BodyParser, Cors${csrfImport}, defineHttpKernel, type Middleware, RequestId, RequestTimeout } from "kura/http";`,
		'import handleException from "#exceptions/handler";',
	];

	if (usesCsrf) {
		imports.push('import env from "#start/env";');
	}

	if (choices.auth !== "none") {
		imports.push(
			`import { authMiddleware } from "${moduleImport(
				choices,
				"auth",
				"auth_middleware",
				"#middleware/auth_middleware",
				"http",
			)}";`,
		);
	}

	return `/*
|--------------------------------------------------------------------------
| HTTP kernel
|--------------------------------------------------------------------------
|
| Register exception handling and middleware for the HTTP server.
|
*/

${imports.join("\n")}

const errorHandler = handleException;

${csrfSetup}/**
 * Server middleware runs for every request, including unmatched URLs.
 */
const server = [
\tRequestId,
\tCors(),
\tRequestTimeout({ ms: 30_000 }),
\tBodyLimit({ maxBytes: 1_048_576 }),
\tBodyParser,
${csrfMiddleware}];

/**
 * Router middleware runs only after a route has matched.
 */
const router: readonly Middleware[] = [];

/**
 * Named middleware is assigned directly to routes or route groups.
 */
export const middleware = {
${namedMiddleware}
};

export const kernel = defineHttpKernel({
\terrorHandler,
\tserver,
\trouter,
\tnamed: middleware,
});
`;
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

function makeRouteSupportFiles(choices: NewAppChoices): readonly NewAppFile[] {
	const files: NewAppFile[] = [];

	if (choices.preset === "api" || choices.preset === "full") {
		files.push({
			path: openApiSchemaPath(choices, "api"),
			content: makeApiOpenApiContracts(choices),
		});
	}

	if (choices.auth !== "none") {
		files.push(
			{
				path: openApiSchemaPath(choices, "auth"),
				content: makeAuthOpenApiContracts(choices),
			},
			{
				path: authValidatorPath(choices),
				content: makeAuthValidator(),
			},
			{
				path: authMiddlewarePath(choices),
				content: makeAuthMiddleware(choices),
			},
		);
	}

	return files;
}

function openApiSchemaPath(
	choices: NewAppChoices,
	moduleName: "api" | "auth",
): string {
	if (choices.architecture === "domain") {
		return `app/domains/${moduleName}/http/schemas.ts`;
	}

	if (choices.architecture === "modular") {
		return `app/modules/${moduleName}/schemas.ts`;
	}

	return `app/schemas/${moduleName}.ts`;
}

function openApiSchemaImport(
	choices: NewAppChoices,
	moduleName: "api" | "auth",
): string {
	if (choices.architecture === "domain") {
		return `#domains/${moduleName}/http/schemas`;
	}

	if (choices.architecture === "modular") {
		return `#modules/${moduleName}/schemas`;
	}

	return `#schemas/${moduleName}`;
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

function makeAuthValidator(): string {
	return `import { k } from "kura/validation";

export const authLoginRequestSchema = k.object({
\temail: k.string().email(),
\tpassword: k.string().min(1),
});

export const authRegisterRequestSchema = k.object({
\temail: k.string().email(),
\tpassword: k.string().min(1),
});
`;
}

function makeAuthMiddleware(choices: NewAppChoices): string {
	const authServiceImport = moduleImport(
		choices,
		"auth",
		"auth_service",
		"#services/auth_service",
		"application",
	);

	return `import { KuraResponse, type Middleware } from "kura/http";
import { authService } from "${authServiceImport}";

export const authMiddleware: Middleware = async (ctx, next) => {
\tconst user = await authService.authenticate(ctx);

\tif (!user) {
\t\treturn KuraResponse.unauthenticated();
\t}

\treturn next();
};
`;
}

function makeExceptionHandler(): string {
	return `import { createHttpErrorHandler } from "kura/http";
import env from "#start/env";

const isProduction = env.get<string>("NODE_ENV", "development") === "production";

const handleException = createHttpErrorHandler({
\tdebug: !isProduction,
\tincludeStack: !isProduction,
});

export default handleException;
`;
}

function makeStartRoutes(choices: NewAppChoices): string {
	const imports = ['import { Router } from "kura/http";'];
	const registrars: string[] = [];

	if (choices.preset === "api" || choices.preset === "full") {
		if (choices.architecture === "standard") {
			imports.push('import { registerApiRoutes } from "#routes/api";');
		} else {
			imports.push(
				'import { registerApiRoutes, registerDocumentationRoutes } from "#routes/api";',
			);
		}
		registrars.push("registerApiRoutes(router);");
	}

	if (choices.preset === "web") {
		imports.push('import { registerWebRoutes } from "#routes/web";');
		registrars.push("registerWebRoutes(router);");
	}

	if (choices.auth !== "none") {
		imports.push('import { registerAuthRoutes } from "#routes/auth";');
		registrars.push("registerAuthRoutes(router);");
	}

	if (
		choices.architecture === "standard" &&
		(choices.preset === "api" || choices.preset === "full")
	) {
		imports.push(
			'import { registerDocumentationRoutes } from "#routes/openapi";',
		);
	}

	if (choices.preset === "api" || choices.preset === "full") {
		registrars.push("registerDocumentationRoutes(router);");
	}

	return `${imports.join("\n")}

export const router = new Router();

${registrars.join("\n")}
`;
}

function makeRouteFiles(choices: NewAppChoices): readonly NewAppFile[] {
	const files: NewAppFile[] = [];

	if (choices.preset === "api" || choices.preset === "full") {
		files.push({
			path: routeFilePath(choices, "api"),
			content: makeApiRoutes(choices, {
				includeDocumentation: choices.architecture !== "standard",
			}),
		});
	}

	if (choices.preset === "web") {
		files.push({
			path: routeFilePath(choices, "web"),
			content: makeWebRoutes(choices),
		});
	}

	if (choices.auth !== "none") {
		files.push({
			path: routeFilePath(choices, "auth"),
			content: makeAuthRoutes(choices),
		});
	}

	if (
		choices.architecture === "standard" &&
		(choices.preset === "api" || choices.preset === "full")
	) {
		files.push({
			path: "routes/openapi.ts",
			content: makeOpenApiRoutes(choices),
		});
	}

	return files;
}

function routeFilePath(
	choices: NewAppChoices,
	moduleName: "api" | "auth" | "web",
): string {
	if (choices.architecture === "domain") {
		return `app/domains/${moduleName}/http/routes.ts`;
	}

	if (choices.architecture === "modular") {
		return `app/modules/${moduleName}/routes.ts`;
	}

	return `routes/${moduleName}.ts`;
}

function makeApiRoutes(
	choices: NewAppChoices,
	options: { readonly includeDocumentation: boolean },
): string {
	const imports = [
		'import type { Router } from "kura/http";',
		`import { ApiController } from "${moduleImport(
			choices,
			"api",
			"api_controller",
			"#controllers/api_controller",
			"http",
		)}";`,
		`import { appInfoResponseSchema, healthResponseSchema } from "${openApiSchemaImport(
			choices,
			"api",
		)}";`,
	];

	if (options.includeDocumentation) {
		imports.push('import { registerOpenApiRoutes } from "kura/openapi";');
	}

	const lines = ["const apiController = new ApiController();", ""];

	if (choices.preset === "api") {
		lines.push(
			"export function registerApiRoutes(router: Router): void {",
			"\trouter",
			'\t\t.get("/", (ctx) => apiController.index(ctx))',
			'\t\t.as("home")',
			"\t\t.openapi({",
			'\t\ttags: ["App"],',
			'\t\tsummary: "Application information",',
			"\t\tresponses: {",
			"\t\t\t200: appInfoResponseSchema,",
			"\t\t},",
			"\t});",
			"\trouter",
			'\t\t.get("/health", (ctx) => apiController.health(ctx))',
			'\t\t.as("health")',
			"\t\t.openapi({",
			'\t\ttags: ["Health"],',
			'\t\tsummary: "Health check",',
			"\t\tresponses: {",
			"\t\t\t200: healthResponseSchema,",
			"\t\t},",
			"\t});",
			"}",
		);
	}

	if (choices.preset === "full") {
		lines.push(
			"export function registerApiRoutes(router: Router): void {",
			"\trouter",
			'\t\t.get("/health", (ctx) => apiController.health(ctx))',
			'\t\t.as("health")',
			"\t\t.openapi({",
			'\t\ttags: ["Health"],',
			'\t\tsummary: "Health check",',
			"\t\tresponses: {",
			"\t\t\t200: healthResponseSchema,",
			"\t\t},",
			"\t});",
			'\trouter.group().prefix("/api").as("api.").routes((api) => {',
			"\t\tapi",
			'\t\t\t.get("/", (ctx) => apiController.index(ctx))',
			'\t\t\t.as("index")',
			"\t\t\t.openapi({",
			'\t\t\ttags: ["App"],',
			'\t\t\tsummary: "Application information",',
			"\t\t\tresponses: {",
			"\t\t\t\t200: appInfoResponseSchema,",
			"\t\t\t},",
			"\t\t});",
			"\t\tapi",
			'\t\t\t.get("/health", (ctx) => apiController.health(ctx))',
			'\t\t\t.as("health")',
			"\t\t\t.openapi({",
			'\t\t\ttags: ["Health"],',
			'\t\t\tsummary: "Health check",',
			"\t\t\tresponses: {",
			"\t\t\t\t200: healthResponseSchema,",
			"\t\t\t},",
			"\t\t});",
			"\t});",
			"}",
		);
	}

	if (options.includeDocumentation) {
		lines.push("", makeOpenApiRouteRegistrar(choices));
	}

	return `${imports.join("\n")}\n\n${lines.join("\n")}\n`;
}

function makeWebRoutes(choices: NewAppChoices): string {
	return `import type { Router } from "kura/http";
import { HomeController } from "${moduleImport(
		choices,
		"web",
		"home_controller",
		"#controllers/home_controller",
		"http",
	)}";

const homeController = new HomeController();

export function registerWebRoutes(router: Router): void {
\trouter.get("/", (ctx) => homeController.index(ctx)).as("home");
\trouter.get("/health", () => Response.json({ status: "up" })).as("health");
}
`;
}

function makeAuthRoutes(choices: NewAppChoices): string {
	const imports = [
		'import type { Router } from "kura/http";',
		'import { middleware } from "#start/kernel";',
		`import {\n\tauthLoginRequestSchema,\n\tauthRegisterRequestSchema,\n} from "${authValidatorImport(choices)}";`,
		`import { AuthController } from "${moduleImport(
			choices,
			"auth",
			"auth_controller",
			"#controllers/auth_controller",
			"http",
		)}";`,
		`import {\n\t${makeAuthOpenApiContractExports().join(",\n\t")},\n} from "${openApiSchemaImport(
			choices,
			"auth",
		)}";`,
	];
	const accessTokenSecurity =
		choices.auth === "access-token"
			? "\t\t\t\t\tsecurity: [{ bearerAuth: [] }],\n"
			: "";
	const usesCsrf = choices.auth === "session" && choices.preset !== "api";
	const csrfOpenApiParameter = usesCsrf
		? "\t\t\t\tparameters: [csrfHeaderParameter],\n"
		: "";
	const nestedCsrfOpenApiParameter = usesCsrf
		? "\t\t\t\t\tparameters: [csrfHeaderParameter],\n"
		: "";
	const csrfHeaderParameter = usesCsrf
		? `
const csrfHeaderParameter = {
\tname: "X-CSRF-Token",
\tin: "header",
\trequired: true,
\tschema: { type: "string" },
} as const;
`
		: "";

	return `${imports.join("\n")}

const authController = new AuthController();
${csrfHeaderParameter}

export function registerAuthRoutes(router: Router): void {
\trouter.group().prefix("/auth").as("auth.").routes((auth) => {
\t\tauth
\t\t\t.post("/login", (ctx) => authController.login(ctx))
\t\t\t.as("login")
\t\t\t.schema({
\t\t\t\tbody: authLoginRequestSchema,
\t\t\t})
\t\t\t.openapi({
\t\t\t\ttags: ["Auth"],
\t\t\t\tsummary: "Login",
${csrfOpenApiParameter}\t\t\t\tbody: authLoginRequestSchema,
\t\t\t\tresponses: {
\t\t\t\t\t200: authLoginResponseSchema,
\t\t\t\t\t401: {
\t\t\t\t\t\tdescription: "Invalid credentials",
\t\t\t\t\t\tbody: authErrorResponseSchema,
\t\t\t\t\t},
\t\t\t\t\t422: {
\t\t\t\t\t\tdescription: "Validation error",
\t\t\t\t\t\tbody: authErrorResponseSchema,
\t\t\t\t\t},
\t\t\t\t},
\t\t\t});
\t\tauth
\t\t\t.post("/register", (ctx) => authController.register(ctx))
\t\t\t.as("register")
\t\t\t.schema({
\t\t\t\tbody: authRegisterRequestSchema,
\t\t\t})
\t\t\t.openapi({
\t\t\t\ttags: ["Auth"],
\t\t\t\tsummary: "Register",
${csrfOpenApiParameter}\t\t\t\tbody: authRegisterRequestSchema,
\t\t\t\tresponses: {
\t\t\t\t\t201: authLoginResponseSchema,
\t\t\t\t\t409: {
\t\t\t\t\t\tdescription: "Email already registered",
\t\t\t\t\t\tbody: authErrorResponseSchema,
\t\t\t\t\t},
\t\t\t\t\t422: {
\t\t\t\t\t\tdescription: "Validation error",
\t\t\t\t\t\tbody: authErrorResponseSchema,
\t\t\t\t\t},
\t\t\t\t},
\t\t\t});
\t});

\trouter
\t\t.group()
\t\t.prefix("/auth")
\t\t.as("auth.")
\t\t.middleware(middleware.auth)
\t\t.routes((auth) => {
\t\t\tauth
\t\t\t\t.get("/me", (ctx) => authController.me(ctx))
\t\t\t\t.as("me")
\t\t\t\t.openapi({
\t\t\t\t\ttags: ["Auth"],
\t\t\t\t\tsummary: "Current authenticated user",
${accessTokenSecurity}\t\t\t\t\tresponses: {
\t\t\t\t\t\t200: authCurrentUserResponseSchema,
\t\t\t\t\t\t401: {
\t\t\t\t\t\t\tdescription: "Unauthenticated",
\t\t\t\t\t\t\tbody: authErrorResponseSchema,
\t\t\t\t\t\t},
\t\t\t\t\t},
\t\t\t\t});
\t\t\tauth
\t\t\t\t.post("/logout", (ctx) => authController.logout(ctx))
\t\t\t\t.as("logout")
\t\t\t\t.openapi({
\t\t\t\t\ttags: ["Auth"],
\t\t\t\t\tsummary: "Logout",
${nestedCsrfOpenApiParameter}${accessTokenSecurity}\t\t\t\t\tresponses: {
\t\t\t\t\t\t200: okResponseSchema,
\t\t\t\t\t\t401: {
\t\t\t\t\t\t\tdescription: "Unauthenticated",
\t\t\t\t\t\t\tbody: authErrorResponseSchema,
\t\t\t\t\t\t},
\t\t\t\t\t},
\t\t\t\t});
\t\t});
}
`;
}

function makeOpenApiRoutes(choices: NewAppChoices): string {
	return `import type { Router } from "kura/http";
import { registerOpenApiRoutes } from "kura/openapi";

${makeOpenApiRouteRegistrar(choices)}
`;
}

function makeOpenApiRouteRegistrar(choices: NewAppChoices): string {
	const body =
		choices.auth === "access-token"
			? `registerOpenApiRoutes(router, {
\t\ttitle: "Kura API",
\t\tversion: "0.1.0",
\t\tcomponents: {
\t\t\tsecuritySchemes: {
\t\t\t\tbearerAuth: { type: "http", scheme: "bearer" },
\t\t\t},
\t\t},
\t});`
			: 'registerOpenApiRoutes(router, { title: "Kura API", version: "0.1.0" });';

	return `export function registerDocumentationRoutes(router: Router): void {
\t${body}
}`;
}

function makeAuthOpenApiContractExports(): string[] {
	return [
		"authCurrentUserResponseSchema",
		"authLoginResponseSchema",
		"authErrorResponseSchema",
		"okResponseSchema",
	];
}

function makeApiOpenApiContracts(choices: NewAppChoices): string {
	return `export const appInfoResponseSchema = {
\ttype: "object",
\tproperties: {
\t\tframework: { type: "string", enum: ["kura"] },
\t\tpreset: { type: "string", enum: ["${choices.preset}"] },
\t\tok: { type: "boolean" },
\t},
\trequired: ["framework", "preset", "ok"],
} as const;

export const healthResponseSchema = {
\ttype: "object",
\tproperties: {
\t\tstatus: { type: "string", enum: ["up"] },
\t},
\trequired: ["status"],
} as const;
`;
}

function makeAuthOpenApiContracts(choices: NewAppChoices): string {
	return `export const authCurrentUserResponseSchema = {
\ttype: "object",
\tproperties: {
\t\tguard: { type: "string", enum: ["${choices.auth === "session" ? "session" : "api"}"] },
\t\tuser: { type: ["object", "null"], additionalProperties: true },
\t},
\trequired: ["guard", "user"],
} as const;

export const authLoginResponseSchema = {
\ttype: "object",
\tproperties: {
\t\ttoken: { type: ${choices.auth === "session" ? '["string", "null"]' : '"string"'} },
\t\ttokenType: { type: "string", enum: ["${choices.auth === "session" ? "Cookie" : "Bearer"}"] },
\t\texpiresIn: { type: "number" },
\t\tuser: { type: "object", additionalProperties: true },
\t},
\trequired: ["token", "tokenType", "expiresIn", "user"],
} as const;

export const authErrorResponseSchema = {
\ttype: "object",
\tproperties: {
\t\terror: {
\t\t\ttype: "object",
\t\t\tproperties: {
\t\t\t\tcode: { type: "string" },
\t\t\t\tmessage: { type: "string" },
\t\t\t\tstatus: { type: "number" },
\t\t\t\tdetails: { type: "object", additionalProperties: true },
\t\t\t},
\t\t\trequired: ["code", "message", "status"],
\t\t},
\t},
\trequired: ["error"],
} as const;

export const okResponseSchema = {
\ttype: "object",
\tproperties: {
\t\tok: { type: "boolean" },
\t},
\trequired: ["ok"],
} as const;
`;
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

## Production

\`\`\`sh
bun run build
bun run preview
bun run deploy:doctor
\`\`\`

See \`DEPLOYMENT.md\` for Docker and host-specific notes.

## Commands

\`\`\`sh
bun kura
bun kura routes
bun kura doctor
bun kura deploy:doctor
bun kura env
bun kura config app.starter
bun kura make:controller Home
bun kura serve --watch
\`\`\`

Install the framework globally if you prefer the shorter app console command:

\`\`\`sh
bun install -g @akuseru_w/kura
kura serve
kura routes
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

import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "../core/Config";
import { Config as ConfigStore } from "../core/Config";
import type { EnvSchema, EnvShape } from "../core/EnvSchema";
import { writeTypedApiClient } from "../http/ApiClient";
import type { RegisteredRoute, Router } from "../http/Router";
import type { BunStaticRouteMap } from "../http/Server";
import {
	type Command,
	type ConsoleKernel,
	type ConsoleOptions,
	defineCommand,
} from "./Console";
import {
	featureSupportWarnings,
	readFeatureSupportChoices,
} from "./new-app/FeatureStatus";

export type DevToolConsoleOptions = {
	readonly root?: string;
	readonly configDirectory?: string;
	readonly envFile?: string;
	readonly envKeys?: readonly string[];
	readonly loadRouter?: () => Router | Promise<Router>;
	readonly loadStaticRoutes?: () =>
		| BunStaticRouteMap
		| Promise<BunStaticRouteMap>;
	readonly loadConfig?: () => Config | Promise<Config>;
	readonly loadEnvSchema?: () =>
		| EnvSchema<EnvShape>
		| Promise<EnvSchema<EnvShape>>;
};

type DoctorStatus = "error" | "ok" | "warn";

type DoctorCheck = {
	readonly name: string;
	readonly status: DoctorStatus;
	readonly message: string;
};

type DoctorFixStatus = "apply" | "skip" | "suggest";

type DoctorFix = {
	readonly name: string;
	readonly status: DoctorFixStatus;
	readonly path?: string;
	readonly message: string;
	apply?(): Promise<void>;
};

type DeploymentTarget = "docker" | "railway" | "render" | "vercel";

type DeploymentPackageJson = {
	readonly dependencies: Readonly<Record<string, string>>;
	readonly optionalDependencies: Readonly<Record<string, string>>;
	readonly scripts: Readonly<Record<string, string>>;
};

type WritablePackageJson = Record<string, unknown> & {
	scripts?: Record<string, string>;
};

const defaultEnvKeys = [
	"APP_NAME",
	"NODE_ENV",
	"PORT",
	"HOST",
	"APP_URL",
	"APP_KEY",
	"DB_CONNECTION",
	"DATABASE_URL",
	"AUTH_GUARD",
	"SESSION_DRIVER",
	"SESSION_COOKIE_NAME",
	"SESSION_TTL_SECONDS",
	"CSRF_COOKIE_NAME",
	"CACHE_STORE",
	"QUEUE_CONNECTION",
	"REDIS_URL",
	"HTTP1",
	"HTTP3",
	"TLS_CERT",
	"TLS_KEY",
	"RATE_LIMIT_MAX",
	"RATE_LIMIT_WINDOW_SECONDS",
] as const;

const expectedPackageScripts = {
	kura: "bun bin/console.ts",
	dev: "bun bin/console.ts serve --watch",
	start: "bun bin/console.ts serve --host 0.0.0.0",
	preview: "bun bin/console.ts preview",
	routes: "bun bin/console.ts routes",
	client: "bun bin/console.ts client:generate",
	doctor: "bun bin/console.ts doctor",
	"deploy:doctor": "bun bin/console.ts deploy:doctor",
	env: "bun bin/console.ts env",
	config: "bun bin/console.ts config",
	test: "bun bin/test.ts",
	typecheck: "tsc --noEmit",
	build:
		"bun build bin/server.ts --target=bun --production --outdir=build --packages=external",
} as const;

export function createDevToolCommands(
	options: DevToolConsoleOptions = {},
): readonly Command[] {
	return [
		createRoutesCommand(options),
		createClientGenerateCommand(options),
		createEnvCommand(options),
		createConfigCommand(options),
		createDoctorCommand(options),
	];
}

export function registerDevToolCommands(
	console: ConsoleKernel,
	options: DevToolConsoleOptions = {},
): ConsoleKernel {
	for (const command of createDevToolCommands(options)) {
		console.register(command);
	}

	return console;
}

function createRoutesCommand(options: DevToolConsoleOptions): Command {
	return defineCommand(
		{
			name: "routes",
			description: "List registered HTTP routes",
			aliases: ["route:list"],
			options: [
				{
					name: "json",
					alias: "j",
					description: "Print routes as JSON",
				},
			],
		},
		async (ctx) => {
			const router = await resolveRouter(options);
			const routes = [
				...(await resolveStaticRoutes(options)),
				...router.list(),
			];

			if (isEnabled(ctx.options, "json")) {
				ctx.output.write(formatJson(routes));
				return;
			}

			ctx.output.write(formatRoutes(routes));
		},
	);
}

function createClientGenerateCommand(options: DevToolConsoleOptions): Command {
	return defineCommand(
		{
			name: "client:generate",
			description: "Generate a typed API client from registered routes",
			options: [
				{
					name: "output",
					alias: "o",
					value: "string",
					default: "app/client/api_client.ts",
					description: "Generated client output path",
				},
				{
					name: "root",
					alias: "r",
					value: "string",
					description: "Project root directory",
				},
			],
		},
		async (ctx) => {
			const router = await resolveRouter(options);
			const root = resolveRoot(options, ctx.options);
			const output = resolve(
				root,
				readStringOption(ctx.options, "output") ?? "app/client/api_client.ts",
			);

			await writeTypedApiClient(router, { output });
			ctx.output.write(
				formatKeyValues("Kura client", [
					["Routes", String(router.list().length)],
					["Output", output],
				]),
			);
		},
	);
}

function createEnvCommand(options: DevToolConsoleOptions): Command {
	return defineCommand(
		{
			name: "env",
			description: "Inspect loaded environment variables",
			options: [
				{
					name: "all",
					alias: "a",
					description: "Include every loaded environment variable",
				},
				{
					name: "json",
					alias: "j",
					description: "Print environment as JSON",
				},
			],
		},
		async (ctx) => {
			const entries = await readEnvEntries(options, ctx.options);

			if (isEnabled(ctx.options, "json")) {
				ctx.output.write(formatJson(Object.fromEntries(entries)));
				return;
			}

			ctx.output.write(formatKeyValues("Environment", entries));
		},
	);
}

function createConfigCommand(options: DevToolConsoleOptions): Command {
	return defineCommand(
		{
			name: "config",
			description: "Inspect loaded configuration",
			arguments: [
				{
					name: "key",
					description: "Dot-notation config key",
				},
			],
			options: [
				{
					name: "json",
					alias: "j",
					description: "Print config values as JSON",
				},
				{
					name: "root",
					alias: "r",
					value: "string",
					description: "Project root directory",
				},
			],
		},
		async (ctx) => {
			const config = await resolveConfig(options, ctx.options);
			const key = ctx.args[0];

			if (key) {
				const value = config.get<unknown>(key);
				ctx.output.write(
					isEnabled(ctx.options, "json")
						? formatJson(value)
						: `${key} = ${formatValue(value)}`,
				);
				return;
			}

			const all = config.all();
			ctx.output.write(
				isEnabled(ctx.options, "json")
					? formatJson(all)
					: formatKeyValues(
							"Config",
							Object.keys(all)
								.sort()
								.map((name) => [name, formatConfigRoot(all[name])] as const),
						),
			);
		},
	);
}

function createDoctorCommand(options: DevToolConsoleOptions): Command {
	return defineCommand(
		{
			name: "doctor",
			description: "Check project setup and common DX issues",
			aliases: ["deploy:doctor"],
			options: [
				{
					name: "json",
					alias: "j",
					description: "Print checks as JSON",
				},
				{
					name: "root",
					alias: "r",
					value: "string",
					description: "Project root directory",
				},
				{
					name: "target",
					value: "string",
					default: "docker",
					description: "Deployment target: docker, railway, render, or vercel",
				},
				{
					name: "fix",
					description: "Apply safe deterministic fixes",
				},
				{
					name: "dry-run",
					description: "Print planned fixes without writing files",
				},
			],
		},
		async (ctx) => {
			const root = resolveRoot(options, ctx.options);
			const shouldFix = isEnabled(ctx.options, "fix");
			const dryRun = isEnabled(ctx.options, "dry-run");
			const deployment = ctx.parsed.commandName === "deploy:doctor";
			const target = parseDeploymentTarget(
				readStringOption(ctx.options, "target"),
			);
			const fixes =
				shouldFix || dryRun
					? await planDoctorFixes(root, options, {
							deployment,
							target,
						})
					: [];

			if (fixes.length > 0 && !isEnabled(ctx.options, "json")) {
				ctx.output.write(formatDoctorFixes(fixes, dryRun));
			}

			if (shouldFix && !dryRun) {
				for (const fix of fixes) {
					if (fix.status === "apply") {
						await fix.apply?.();
					}
				}
			}

			const checks = await runDoctorChecks(root, options, {
				deployment,
				target,
			});

			if (isEnabled(ctx.options, "json")) {
				ctx.output.write(formatJson(checks));
			} else {
				ctx.output.write(formatDoctor(checks));
			}

			return checks.some((check) => check.status === "error") ? 1 : 0;
		},
	);
}

async function resolveRouter(options: DevToolConsoleOptions): Promise<Router> {
	if (!options.loadRouter) {
		throw new Error("No route loader is configured for this project");
	}

	return options.loadRouter();
}

async function resolveStaticRoutes(
	options: DevToolConsoleOptions,
): Promise<readonly RegisteredRoute[]> {
	if (!options.loadStaticRoutes) {
		return [];
	}

	const routes = await options.loadStaticRoutes();

	return Object.keys(routes)
		.sort()
		.map((path) => ({
			method: "GET",
			path,
			name: "bun.static",
			params: [],
		}));
}

async function resolveConfig(
	options: DevToolConsoleOptions,
	consoleOptions: ConsoleOptions,
): Promise<Config> {
	if (options.loadConfig) {
		return options.loadConfig();
	}

	const root = resolveRoot(options, consoleOptions);
	const config = new ConfigStore();
	await config.load(resolve(root, options.configDirectory ?? "config"));
	return config;
}

async function resolveEnvSchema(
	options: DevToolConsoleOptions,
): Promise<EnvSchema<EnvShape> | undefined> {
	if (!options.loadEnvSchema) {
		return undefined;
	}

	return options.loadEnvSchema();
}

async function readEnvEntries(
	options: DevToolConsoleOptions,
	consoleOptions: ConsoleOptions,
): Promise<readonly (readonly [string, string])[]> {
	if (!isEnabled(consoleOptions, "all")) {
		const schema = await resolveEnvSchema(options);

		if (schema) {
			const descriptions = schema.describe();

			return schema.keys().map((key) => {
				const value = process.env[key];

				return [
					key,
					value === undefined || value.length === 0
						? "<missing>"
						: redactEnvValue(key, value, descriptions[key]?.secret ?? false),
				] as const;
			});
		}
	}

	const keys = isEnabled(consoleOptions, "all")
		? Object.keys(process.env).sort()
		: [...(options.envKeys ?? defaultEnvKeys)];

	return keys
		.filter((key) => process.env[key] !== undefined)
		.map(
			(key) =>
				[key, redactEnvValue(key, process.env[key] ?? "", false)] as const,
		);
}

async function runDoctorChecks(
	root: string,
	options: DevToolConsoleOptions,
	mode: {
		readonly deployment: boolean;
		readonly target?: DeploymentTarget;
	} = { deployment: false },
): Promise<readonly DoctorCheck[]> {
	const checks: DoctorCheck[] = [];
	const packageExists = await exists(resolve(root, "package.json"));
	const envPath = resolve(root, options.envFile ?? ".env");
	const envFile = parseEnvText(await readOptionalText(envPath));
	const envExists = await exists(envPath);
	const configExists = await exists(
		resolve(root, options.configDirectory ?? "config"),
	);
	const tsconfigExists = await exists(resolve(root, "tsconfig.json"));
	const nodeModulesExists = await exists(resolve(root, "node_modules"));

	checks.push({
		name: "package",
		status: packageExists ? "ok" : "error",
		message: packageExists ? "package.json found" : "package.json is missing",
	});
	checks.push({
		name: "env",
		status: envExists ? "ok" : "warn",
		message: envExists ? ".env found" : ".env is missing",
	});
	checks.push({
		name: "app-key",
		status: process.env.APP_KEY || envFile.APP_KEY ? "ok" : "error",
		message:
			process.env.APP_KEY || envFile.APP_KEY
				? "APP_KEY is loaded"
				: "APP_KEY is missing",
	});

	checks.push(...(await runEnvSchemaChecks(root, options)));

	checks.push({
		name: "config",
		status: configExists ? "ok" : "error",
		message: configExists
			? "config directory found"
			: "config directory is missing",
	});
	checks.push({
		name: "typescript",
		status: tsconfigExists ? "ok" : "warn",
		message: tsconfigExists
			? "tsconfig.json found"
			: "tsconfig.json is missing",
	});
	checks.push({
		name: "dependencies",
		status: nodeModulesExists ? "ok" : "warn",
		message: nodeModulesExists
			? "node_modules found"
			: "dependencies are not installed",
	});

	if (configExists || options.loadConfig) {
		checks.push(...(await runFeatureSupportChecks(root, options)));
	}

	if (options.loadRouter) {
		try {
			const router = await options.loadRouter();
			const routes = router.list();
			checks.push({
				name: "routes",
				status: routes.length > 0 ? "ok" : "warn",
				message:
					routes.length > 0
						? `${routes.length} route${routes.length === 1 ? "" : "s"} registered`
						: "no routes registered",
			});
		} catch (error) {
			checks.push({
				name: "routes",
				status: "error",
				message: errorMessage(error),
			});
		}
	}

	if (mode.deployment) {
		checks.push(...(await runDeploymentChecks(root, options, mode.target)));
	}

	return checks;
}

async function planDoctorFixes(
	root: string,
	options: DevToolConsoleOptions,
	mode: {
		readonly deployment: boolean;
		readonly target?: DeploymentTarget;
	},
): Promise<readonly DoctorFix[]> {
	const fixes = await Promise.all([
		planEnvFileFix(root, options),
		planPackageJsonFix(root, mode),
		planEnvExampleSchemaFix(root, options),
		planConsoleFeatureCommandFix(root),
	]);

	return fixes.filter((fix): fix is DoctorFix => fix !== undefined);
}

async function planEnvFileFix(
	root: string,
	options: DevToolConsoleOptions,
): Promise<DoctorFix | undefined> {
	const envFileName = options.envFile ?? ".env";
	const envPath = resolve(root, envFileName);
	const examplePath = resolve(root, `${envFileName}.example`);

	if (await exists(envPath)) {
		return {
			name: "env:create",
			status: "skip",
			path: envFileName,
			message: `${envFileName} already exists`,
		};
	}

	const example = await readOptionalText(examplePath);
	if (example === undefined) {
		return {
			name: "env:create",
			status: "suggest",
			path: envFileName,
			message: `${envFileName} is missing and ${envFileName}.example was not found`,
		};
	}

	return {
		name: "env:create",
		status: "apply",
		path: envFileName,
		message: `create ${envFileName} from ${envFileName}.example`,
		apply: async () => {
			await writeFile(envPath, example, { flag: "wx" });
		},
	};
}

async function planPackageJsonFix(
	root: string,
	mode: {
		readonly deployment: boolean;
		readonly target?: DeploymentTarget;
	},
): Promise<DoctorFix | undefined> {
	const path = resolve(root, "package.json");
	const packageJson = await readWritablePackageJson(path);

	if (!packageJson) {
		return {
			name: "package:scripts",
			status: "suggest",
			path: "package.json",
			message: "package.json is missing or could not be parsed",
		};
	}

	if (!(await looksLikeKuraApp(root, packageJson))) {
		return undefined;
	}

	const currentScripts = isRecord(packageJson.scripts)
		? readStringRecord(packageJson.scripts)
		: {};
	const nextScripts = { ...currentScripts };
	const changes: string[] = [];

	for (const [name, script] of Object.entries(expectedPackageScripts)) {
		if (currentScripts[name] !== undefined) {
			continue;
		}

		if (!(await packageScriptCanBeAdded(root, name))) {
			continue;
		}

		nextScripts[name] = script;
		changes.push(name);
	}

	if (mode.deployment && currentScripts.start) {
		const fixedStart = fixStartHostScript(currentScripts.start);
		if (fixedStart !== currentScripts.start) {
			nextScripts.start = fixedStart;
			changes.push("start host");
		}
	}

	if (changes.length === 0) {
		return {
			name: "package:scripts",
			status: "skip",
			path: "package.json",
			message: "package scripts are already up to date",
		};
	}

	const nextPackageJson: WritablePackageJson = {
		...packageJson,
		scripts: sortRecord(nextScripts),
	};
	const next = `${JSON.stringify(nextPackageJson, null, "\t")}\n`;

	return {
		name: "package:scripts",
		status: "apply",
		path: "package.json",
		message: `update package scripts: ${changes.join(", ")}`,
		apply: async () => {
			await writeFile(path, next);
		},
	};
}

async function planEnvExampleSchemaFix(
	root: string,
	options: DevToolConsoleOptions,
): Promise<DoctorFix | undefined> {
	const schema = await resolveEnvSchema(options);
	if (!schema) {
		return undefined;
	}

	const envFileName = `${options.envFile ?? ".env"}.example`;
	const path = resolve(root, envFileName);
	const current = await readOptionalText(path);

	if (current === undefined) {
		return {
			name: "env-example:schema",
			status: "suggest",
			path: envFileName,
			message: `${envFileName} is missing`,
		};
	}

	const currentEntries = parseEnvText(current);
	const missingKeys = schema
		.keys()
		.filter((key) => currentEntries[key] === undefined);

	if (missingKeys.length === 0) {
		return {
			name: "env-example:schema",
			status: "skip",
			path: envFileName,
			message: `${envFileName} contains all schema keys`,
		};
	}

	const separator = current.endsWith("\n") ? "" : "\n";
	const next = `${current}${separator}${missingKeys.map((key) => `${key}=`).join("\n")}\n`;

	return {
		name: "env-example:schema",
		status: "apply",
		path: envFileName,
		message: `add missing schema keys: ${missingKeys.join(", ")}`,
		apply: async () => {
			await writeFile(path, next);
		},
	};
}

async function planConsoleFeatureCommandFix(
	root: string,
): Promise<DoctorFix | undefined> {
	const path = resolve(root, "bin/console.ts");
	const current = await readOptionalText(path);

	if (current === undefined) {
		return undefined;
	}

	if (current.includes("registerFeatureCommands")) {
		return {
			name: "console:features",
			status: "skip",
			path: "bin/console.ts",
			message: "feature commands are already registered",
		};
	}

	const next = patchConsoleFeatureCommand(current);

	if (next === current) {
		return {
			name: "console:features",
			status: "suggest",
			path: "bin/console.ts",
			message: "feature commands could not be inserted automatically",
		};
	}

	return {
		name: "console:features",
		status: "apply",
		path: "bin/console.ts",
		message: "register feature installer commands",
		apply: async () => {
			await writeFile(path, next);
		},
	};
}

async function readWritablePackageJson(
	path: string,
): Promise<WritablePackageJson | undefined> {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

async function looksLikeKuraApp(
	root: string,
	packageJson: WritablePackageJson,
): Promise<boolean> {
	const dependencies = readStringRecord(packageJson.dependencies);
	const devDependencies = readStringRecord(packageJson.devDependencies);

	return (
		dependencies.kura !== undefined ||
		devDependencies.kura !== undefined ||
		(await exists(resolve(root, "bin/console.ts")))
	);
}

async function packageScriptCanBeAdded(
	root: string,
	name: string,
): Promise<boolean> {
	if (
		[
			"kura",
			"dev",
			"start",
			"preview",
			"routes",
			"client",
			"doctor",
			"deploy:doctor",
			"env",
			"config",
		].includes(name)
	) {
		return exists(resolve(root, "bin/console.ts"));
	}

	if (name === "test") {
		return exists(resolve(root, "bin/test.ts"));
	}

	if (name === "build") {
		return exists(resolve(root, "bin/server.ts"));
	}

	if (name === "typecheck") {
		return exists(resolve(root, "tsconfig.json"));
	}

	return true;
}

function fixStartHostScript(script: string): string {
	if (!script.includes("serve") || script.includes("0.0.0.0")) {
		return script;
	}

	if (/--host\s+\S+/.test(script)) {
		return script.replace(/--host\s+\S+/, "--host 0.0.0.0");
	}

	return `${script} --host 0.0.0.0`;
}

function patchConsoleFeatureCommand(source: string): string {
	let next = source;

	next = addKuraConsoleImport(next, "registerFeatureCommands");
	next = next.replace(
		/registerGeneratorCommands\(appConsole,[\s\S]*?\}\);\n/,
		(match) =>
			`${match}registerFeatureCommands(appConsole, {\n\troot: process.cwd(),\n});\n`,
	);

	return next;
}

function addKuraConsoleImport(source: string, name: string): string {
	return source.replace(
		/import\s+\{([\s\S]*?)\}\s+from\s+"kura\/console";/,
		(match, imports: string) => {
			const current = imports
				.split(",")
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0);

			if (current.includes(name)) {
				return match;
			}

			const insertAt = current.indexOf("registerGeneratorCommands");
			const next =
				insertAt === -1
					? [...current, name]
					: [...current.slice(0, insertAt), name, ...current.slice(insertAt)];

			if (imports.includes("\n")) {
				const indent = imports.match(/\n(\s*)\S/)?.[1] ?? "\t";
				return `import {\n${next.map((entry) => `${indent}${entry},`).join("\n")}\n} from "kura/console";`;
			}

			return `import { ${next.join(", ")} } from "kura/console";`;
		},
	);
}

function sortRecord(
	record: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
	);
}

async function runEnvSchemaChecks(
	root: string,
	options: DevToolConsoleOptions,
): Promise<readonly DoctorCheck[]> {
	try {
		const schema = await resolveEnvSchema(options);

		if (!schema) {
			return [];
		}

		const envFile = parseEnvText(
			await readOptionalText(resolve(root, options.envFile ?? ".env")),
		);
		const runtimeEnv = readStringRecord(process.env);
		const result = schema.validate({ ...envFile, ...runtimeEnv });

		return [
			{
				name: "env-schema",
				status: result.valid ? "ok" : "error",
				message: result.valid
					? `${schema.keys().length} environment keys validated`
					: summarizeEnvIssues(result.issues),
			},
		];
	} catch (error) {
		return [
			{
				name: "env-schema",
				status: "error",
				message: errorMessage(error),
			},
		];
	}
}

async function runFeatureSupportChecks(
	root: string,
	options: DevToolConsoleOptions,
): Promise<readonly DoctorCheck[]> {
	try {
		const config = await withEnvFileDefaults(root, options, () =>
			resolveConfig(options, { root }),
		);
		const choices = readFeatureSupportChoices(config.get("app.starter"));

		if (!choices) {
			return [];
		}

		return featureSupportWarnings(choices).map((row) => ({
			name: `feature:${row.name.toLowerCase()}`,
			status: "warn" as const,
			message: `${row.status}: ${row.message}`,
		}));
	} catch (error) {
		return [
			{
				name: "feature-status",
				status: "warn",
				message: `starter feature status could not be inspected: ${errorMessage(error)}`,
			},
		];
	}
}

async function runDeploymentChecks(
	root: string,
	options: DevToolConsoleOptions,
	target: DeploymentTarget = "docker",
): Promise<readonly DoctorCheck[]> {
	const checks: DoctorCheck[] = [];
	const dockerfile = await readOptionalText(resolve(root, "Dockerfile"));
	const dockerignore = await readOptionalText(resolve(root, ".dockerignore"));
	const envFile = parseEnvText(
		await readOptionalText(resolve(root, options.envFile ?? ".env")),
	);
	const packageJson = await readDeploymentPackageJson(root);

	checks.push(runDeploymentTargetCheck(target));
	checks.push({
		name: "deploy:dockerfile",
		status: dockerfile
			? dockerfile.includes("preview") &&
				dockerfile.includes("--no-build") &&
				dockerfile.includes("0.0.0.0")
				? "ok"
				: "warn"
			: "warn",
		message: dockerfile
			? dockerfile.includes("preview") &&
				dockerfile.includes("--no-build") &&
				dockerfile.includes("0.0.0.0")
				? "Dockerfile runs the built app through production preview"
				: "Dockerfile found; verify it runs the built app and binds to 0.0.0.0"
			: "Dockerfile is missing for Docker-style deployments",
	});
	checks.push({
		name: "deploy:dockerignore",
		status: dockerignore
			? dockerignore.includes(".env") &&
				dockerignore.includes("node_modules") &&
				dockerignore.includes("build")
				? "ok"
				: "warn"
			: "warn",
		message: dockerignore
			? dockerignore.includes(".env") &&
				dockerignore.includes("node_modules") &&
				dockerignore.includes("build")
				? ".dockerignore excludes secrets, dependencies, and local builds"
				: ".dockerignore found; verify it excludes secrets, dependencies, and local builds"
			: ".dockerignore is missing",
	});

	if (!packageJson) {
		checks.push({
			name: "deploy:package",
			status: "error",
			message: "package.json could not be inspected",
		});
		return checks;
	}

	const buildScript = packageJson.scripts.build;
	const startScript = packageJson.scripts.start;
	const previewScript = packageJson.scripts.preview;
	const localDependencies = findLocalRuntimeDependencies(packageJson);

	checks.push({
		name: "deploy:build",
		status: buildScript ? "ok" : "error",
		message: buildScript
			? `build script found: ${buildScript}`
			: "build script is missing",
	});
	checks.push({
		name: "deploy:start",
		status: startScript
			? startScript.includes("0.0.0.0")
				? "ok"
				: "warn"
			: "error",
		message: startScript
			? startScript.includes("0.0.0.0")
				? "start script binds to 0.0.0.0"
				: "start script should bind to 0.0.0.0 on container hosts"
			: "start script is missing",
	});
	checks.push({
		name: "deploy:preview",
		status: previewScript?.includes("preview") ? "ok" : "warn",
		message: previewScript?.includes("preview")
			? "preview script is available for local production checks"
			: "preview script is missing",
	});
	checks.push({
		name: "deploy:dependencies",
		status: localDependencies.length === 0 ? "ok" : "error",
		message:
			localDependencies.length === 0
				? "runtime dependencies are registry-compatible"
				: `runtime dependencies use local paths: ${localDependencies.join(", ")}`,
	});
	checks.push(runDeploymentProtocolCheck(envFile));

	checks.push(...(await runDeploymentFeatureChecks(root, options)));

	return checks;
}

function runDeploymentTargetCheck(target: DeploymentTarget): DoctorCheck {
	if (target === "docker") {
		return {
			name: "deploy:target",
			status: "ok",
			message: "Docker-style deployment target selected",
		};
	}

	if (target === "railway" || target === "render") {
		return {
			name: "deploy:target",
			status: "ok",
			message: `${capitalize(target)} deployment target selected; use build/start scripts with platform PORT and HOST=0.0.0.0`,
		};
	}

	return {
		name: "deploy:target",
		status: "error",
		message:
			"Vercel serverless/edge deployment needs a dedicated adapter before it can run the Bun HTTP server",
	};
}

function parseDeploymentTarget(value: string | undefined): DeploymentTarget {
	const target = value ?? "docker";

	if (
		target === "docker" ||
		target === "railway" ||
		target === "render" ||
		target === "vercel"
	) {
		return target;
	}

	throw new Error(
		"Option [target] must be one of docker, railway, render, or vercel",
	);
}

function runDeploymentProtocolCheck(
	env: Readonly<Record<string, string>>,
): DoctorCheck {
	const http3 = readBooleanLike(env.HTTP3 ?? process.env.HTTP3) ?? false;
	const tlsCert = env.TLS_CERT ?? process.env.TLS_CERT;
	const tlsKey = env.TLS_KEY ?? process.env.TLS_KEY;

	if (!http3) {
		return {
			name: "deploy:protocol",
			status: "warn",
			message:
				"Kura serves HTTP/1.1 directly; terminate public HTTP/2 or HTTP/3 at your proxy/CDN unless you enable experimental HTTP/3 with TLS",
		};
	}

	if (!tlsCert || !tlsKey) {
		return {
			name: "deploy:protocol",
			status: "error",
			message:
				"HTTP3=true requires TLS_CERT and TLS_KEY because Bun HTTP/3 requires TLS",
		};
	}

	return {
		name: "deploy:protocol",
		status: "warn",
		message:
			"HTTP/3 is enabled with TLS; verify your host exposes UDP/QUIC and keep a proxy/CDN fallback for unsupported platforms",
	};
}

async function runDeploymentFeatureChecks(
	root: string,
	options: DevToolConsoleOptions,
): Promise<readonly DoctorCheck[]> {
	try {
		const config = await withEnvFileDefaults(root, options, () =>
			resolveConfig(options, { root }),
		);
		const choices = readFeatureSupportChoices(config.get("app.starter"));

		if (!choices) {
			return [];
		}

		const checks: DoctorCheck[] = [];

		if (choices.database === "sqlite" || choices.queue === "sqlite") {
			checks.push({
				name: "deploy:volume",
				status: "warn",
				message:
					"SQLite persistence uses /app/database; mount a volume for production containers",
			});
		}

		if (choices.cache === "file") {
			checks.push({
				name: "deploy:volume",
				status: "warn",
				message:
					"File cache uses /app/tmp; mount a volume or use a remote cache for multi-instance deployments",
			});
		}

		if (choices.modules.includes("storage")) {
			checks.push({
				name: "deploy:volume",
				status: "warn",
				message:
					"Local storage uses /app/storage; mount a volume or configure object storage",
			});
		}

		return checks;
	} catch (error) {
		return [
			{
				name: "deploy:features",
				status: "warn",
				message: `deployment feature notes could not be inspected: ${errorMessage(error)}`,
			},
		];
	}
}

async function readDeploymentPackageJson(
	root: string,
): Promise<DeploymentPackageJson | undefined> {
	try {
		const value = JSON.parse(
			await readFile(resolve(root, "package.json"), "utf8"),
		);

		if (!isRecord(value)) {
			return undefined;
		}

		return {
			dependencies: readStringRecord(value.dependencies),
			optionalDependencies: readStringRecord(value.optionalDependencies),
			scripts: readStringRecord(value.scripts),
		};
	} catch {
		return undefined;
	}
}

async function readOptionalText(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return undefined;
	}
}

function parseEnvText(
	content: string | undefined,
): Readonly<Record<string, string>> {
	if (!content) {
		return {};
	}

	const entries: [string, string][] = [];

	for (const line of content.split("\n")) {
		const trimmed = line.trim();

		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		const separator = trimmed.indexOf("=");

		if (separator === -1) {
			continue;
		}

		const key = trimmed.slice(0, separator).trim();
		const value = trimmed.slice(separator + 1).trim();

		if (key) {
			entries.push([key, value]);
		}
	}

	return Object.fromEntries(entries);
}

async function withEnvFileDefaults<T>(
	root: string,
	options: DevToolConsoleOptions,
	task: () => T | Promise<T>,
): Promise<T> {
	const envFile = parseEnvText(
		await readOptionalText(resolve(root, options.envFile ?? ".env")),
	);
	const inserted: string[] = [];

	for (const [key, value] of Object.entries(envFile)) {
		if (process.env[key] === undefined) {
			process.env[key] = value;
			inserted.push(key);
		}
	}

	try {
		return await task();
	} finally {
		for (const key of inserted) {
			delete process.env[key];
		}
	}
}

function readStringRecord(value: unknown): Readonly<Record<string, string>> {
	if (!isRecord(value)) {
		return {};
	}

	const entries = Object.entries(value).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);

	return Object.fromEntries(entries);
}

function findLocalRuntimeDependencies(
	packageJson: DeploymentPackageJson,
): readonly string[] {
	const dependencies = {
		...packageJson.dependencies,
		...packageJson.optionalDependencies,
	};

	return Object.entries(dependencies)
		.filter(([, version]) => isLocalDependency(version))
		.map(([name]) => name)
		.sort();
}

function isLocalDependency(version: string): boolean {
	return (
		version.startsWith("file:") ||
		version.startsWith("link:") ||
		version.startsWith("workspace:")
	);
}

function readBooleanLike(value: string | undefined): boolean | undefined {
	if (value === undefined || value.length === 0) {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();

	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}

	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}

	return undefined;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function resolveRoot(
	options: DevToolConsoleOptions,
	consoleOptions: ConsoleOptions,
): string {
	return resolve(
		readStringOption(consoleOptions, "root") ?? options.root ?? process.cwd(),
	);
}

function readStringOption(
	options: ConsoleOptions,
	name: string,
): string | undefined {
	const value = options[name];

	if (Array.isArray(value)) {
		return value.at(-1);
	}

	return typeof value === "string" ? value : undefined;
}

function isEnabled(options: ConsoleOptions, name: string): boolean {
	return options[name] === true;
}

function formatRoutes(routes: readonly RegisteredRoute[]): string {
	if (routes.length === 0) {
		return "Routes\n\n  No routes registered.";
	}

	return formatTable(
		"Routes",
		["Method", "Path", "Name"],
		routes.map((route) => [route.method, route.path, route.name ?? "-"]),
	);
}

function formatDoctor(checks: readonly DoctorCheck[]): string {
	const rows = checks.map((check) => [
		formatStatus(check.status),
		check.name,
		check.message,
	]);
	return formatTable("Kura doctor", ["Status", "Check", "Message"], rows);
}

function formatDoctorFixes(
	fixes: readonly DoctorFix[],
	dryRun: boolean,
): string {
	const rows = fixes.map((fix) => [
		formatFixStatus(fix.status),
		fix.name,
		fix.path ?? "-",
		fix.message,
	]);
	const title = dryRun
		? "Kura doctor fix plan (dry run)"
		: "Kura doctor fix plan";

	return formatTable(title, ["Action", "Fix", "Path", "Message"], rows);
}

function formatKeyValues(
	title: string,
	entries: readonly (readonly [string, string])[],
): string {
	if (entries.length === 0) {
		return `${title}\n\n  No values found.`;
	}

	return formatTable(title, ["Key", "Value"], entries);
}

function formatTable(
	title: string,
	headers: readonly string[],
	rows: readonly (readonly string[])[],
): string {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
	);
	const lines = [
		title,
		"",
		`  ${headers.map((header, index) => header.padEnd(widths[index] ?? 0)).join("  ")}`,
		`  ${widths.map((width) => "-".repeat(width)).join("  ")}`,
	];

	for (const row of rows) {
		lines.push(
			`  ${row.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  ")}`,
		);
	}

	return lines.join("\n");
}

function formatStatus(status: DoctorStatus): string {
	if (status === "ok") {
		return "OK";
	}

	if (status === "warn") {
		return "WARN";
	}

	return "ERROR";
}

function formatFixStatus(status: DoctorFixStatus): string {
	if (status === "apply") {
		return "APPLY";
	}

	if (status === "skip") {
		return "SKIP";
	}

	return "SUGGEST";
}

function redactEnvValue(key: string, value: string, secret: boolean): string {
	return secret || shouldRedact(key) ? redact(value) : value;
}

function shouldRedact(key: string): boolean {
	return /(KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|REDIS_URL)/i.test(key);
}

function redact(value: string): string {
	if (value.length === 0) {
		return "";
	}

	if (value.length <= 4) {
		return "****";
	}

	return `${value.slice(0, 2)}${"*".repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`;
}

function summarizeEnvIssues(
	issues: readonly { readonly key: string }[],
): string {
	const keys = issues.map((issue) => issue.key).join(", ");

	return `invalid or missing environment variables: ${keys}`;
}

function formatConfigRoot(value: unknown): string {
	if (Array.isArray(value)) {
		return `array(${value.length})`;
	}

	if (isRecord(value)) {
		return `object(${Object.keys(value).length})`;
	}

	return formatValue(value);
}

function formatValue(value: unknown): string {
	if (value === undefined) {
		return "undefined";
	}

	if (typeof value === "string") {
		return value;
	}

	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}

	return formatJson(value);
}

function formatJson(value: unknown): string {
	return (
		JSON.stringify(
			value,
			(_key: string, nestedValue: unknown): unknown => {
				if (typeof nestedValue === "bigint") {
					return nestedValue.toString();
				}

				if (typeof nestedValue === "function") {
					return `[Function ${nestedValue.name || "anonymous"}]`;
				}

				return nestedValue;
			},
			2,
		) ?? "undefined"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Command failed";
}

function capitalize(value: string): string {
	return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

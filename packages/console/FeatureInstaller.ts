import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
	type Command,
	type ConsoleKernel,
	type ConsoleOptions,
	defineCommand,
} from "./Console";
import { isEnabled, readStringOption } from "./new-app/Choices";
import { resolveRoot } from "./new-app/Paths";
import { TerminalPrompt } from "./new-app/Prompt";
import { makeNewAppFeatureFiles } from "./new-app/Templates";
import type {
	DatabasePreset,
	FeaturePreset,
	ModulePreset,
	NewAppChoices,
	NewAppFile,
	NewAppPrompt,
} from "./new-app/Types";
import {
	applyPluginInstall,
	definePluginManifest,
	type PluginInstallPlan,
	planPluginInstall,
} from "./PluginInstaller";

export interface FeatureConsoleOptions {
	readonly root?: string;
	readonly prompt?: NewAppPrompt;
}

type FeatureWriteAction = "create" | "overwrite" | "skip" | "update";

type FeatureAction = {
	readonly action: FeatureWriteAction;
	readonly path: string;
	readonly reason?: string;
};

type StarterChoices = NewAppChoices;

const appPresets = ["api", "web", "full"] as const;
const architecturePresets = ["standard", "modular", "domain"] as const;
const databasePresets = ["none", "sqlite", "postgres", "mysql"] as const;
const authPresets = ["none", "session", "access-token"] as const;
const cachePresets = ["memory", "file", "redis"] as const;
const queuePresets = ["none", "memory", "sqlite", "redis"] as const;
const modulePresets = ["mail", "storage", "i18n", "websockets"] as const;
const featurePresets = [
	"auth",
	"cache",
	"database",
	"i18n",
	"mail",
	"openapi",
	"queue",
	"storage",
	"websockets",
] as const satisfies readonly FeaturePreset[];

export function createFeatureCommands(
	options: FeatureConsoleOptions = {},
): readonly Command[] {
	return [createAddCommand(options)];
}

export function registerFeatureCommands(
	console: ConsoleKernel,
	options: FeatureConsoleOptions = {},
): ConsoleKernel {
	for (const command of createFeatureCommands(options)) {
		console.register(command);
	}

	return console;
}

function createAddCommand(options: FeatureConsoleOptions): Command {
	return defineCommand(
		{
			name: "add",
			description: "Add first-party features to an existing Kura app",
			arguments: [
				{
					name: "feature",
					description: "Feature to add",
					variadic: true,
				},
			],
			options: [
				{
					name: "root",
					alias: "r",
					value: "string",
					description: "Project root directory",
				},
				{
					name: "preset",
					value: "string",
					description: "Fallback app preset: api, web, or full",
				},
				{
					name: "architecture",
					value: "string",
					description: "Fallback project structure",
				},
				{
					name: "database",
					value: "string",
					description: "Database driver to add",
				},
				{
					name: "auth",
					value: "string",
					description: "Auth setup to add",
				},
				{
					name: "cache",
					value: "string",
					description: "Cache backend to add",
				},
				{
					name: "queue",
					value: "string",
					description: "Queue backend to add",
				},
				{
					name: "dry-run",
					description: "Print the plan without writing files",
				},
				{
					name: "force",
					alias: "f",
					description: "Overwrite generated files that already exist",
				},
				{
					name: "yes",
					alias: "y",
					description: "Skip prompts and use defaults",
				},
				{
					name: "interactive",
					description: "Force interactive prompts",
				},
			],
		},
		async (context) => {
			const root = resolveRoot(options, context.options);
			const requestedFeatures = await resolveRequestedFeatures(
				context.args,
				context.options,
				options.prompt,
			);

			if (requestedFeatures.length === 0) {
				throw new Error(
					`Command [add] requires at least one feature: ${featurePresets.join(", ")}`,
				);
			}

			const currentChoices = await readStarterChoices(root, context.options);
			const choices = mergeFeatureChoices(
				currentChoices,
				requestedFeatures,
				context.options,
			);
			const files = makeNewAppFeatureFiles({
				choices,
				features: requestedFeatures,
			});
			const dryRun = isEnabled(context.options, "dry-run");
			const force = isEnabled(context.options, "force");
			const actions = [
				...(await planFileActions(root, files, force)),
				...(await planPatchActions(
					root,
					currentChoices,
					choices,
					requestedFeatures,
				)),
			];

			context.output.write(formatFeaturePlan(root, requestedFeatures, actions));

			if (dryRun) {
				context.output.write("Dry run enabled. No files were written.");
				return 0;
			}

			await writeFeatureFiles(root, files, force);
			await applyFeaturePatches(
				root,
				currentChoices,
				choices,
				requestedFeatures,
			);
		},
	);
}

async function resolveRequestedFeatures(
	args: readonly string[],
	options: ConsoleOptions,
	prompt: NewAppPrompt | undefined,
): Promise<readonly FeaturePreset[]> {
	if (args.length > 0) {
		return normalizeFeatures(args);
	}

	const shouldPrompt =
		isEnabled(options, "interactive") ||
		(prompt !== undefined && !isEnabled(options, "yes"));

	if (!shouldPrompt) {
		return [];
	}

	const selected = await (prompt ?? new TerminalPrompt()).multiSelect(
		"Features",
		featurePresets,
		[],
		featurePresets.map((feature) => ({
			value: feature,
			label: feature,
			description: `Add ${feature}`,
		})),
	);

	return normalizeFeatures(selected);
}

function normalizeFeatures(
	values: readonly string[],
): readonly FeaturePreset[] {
	return [
		...new Set(
			values.flatMap((value) =>
				value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean)
					.map(readFeaturePreset),
			),
		),
	];
}

function readFeaturePreset(value: string): FeaturePreset {
	if (featurePresets.includes(value as FeaturePreset)) {
		return value as FeaturePreset;
	}

	throw new Error(
		`Invalid feature [${value}]. Expected one of: ${featurePresets.join(", ")}`,
	);
}

async function readStarterChoices(
	root: string,
	options: ConsoleOptions,
): Promise<StarterChoices> {
	const appConfig = await readText(join(root, "config/app.ts"));

	return {
		preset: readStarterPreset(appConfig, "preset", appPresets, options, "api"),
		architecture: readStarterPreset(
			appConfig,
			"architecture",
			architecturePresets,
			options,
			"standard",
		),
		database: readStarterPreset(
			appConfig,
			"database",
			databasePresets,
			options,
			"none",
		),
		auth: readStarterPreset(appConfig, "auth", authPresets, options, "none"),
		cache: readStarterPreset(
			appConfig,
			"cache",
			cachePresets,
			options,
			"memory",
		),
		queue: readStarterPreset(appConfig, "queue", queuePresets, options, "none"),
		modules: readStarterModules(appConfig),
		packageManager: "bun",
		install: false,
	};
}

function readStarterPreset<TValue extends string>(
	source: string | null,
	key: string,
	allowed: readonly TValue[],
	options: ConsoleOptions,
	defaultValue: TValue,
): TValue {
	const optionValue = readStringOption(options, key);
	const value =
		source?.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1] ??
		optionValue ??
		defaultValue;

	if (allowed.includes(value as TValue)) {
		return value as TValue;
	}

	throw new Error(
		`Invalid ${key} [${value}]. Expected one of: ${allowed.join(", ")}`,
	);
}

function readStarterModules(source: string | null): readonly ModulePreset[] {
	const rawModules = source?.match(/modules:\s*(\[[^\n]*\])/)?.[1];

	if (!rawModules) {
		return [];
	}

	const parsed = JSON.parse(rawModules) as unknown;
	if (!Array.isArray(parsed)) {
		return [];
	}

	return parsed
		.filter((value): value is ModulePreset =>
			modulePresets.includes(value as ModulePreset),
		)
		.filter((value, index, values) => values.indexOf(value) === index);
}

function mergeFeatureChoices(
	current: StarterChoices,
	features: readonly FeaturePreset[],
	options: ConsoleOptions,
): NewAppChoices {
	const featureSet = new Set(features);
	const modules = new Set(current.modules);

	for (const moduleName of modulePresets) {
		if (featureSet.has(moduleName)) {
			modules.add(moduleName);
		}
	}

	const database =
		featureSet.has("database") || featureSet.has("auth")
			? readPresetOption(
					options,
					"database",
					databasePresets,
					current.database === "none" ? "sqlite" : current.database,
				)
			: current.database;
	const auth = featureSet.has("auth")
		? readPresetOption(
				options,
				"auth",
				authPresets,
				current.auth === "none" ? "session" : current.auth,
			)
		: current.auth;
	const cache = featureSet.has("cache")
		? readPresetOption(
				options,
				"cache",
				cachePresets,
				current.cache === "memory" ? "file" : current.cache,
			)
		: current.cache;
	const queue = featureSet.has("queue")
		? readPresetOption(
				options,
				"queue",
				queuePresets,
				current.queue === "none" ? "memory" : current.queue,
			)
		: current.queue;

	return {
		...current,
		database,
		auth,
		cache,
		queue,
		modules: [...modules],
	};
}

function readPresetOption<TValue extends string>(
	options: ConsoleOptions,
	name: string,
	allowed: readonly TValue[],
	defaultValue: TValue,
): TValue {
	const value = readStringOption(options, name) ?? defaultValue;

	if (allowed.includes(value as TValue)) {
		return value as TValue;
	}

	throw new Error(
		`Invalid ${name} [${value}]. Expected one of: ${allowed.join(", ")}`,
	);
}

async function planFileActions(
	root: string,
	files: readonly NewAppFile[],
	force: boolean,
): Promise<readonly FeatureAction[]> {
	const actions: FeatureAction[] = [];
	const filePlan = await planFeatureFilePlugin(root, files, force);

	for (const file of files) {
		if (file.kind === "directory") {
			const path = join(root, file.path);
			const exists = await pathExists(path);
			actions.push({
				action: exists ? "skip" : "create",
				path: file.path,
				reason: exists ? "directory exists" : undefined,
			});
		}
	}

	return [...actions, ...featureActionsFromPluginPlan(filePlan)];
}

async function planPatchActions(
	root: string,
	current: StarterChoices,
	choices: NewAppChoices,
	features: readonly FeaturePreset[],
): Promise<readonly FeatureAction[]> {
	const patches = await makePatchPlans(root, current, choices, features);

	return patches.map((patch) => ({
		action: patch.changed ? "update" : "skip",
		path: relative(root, patch.path),
		reason: patch.changed ? undefined : "already up to date",
	}));
}

async function writeFeatureFiles(
	root: string,
	files: readonly NewAppFile[],
	force: boolean,
): Promise<void> {
	for (const file of files) {
		if (file.kind === "directory") {
			await mkdir(join(root, file.path), { recursive: true });
		}
	}

	await applyPluginInstall(await planFeatureFilePlugin(root, files, force));
}

async function planFeatureFilePlugin(
	root: string,
	files: readonly NewAppFile[],
	force: boolean,
): Promise<PluginInstallPlan> {
	const pluginFiles = files
		.filter((file) => file.kind !== "directory")
		.map((file) => ({
			path: file.path,
			content: file.content,
			mode: file.mode,
		}));

	if (pluginFiles.length === 0) {
		return {
			root,
			manifest: {
				name: "kura:first-party-files",
				files: [],
			},
			actions: [],
		};
	}

	return planPluginInstall(
		root,
		definePluginManifest({
			name: "kura:first-party-files",
			files: pluginFiles,
		}),
		{ force },
	);
}

function featureActionsFromPluginPlan(
	plan: PluginInstallPlan,
): readonly FeatureAction[] {
	return plan.actions.map((action) => ({
		action:
			action.status === "skip"
				? "skip"
				: action.message === "overwrite file"
					? "overwrite"
					: "create",
		path: action.path ?? "-",
		reason: action.status === "skip" ? action.message : undefined,
	}));
}

async function applyFeaturePatches(
	root: string,
	current: StarterChoices,
	choices: NewAppChoices,
	features: readonly FeaturePreset[],
): Promise<void> {
	for (const patch of await makePatchPlans(root, current, choices, features)) {
		if (!patch.changed) {
			continue;
		}

		await mkdir(dirname(patch.path), { recursive: true });
		await writeFile(patch.path, patch.next);
	}
}

type TextPatchPlan = {
	readonly path: string;
	readonly next: string;
	readonly changed: boolean;
};

async function makePatchPlans(
	root: string,
	current: StarterChoices,
	choices: NewAppChoices,
	features: readonly FeaturePreset[],
): Promise<readonly TextPatchPlan[]> {
	const plans = await Promise.all([
		patchAppConfig(root, choices),
		patchStartEnv(root, choices),
		patchEnvFile(root, ".env", choices),
		patchEnvFile(root, ".env.example", choices),
		patchKernel(root, choices, features),
		patchStartRoutes(root, choices, features),
		patchConsoleEntrypoint(root, current, choices),
	]);

	return plans.filter((plan): plan is TextPatchPlan => plan !== null);
}

async function patchAppConfig(
	root: string,
	choices: NewAppChoices,
): Promise<TextPatchPlan | null> {
	const path = join(root, "config/app.ts");
	const current = await readText(path);

	if (!current) {
		return null;
	}

	const next = [
		(source: string) =>
			replaceStarterValue(source, "database", choices.database),
		(source: string) => replaceStarterValue(source, "auth", choices.auth),
		(source: string) => replaceStarterValue(source, "cache", choices.cache),
		(source: string) => replaceStarterValue(source, "queue", choices.queue),
		(source: string) =>
			source.replace(
				/modules:\s*\[[^\n]*\]/,
				`modules: ${JSON.stringify(choices.modules)}`,
			),
	].reduce((source, apply) => apply(source), current);

	return { path, next, changed: next !== current };
}

function replaceStarterValue(
	source: string,
	key: string,
	value: string,
): string {
	return source.replace(new RegExp(`${key}:\\s*"[^"]+"`), `${key}: "${value}"`);
}

async function patchStartEnv(
	root: string,
	choices: NewAppChoices,
): Promise<TextPatchPlan | null> {
	const path = join(root, "start/env.ts");
	const current = await readText(path);

	if (!current) {
		return null;
	}

	const entries = envSchemaEntries(choices).filter(
		(entry) => !current.includes(`${entry.key}:`),
	);

	if (entries.length === 0) {
		return { path, next: current, changed: false };
	}

	const insertion = entries
		.map((entry) => `\t${entry.key}: ${entry.value},`)
		.join("\n");
	const next = current.replace(/(\n}\);\n)/, `\n${insertion}$1`);

	return { path, next, changed: next !== current };
}

async function patchEnvFile(
	root: string,
	name: ".env" | ".env.example",
	choices: NewAppChoices,
): Promise<TextPatchPlan | null> {
	const path = join(root, name);
	const current = await readText(path);

	if (current === null) {
		return null;
	}

	const lines = envFileEntries(choices).filter(
		(entry) => !current.includes(`${entry.key}=`),
	);

	if (lines.length === 0) {
		return { path, next: current, changed: false };
	}

	const separator = current.endsWith("\n") ? "" : "\n";
	const next = `${current}${separator}${lines
		.map((entry) => `${entry.key}=${entry.value}`)
		.join("\n")}\n`;

	return { path, next, changed: true };
}

async function patchStartRoutes(
	root: string,
	choices: NewAppChoices,
	features: readonly FeaturePreset[],
): Promise<TextPatchPlan | null> {
	const path = join(root, "start/routes.ts");
	const current = await readText(path);

	if (!current) {
		return null;
	}

	let next = current;
	const featureSet = new Set(features);

	if (featureSet.has("auth")) {
		next = ensureImport(
			next,
			'import { registerAuthRoutes } from "#routes/auth";',
		);
		next = ensureRouteRegistration(next, "registerAuthRoutes(router);");
	}

	if (featureSet.has("openapi") && choices.preset !== "web") {
		next = ensureImport(
			next,
			'import { registerDocumentationRoutes } from "#routes/openapi";',
		);
		next = ensureRouteRegistration(
			next,
			"registerDocumentationRoutes(router);",
		);
	}

	return { path, next, changed: next !== current };
}

async function patchKernel(
	root: string,
	choices: NewAppChoices,
	features: readonly FeaturePreset[],
): Promise<TextPatchPlan | null> {
	if (!features.includes("auth")) {
		return null;
	}

	const path = join(root, "start/kernel.ts");
	const current = await readText(path);

	if (!current) {
		return null;
	}

	let next = ensureImport(
		current,
		`import { authMiddleware } from "${authMiddlewareImport(choices)}";`,
	);

	if (next.includes("auth: authMiddleware")) {
		return { path, next, changed: next !== current };
	}

	if (next.includes("export const middleware = {};")) {
		next = next.replace(
			"export const middleware = {};",
			"export const middleware = {\n\tauth: authMiddleware,\n};",
		);
	} else {
		next = next.replace(
			/export const middleware = \{\n/,
			"export const middleware = {\n\tauth: authMiddleware,\n",
		);
	}

	return { path, next, changed: next !== current };
}

function authMiddlewareImport(choices: NewAppChoices): string {
	if (choices.architecture === "domain") {
		return "#domains/auth/http/auth_middleware";
	}

	if (choices.architecture === "modular") {
		return "#modules/auth/auth_middleware";
	}

	return "#middleware/auth_middleware";
}

async function patchConsoleEntrypoint(
	root: string,
	current: StarterChoices,
	choices: NewAppChoices,
): Promise<TextPatchPlan | null> {
	const path = join(root, "bin/console.ts");
	const source = await readText(path);

	if (!source) {
		return null;
	}

	let next = source;

	if (!next.includes("registerFeatureCommands")) {
		next = next.replace(
			/registerGeneratorCommands,\n/,
			"registerFeatureCommands,\n\tregisterGeneratorCommands,\n",
		);
		next = next.replace(/} from "kura\/console";/, '} from "kura/console";');
		next = next.replace(
			/registerGeneratorCommands\(appConsole,[\s\S]*?\}\);\n/,
			(match) =>
				`${match}registerFeatureCommands(appConsole, {\n\troot: process.cwd(),\n});\n`,
		);
	}

	if (choices.database !== "none" && current.database === "none") {
		if (!next.includes('from "#database/connection"')) {
			next = `import { database } from "#database/connection";\nimport { migrations } from "#database/migrations";\nimport { registerDatabaseCommands } from "kura/database";\n${next}`;
		}

		if (!next.includes("registerDatabaseCommands(appConsole")) {
			next = next.replace(
				/registerPreviewCommand\(appConsole,[\s\S]*?\}\);\n/,
				(match) =>
					`${match}registerDatabaseCommands(appConsole, {\n\tdatabase,\n\tmigrations,\n});\n`,
			);
		}
	}

	return { path, next, changed: next !== source };
}

function ensureImport(source: string, importLine: string): string {
	if (source.includes(importLine)) {
		return source;
	}

	const importLines = source.match(/^(import .+;\n)+/);
	if (!importLines) {
		return `${importLine}\n${source}`;
	}

	return source.replace(importLines[0], `${importLines[0]}${importLine}\n`);
}

function ensureRouteRegistration(source: string, line: string): string {
	if (source.includes(line)) {
		return source;
	}

	if (source.includes("registerDocumentationRoutes(router);")) {
		return source.replace(
			"registerDocumentationRoutes(router);",
			`${line}\nregisterDocumentationRoutes(router);`,
		);
	}

	return source.replace(
		"export const router = new Router();",
		`export const router = new Router();\n\n${line}`,
	);
}

function envFileEntries(choices: NewAppChoices): readonly {
	readonly key: string;
	readonly value: string;
}[] {
	const entries: { key: string; value: string }[] = [];

	if (choices.auth !== "none") {
		entries.push({ key: "HASH_DRIVER", value: "bcrypt" });
		entries.push({
			key: "AUTH_GUARD",
			value: choices.auth === "session" ? "web" : "api",
		});
	}

	if (choices.auth === "session") {
		entries.push({ key: "SESSION_DRIVER", value: "database" });
		entries.push({ key: "SESSION_COOKIE_NAME", value: "kura-session" });
		entries.push({ key: "SESSION_TTL_SECONDS", value: "7200" });
		if (choices.preset !== "api") {
			entries.push({ key: "CSRF_COOKIE_NAME", value: "kura-csrf-token" });
		}
	}

	if (choices.cache !== "memory") {
		entries.push({ key: "CACHE_STORE", value: choices.cache });
	}

	if (choices.queue !== "none") {
		entries.push({ key: "QUEUE_CONNECTION", value: choices.queue });
	}

	if (choices.database !== "none" || choices.auth !== "none") {
		entries.push({
			key: "DB_CONNECTION",
			value: defaultDatabaseConnection(choices),
		});
	}

	if (choices.database === "postgres" || choices.database === "mysql") {
		entries.push({ key: "DATABASE_URL", value: "" });
	}

	if (choices.cache === "redis" || choices.queue === "redis") {
		entries.push({ key: "REDIS_URL", value: "" });
	}

	return entries;
}

function envSchemaEntries(choices: NewAppChoices): readonly {
	readonly key: string;
	readonly value: string;
}[] {
	const entries: { key: string; value: string }[] = [];

	if (choices.auth !== "none") {
		entries.push({
			key: "HASH_DRIVER",
			value: 'envVar.enum(["bcrypt", "argon2id", "argon2i"]).default("bcrypt")',
		});
		entries.push({
			key: "AUTH_GUARD",
			value: `envVar.enum(["web", "api", "none"]).default(${JSON.stringify(
				choices.auth === "session" ? "web" : "api",
			)})`,
		});
	}

	if (choices.auth === "session") {
		entries.push({
			key: "SESSION_DRIVER",
			value:
				'envVar.enum(["cookie", "memory", "database"]).default("database")',
		});
		entries.push({
			key: "SESSION_COOKIE_NAME",
			value: 'envVar.string().default("kura-session")',
		});
		entries.push({
			key: "SESSION_TTL_SECONDS",
			value: "envVar.number().default(7200)",
		});

		if (choices.preset !== "api") {
			entries.push({
				key: "CSRF_COOKIE_NAME",
				value: 'envVar.string().default("kura-csrf-token")',
			});
		}
	}

	if (choices.cache !== "memory") {
		entries.push({
			key: "CACHE_STORE",
			value: `envVar.enum(["memory", "file", "redis"]).default(${JSON.stringify(
				choices.cache,
			)})`,
		});
	}

	if (choices.queue !== "none") {
		entries.push({
			key: "QUEUE_CONNECTION",
			value: `envVar.enum(["none", "memory", "sqlite", "redis"]).default(${JSON.stringify(
				choices.queue,
			)})`,
		});
	}

	if (choices.database !== "none" || choices.auth !== "none") {
		entries.push({
			key: "DB_CONNECTION",
			value: `envVar.enum(["memory", "sqlite", "postgres", "mysql"]).default(${JSON.stringify(
				defaultDatabaseConnection(choices),
			)})`,
		});
	}

	if (choices.database === "postgres" || choices.database === "mysql") {
		entries.push({ key: "DATABASE_URL", value: "envVar.url().secret()" });
	}

	if (choices.cache === "redis" || choices.queue === "redis") {
		entries.push({ key: "REDIS_URL", value: "envVar.url().secret()" });
	}

	return entries;
}

function defaultDatabaseConnection(
	choices: NewAppChoices,
): DatabasePreset | "memory" {
	if (choices.database !== "none") {
		return choices.database;
	}

	if (choices.auth !== "none") {
		return "sqlite";
	}

	return "memory";
}

function formatFeaturePlan(
	root: string,
	features: readonly FeaturePreset[],
	actions: readonly FeatureAction[],
): string {
	const rows = [
		"Kura add",
		"",
		"  Project",
		`  Root      ${root}`,
		`  Features  ${features.join(", ")}`,
		"",
		"  Plan",
		...actions.map((action) => {
			const reason = action.reason ? ` (${action.reason})` : "";
			return `  ${action.action.padEnd(9)} ${action.path}${reason}`;
		}),
	];

	return rows.join("\n");
}

async function readText(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

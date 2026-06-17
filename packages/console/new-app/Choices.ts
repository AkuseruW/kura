import type { ConsoleOptions } from "../Console";
import type {
	AppPreset,
	AuthPreset,
	CachePreset,
	DatabasePreset,
	ModulePreset,
	NewAppChoices,
	NewAppConsoleOptions,
	NewAppPrompt,
	NewAppPromptChoice,
	QueuePreset,
} from "./Types";

const appPresetChoices = [
	{
		value: "api",
		label: "API",
		description: "JSON API starter",
	},
	{
		value: "web",
		label: "Web",
		description: "Server-rendered web app",
	},
	{
		value: "full",
		label: "Full",
		description: "API and web app",
	},
] as const satisfies readonly NewAppPromptChoice<AppPreset>[];

const databasePresetChoices = [
	{
		value: "none",
		label: "None",
		description: "No database configured",
	},
	{
		value: "sqlite",
		label: "SQLite",
		description: "Local file database",
	},
	{
		value: "postgres",
		label: "Postgres",
		description: "Production SQL database",
	},
	{
		value: "mysql",
		label: "MySQL",
		description: "Production SQL database",
	},
] as const satisfies readonly NewAppPromptChoice<DatabasePreset>[];

const authPresetChoices = [
	{
		value: "none",
		label: "None",
		description: "No auth scaffold",
	},
	{
		value: "session",
		label: "Session",
		description: "Cookie-based browser auth",
	},
	{
		value: "jwt",
		label: "JWT",
		description: "Bearer token API auth",
	},
] as const satisfies readonly NewAppPromptChoice<AuthPreset>[];

const cachePresetChoices = [
	{
		value: "memory",
		label: "Memory",
		description: "In-memory cache store",
	},
	{
		value: "file",
		label: "File",
		description: "Filesystem cache store",
	},
	{
		value: "redis",
		label: "Redis",
		description: "Redis-backed cache store",
	},
] as const satisfies readonly NewAppPromptChoice<CachePreset>[];

const queuePresetChoices = [
	{
		value: "none",
		label: "None",
		description: "No queue configured",
	},
	{
		value: "memory",
		label: "Memory",
		description: "In-memory jobs",
	},
	{
		value: "sqlite",
		label: "SQLite",
		description: "Persistent local jobs",
	},
	{
		value: "redis",
		label: "Redis",
		description: "Redis-backed jobs",
	},
] as const satisfies readonly NewAppPromptChoice<QueuePreset>[];

const modulePresetChoices = [
	{
		value: "mail",
		label: "Mail",
		description: "Email delivery",
	},
	{
		value: "storage",
		label: "Storage",
		description: "File storage",
	},
	{
		value: "i18n",
		label: "i18n",
		description: "Translations",
	},
	{
		value: "websockets",
		label: "WebSockets",
		description: "Realtime server",
	},
] as const satisfies readonly NewAppPromptChoice<ModulePreset>[];

const appPresets = values(appPresetChoices);
const databasePresets = values(databasePresetChoices);
const authPresets = values(authPresetChoices);
const cachePresets = values(cachePresetChoices);
const queuePresets = values(queuePresetChoices);
const modulePresets = values(modulePresetChoices);

export function resolveChoices(options: ConsoleOptions): NewAppChoices {
	return {
		preset: readChoice(options, "preset", appPresets, "api"),
		database: readChoice(options, "database", databasePresets, "none"),
		auth: readChoice(options, "auth", authPresets, "none"),
		cache: readChoice(options, "cache", cachePresets, "memory"),
		queue: readChoice(options, "queue", queuePresets, "none"),
		modules: readModules(options),
		packageManager: "bun",
		install: isEnabled(options, "install"),
	};
}

export async function promptChoices(
	options: ConsoleOptions,
	prompt: NewAppPrompt,
): Promise<NewAppChoices> {
	const defaults = resolveChoices(options);

	return {
		preset: readPreset(
			await prompt.select(
				"Application type",
				appPresets,
				defaults.preset,
				appPresetChoices,
			),
			appPresets,
			"preset",
		),
		database: readPreset(
			await prompt.select(
				"Database",
				databasePresets,
				defaults.database,
				databasePresetChoices,
			),
			databasePresets,
			"database",
		),
		auth: readPreset(
			await prompt.select(
				"Auth",
				authPresets,
				defaults.auth,
				authPresetChoices,
			),
			authPresets,
			"auth",
		),
		cache: readPreset(
			await prompt.select(
				"Cache",
				cachePresets,
				defaults.cache,
				cachePresetChoices,
			),
			cachePresets,
			"cache",
		),
		queue: readPreset(
			await prompt.select(
				"Queue",
				queuePresets,
				defaults.queue,
				queuePresetChoices,
			),
			queuePresets,
			"queue",
		),
		modules: readModuleChoices(
			await prompt.multiSelect(
				"Optional modules",
				modulePresets,
				defaults.modules,
				modulePresetChoices,
			),
		),
		packageManager: "bun",
		install: await prompt.confirm("Install dependencies", defaults.install),
	};
}

export function readStringOption(
	options: ConsoleOptions,
	name: string,
): string | undefined {
	const value = options[name];

	if (Array.isArray(value)) {
		return value.at(-1);
	}

	return typeof value === "string" ? value : undefined;
}

function readChoice<TChoice extends string>(
	options: ConsoleOptions,
	name: string,
	choices: readonly TChoice[],
	defaultValue: TChoice,
): TChoice {
	const value = readStringOption(options, name) ?? defaultValue;

	return readPreset(value, choices, name);
}

function readPreset<TChoice extends string>(
	value: string,
	choices: readonly TChoice[],
	name: string,
): TChoice {
	if (choices.includes(value as TChoice)) {
		return value as TChoice;
	}

	throw new Error(
		`Invalid ${name} [${value}]. Expected one of: ${choices.join(", ")}`,
	);
}

function readModules(options: ConsoleOptions): readonly ModulePreset[] {
	const value = options.module;

	if (value === undefined || value === false) {
		return [];
	}

	const rawValues = Array.isArray(value) ? value : [String(value)];
	const modules = rawValues.flatMap((item) =>
		item
			.split(",")
			.map((moduleName) => moduleName.trim())
			.filter(Boolean),
	);

	return readModuleChoices(modules);
}

function readModuleChoices(values: readonly string[]): readonly ModulePreset[] {
	return [
		...new Set(
			values.map((value) => readPreset(value, modulePresets, "module")),
		),
	];
}

export function shouldPrompt(
	options: ConsoleOptions,
	commandOptions: NewAppConsoleOptions,
): boolean {
	if (isEnabled(options, "yes")) {
		return false;
	}

	if (
		isEnabled(options, "interactive") ||
		commandOptions.prompt !== undefined
	) {
		return true;
	}

	const stdin = process.stdin as { isTTY?: boolean };

	return stdin.isTTY === true;
}

export function isEnabled(options: ConsoleOptions, name: string): boolean {
	return options[name] === true;
}

function values<TValue extends string>(
	choices: readonly NewAppPromptChoice<TValue>[],
): readonly TValue[] {
	return choices.map((choice) => choice.value);
}

import type { ConsoleOptions } from "../Console";
import type {
	ModulePreset,
	NewAppChoices,
	NewAppConsoleOptions,
	NewAppPrompt,
} from "./Types";

const appPresets = ["api", "web", "full"] as const;
const databasePresets = ["none", "sqlite", "postgres", "mysql"] as const;
const authPresets = ["none", "session", "jwt"] as const;
const cachePresets = ["memory", "file", "redis"] as const;
const queuePresets = ["none", "memory", "sqlite", "redis"] as const;
const modulePresets = ["mail", "storage", "i18n", "websockets"] as const;

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
			await prompt.select("Application type", appPresets, defaults.preset),
			appPresets,
			"preset",
		),
		database: readPreset(
			await prompt.select("Database", databasePresets, defaults.database),
			databasePresets,
			"database",
		),
		auth: readPreset(
			await prompt.select("Auth", authPresets, defaults.auth),
			authPresets,
			"auth",
		),
		cache: readPreset(
			await prompt.select("Cache", cachePresets, defaults.cache),
			cachePresets,
			"cache",
		),
		queue: readPreset(
			await prompt.select("Queue", queuePresets, defaults.queue),
			queuePresets,
			"queue",
		),
		modules: readModuleChoices(
			await prompt.multiSelect(
				"Optional modules",
				modulePresets,
				defaults.modules,
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

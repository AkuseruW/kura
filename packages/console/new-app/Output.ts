import { relative } from "node:path";
import type { NewAppChoices } from "./Types";

export function formatNewAppCreated(options: {
	readonly appName: string;
	readonly choices: NewAppChoices;
	readonly currentDirectory: string;
	readonly duration: number;
	readonly installed: boolean;
	readonly root: string;
	readonly targetPath: string;
}): string {
	const appPath = relative(options.root, options.targetPath) || ".";
	const nextPath =
		relative(options.currentDirectory, options.targetPath) || ".";
	const lines = [
		"Kura new",
		"",
		"  Application",
		formatRow("Name", options.appName),
		formatRow("Path", appPath),
		formatRow("Preset", formatPreset(options.choices.preset)),
		formatRow("Database", options.choices.database),
		formatRow("Auth", options.choices.auth),
		formatRow("Cache", options.choices.cache),
		formatRow("Queue", options.choices.queue),
		formatRow("Modules", formatModules(options.choices.modules)),
		"",
		`Created ${appPath} in ${formatDuration(options.duration)}`,
	];

	if (options.installed) {
		lines.push("Dependencies installed");
	}

	lines.push("", "Next steps", `  cd ${nextPath}`);

	if (!options.installed) {
		lines.push("  bun install");
	}

	lines.push("  bun kura", "  bun run dev");

	return lines.join("\n");
}

function formatRow(label: string, value: string): string {
	return `  ${label.padEnd(8)} ${value}`;
}

function formatModules(modules: readonly string[]): string {
	return modules.length === 0 ? "none" : modules.join(", ");
}

function formatPreset(preset: string): string {
	return preset === "api" ? "API" : preset;
}

function formatDuration(duration: number): string {
	return `${Math.max(0, Math.round(duration))}ms`;
}

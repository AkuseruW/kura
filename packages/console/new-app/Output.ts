import { relative } from "node:path";
import { featureSupportRows } from "./FeatureStatus";
import type { NewAppChoices, NewAppFile } from "./Types";

export function formatNewAppPlan(options: {
	readonly appName: string;
	readonly choices: NewAppChoices;
	readonly files: readonly NewAppFile[];
	readonly root: string;
	readonly targetPath: string;
}): string {
	const appPath = relative(options.root, options.targetPath) || ".";
	const fileCount = options.files.filter(
		(file) => file.kind !== "directory",
	).length;
	const directoryCount = options.files.length - fileCount;
	const lines = [
		"Kura new",
		"",
		"  Project",
		formatRow("Name", options.appName),
		formatRow("Path", appPath),
		formatRow("Preset", formatPreset(options.choices.preset)),
		formatRow("Structure", options.choices.architecture),
		formatRow("Database", options.choices.database),
		formatRow("Auth", options.choices.auth),
		formatRow("Cache", options.choices.cache),
		formatRow("Queue", options.choices.queue),
		formatRow("Modules", formatModules(options.choices.modules)),
		"",
		"  Feature Status",
		...formatFeatureSupportRows(options.choices),
		"",
		"  Scaffold",
		formatRow("Files", String(fileCount)),
		formatRow("Dirs", String(directoryCount)),
		formatRow("Install", options.choices.install ? "yes" : "no"),
		"",
		"  Routes",
		...formatRouteRows(options.choices),
		"",
		"  Commands",
		"  bun kura",
		"  bun kura routes",
		"  bun kura configure",
		"  bun kura doctor",
		"  bun kura deploy:doctor",
		"  bun kura upgrade",
		"  bun run preview",
	];

	return lines.join("\n");
}

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
		formatRow("Structure", options.choices.architecture),
		formatRow("Database", options.choices.database),
		formatRow("Auth", options.choices.auth),
		formatRow("Cache", options.choices.cache),
		formatRow("Queue", options.choices.queue),
		formatRow("Modules", formatModules(options.choices.modules)),
		"",
		"  Feature Status",
		...formatFeatureSupportRows(options.choices),
		"",
		`Created ${appPath} in ${formatDuration(options.duration)}`,
	];

	if (options.installed) {
		lines.push("Dependencies installed");
	}

	lines.push(
		"",
		"Routes",
		...formatRouteRows(options.choices),
		"",
		"Useful commands",
		"  bun kura",
		"  bun kura routes",
		"  bun kura configure",
		"  bun kura doctor",
		"  bun kura deploy:doctor",
		"  bun kura upgrade",
		"  bun kura env",
		"  bun kura config app.starter",
		"  bun run preview",
		"",
		"Next steps",
		`  cd ${nextPath}`,
	);

	if (!options.installed) {
		lines.push("  bun install");
	}

	lines.push("  bun run dev", "", "Open http://localhost:3333");

	return lines.join("\n");
}

function formatRow(label: string, value: string): string {
	return `  ${label.padEnd(8)} ${value}`;
}

function formatFeatureSupportRows(choices: NewAppChoices): string[] {
	return featureSupportRows(choices).map(
		(row) => `  ${row.name.padEnd(10)} ${row.status.padEnd(13)} ${row.message}`,
	);
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

function formatRouteRows(choices: NewAppChoices): string[] {
	const rows =
		choices.preset === "full"
			? ["  GET /", "  GET /health", "  GET /api", "  GET /api/health"]
			: choices.preset === "web"
				? ["  GET /", "  GET /health"]
				: ["  GET /", "  GET /health"];

	if (choices.auth !== "none") {
		rows.push(
			"  GET /auth/me",
			"  POST /auth/login",
			"  POST /auth/register",
			"  POST /auth/logout",
		);
	}

	return rows;
}

import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Command, type ConsoleKernel, defineCommand } from "./Console";
import { isEnabled, readStringOption } from "./new-app/Choices";
import { resolveRoot } from "./new-app/Paths";

export interface UpgradeConsoleOptions {
	readonly root?: string;
	readonly runtimeVersion?: string;
}

type UpgradeStatus = "ahead" | "behind" | "current" | "unknown";
type UpgradeActionStatus = "apply" | "skip" | "suggest";

type UpgradeAction = {
	readonly name: string;
	readonly status: UpgradeActionStatus;
	readonly path?: string;
	readonly message: string;
	apply?(): Promise<void>;
};

type UpgradePlan = {
	readonly root: string;
	readonly dependencySpec?: string;
	readonly installedVersion?: string;
	readonly targetVersion: string;
	readonly status: UpgradeStatus;
	readonly actions: readonly UpgradeAction[];
};

type WritablePackageJson = Record<string, unknown> & {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

const runtimePackageName = "@akuseru_w/kura";
const localAliasName = "kura";

export function createUpgradeCommands(
	options: UpgradeConsoleOptions = {},
): readonly Command[] {
	return [createUpgradeCommand(options)];
}

export function registerUpgradeCommands(
	console: ConsoleKernel,
	options: UpgradeConsoleOptions = {},
): ConsoleKernel {
	for (const command of createUpgradeCommands(options)) {
		console.register(command);
	}

	return console;
}

function createUpgradeCommand(options: UpgradeConsoleOptions): Command {
	return defineCommand(
		{
			name: "upgrade",
			description: "Upgrade generated Kura app files safely",
			options: [
				{
					name: "root",
					alias: "r",
					value: "string",
					description: "Project root directory",
				},
				{
					name: "check",
					description: "Report whether the app is behind without writing files",
				},
				{
					name: "dry-run",
					description: "Print planned migrations without writing files",
				},
				{
					name: "from",
					value: "string",
					description: "Override the detected installed version",
				},
				{
					name: "to",
					value: "string",
					description: "Target Kura version to migrate to",
				},
				{
					name: "json",
					alias: "j",
					description: "Print the upgrade plan as JSON",
				},
			],
		},
		async (context) => {
			const root = resolveRoot(options, context.options);
			const plan = await planUpgrade(root, {
				fromVersion: readStringOption(context.options, "from"),
				toVersion:
					readStringOption(context.options, "to") ??
					options.runtimeVersion ??
					(await resolveRuntimeVersion()),
			});
			const checkOnly = isEnabled(context.options, "check");
			const dryRun = isEnabled(context.options, "dry-run");

			if (isEnabled(context.options, "json")) {
				context.output.write(JSON.stringify(serializePlan(plan), null, "\t"));
			} else {
				context.output.write(formatUpgradePlan(plan, { checkOnly, dryRun }));
			}

			if (checkOnly || dryRun) {
				return 0;
			}

			for (const action of plan.actions) {
				if (action.status === "apply") {
					await action.apply?.();
				}
			}

			return 0;
		},
	);
}

async function planUpgrade(
	root: string,
	options: {
		readonly fromVersion?: string;
		readonly toVersion: string;
	},
): Promise<UpgradePlan> {
	const packageJsonPath = join(root, "package.json");
	const packageJson = await readWritablePackageJson(packageJsonPath);

	if (!packageJson) {
		return {
			root,
			targetVersion: options.toVersion,
			status: "unknown",
			actions: [
				{
					name: "package:inspect",
					status: "suggest",
					path: "package.json",
					message: "package.json is missing or could not be parsed",
				},
			],
		};
	}

	const dependencySpec = readKuraDependencySpec(packageJson);
	const installedVersion =
		options.fromVersion ??
		(await readInstalledRuntimeVersion(root)) ??
		parseDependencyVersion(dependencySpec);
	const status = compareUpgradeStatus(installedVersion, options.toVersion);
	const actions = [
		...(await planDependencyMigration(
			packageJsonPath,
			packageJson,
			dependencySpec,
			options.toVersion,
			status,
		)),
		...(await planPackageScriptMigration(root, packageJsonPath, packageJson)),
		...(await planConsoleEntrypointMigration(root)),
	];

	return {
		root,
		dependencySpec,
		installedVersion,
		targetVersion: options.toVersion,
		status,
		actions,
	};
}

async function planDependencyMigration(
	path: string,
	packageJson: WritablePackageJson,
	dependencySpec: string | undefined,
	targetVersion: string,
	status: UpgradeStatus,
): Promise<readonly UpgradeAction[]> {
	if (!dependencySpec) {
		return [
			{
				name: "dependency:kura",
				status: "suggest",
				path: "package.json",
				message: "kura dependency alias is missing",
			},
		];
	}

	if (isLocalDependency(dependencySpec)) {
		return [
			{
				name: "dependency:kura",
				status: "suggest",
				path: "package.json",
				message:
					"local runtime dependency detected; publish/install a package version before production upgrades",
			},
		];
	}

	if (status !== "behind") {
		return [
			{
				name: "dependency:kura",
				status: "skip",
				path: "package.json",
				message: `dependency is ${status}`,
			},
		];
	}

	const currentDependencies = readStringRecord(packageJson.dependencies);
	const currentDevDependencies = readStringRecord(packageJson.devDependencies);
	const dependencySection =
		currentDependencies[localAliasName] !== undefined
			? "dependencies"
			: currentDevDependencies[localAliasName] !== undefined
				? "devDependencies"
				: undefined;

	if (dependencySection === undefined) {
		return [
			{
				name: "dependency:kura",
				status: "suggest",
				path: "package.json",
				message: "dependency is not installed under the local kura alias",
			},
		];
	}

	return [
		{
			name: "dependency:kura",
			status: "apply",
			path: "package.json",
			message: `update kura dependency to ${targetVersion}`,
			apply: async () => {
				await writePackageJsonPatch(path, (current) => ({
					...current,
					[dependencySection]: {
						...readStringRecord(current[dependencySection]),
						[localAliasName]: `npm:${runtimePackageName}@${targetVersion}`,
					},
				}));
			},
		},
	];
}

async function planPackageScriptMigration(
	root: string,
	path: string,
	packageJson: WritablePackageJson,
): Promise<readonly UpgradeAction[]> {
	if (!(await exists(join(root, "bin/console.ts")))) {
		return [
			{
				name: "package:scripts",
				status: "suggest",
				path: "package.json",
				message: "bin/console.ts is missing; upgrade script was not added",
			},
		];
	}

	const scripts = readStringRecord(packageJson.scripts);

	if (scripts.upgrade === "bun bin/console.ts upgrade") {
		return [
			{
				name: "package:scripts",
				status: "skip",
				path: "package.json",
				message: "upgrade script is already configured",
			},
		];
	}

	return [
		{
			name: "package:scripts",
			status: "apply",
			path: "package.json",
			message: "add upgrade script",
			apply: async () => {
				await writePackageJsonPatch(path, (current) => ({
					...current,
					scripts: sortRecord({
						...readStringRecord(current.scripts),
						upgrade: "bun bin/console.ts upgrade",
					}),
				}));
			},
		},
	];
}

async function planConsoleEntrypointMigration(
	root: string,
): Promise<readonly UpgradeAction[]> {
	const path = join(root, "bin/console.ts");
	const source = await readOptionalText(path);

	if (source === undefined) {
		return [
			{
				name: "console:upgrade",
				status: "suggest",
				path: "bin/console.ts",
				message: "console entrypoint is missing",
			},
		];
	}

	if (source.includes("registerUpgradeCommands")) {
		return [
			{
				name: "console:upgrade",
				status: "skip",
				path: "bin/console.ts",
				message: "upgrade command is already registered",
			},
		];
	}

	const next = patchConsoleEntrypoint(source);

	if (next === source) {
		return [
			{
				name: "console:upgrade",
				status: "suggest",
				path: "bin/console.ts",
				message: "upgrade command could not be inserted automatically",
			},
		];
	}

	return [
		{
			name: "console:upgrade",
			status: "apply",
			path: "bin/console.ts",
			message: "register upgrade command",
			apply: async () => {
				await writeFile(path, next);
			},
		},
	];
}

function patchConsoleEntrypoint(source: string): string {
	const withImport = addKuraConsoleImport(source, "registerUpgradeCommands");
	const registration = [
		"registerUpgradeCommands(appConsole, {",
		"\troot: process.cwd(),",
		"});",
		"",
	].join("\n");

	return insertAfterConsoleRegistration(withImport, registration, [
		"registerFeatureCommands",
		"registerGeneratorCommands",
	]);
}

function insertAfterConsoleRegistration(
	source: string,
	registration: string,
	anchors: readonly string[],
): string {
	for (const anchor of anchors) {
		const next = source.replace(
			new RegExp(`${anchor}\\(appConsole,[\\s\\S]*?\\}\\);\\n`),
			(match) => `${match}${registration}`,
		);

		if (next !== source) {
			return next;
		}
	}

	return source;
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

			const insertAt = current.indexOf("registerPreviewCommand");
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

async function writePackageJsonPatch(
	path: string,
	patch: (packageJson: WritablePackageJson) => WritablePackageJson,
): Promise<void> {
	const current = await readWritablePackageJson(path);

	if (!current) {
		throw new Error("package.json is missing or could not be parsed");
	}

	await writeFile(path, `${JSON.stringify(patch(current), null, "\t")}\n`);
}

async function readInstalledRuntimeVersion(
	root: string,
): Promise<string | undefined> {
	const candidates = [
		join(root, "node_modules", localAliasName, "package.json"),
		join(root, "node_modules", runtimePackageName, "package.json"),
	];

	for (const candidate of candidates) {
		const version = await readPackageVersion(candidate);

		if (version !== undefined) {
			return version;
		}
	}

	return undefined;
}

async function resolveRuntimeVersion(): Promise<string> {
	const sourcePath = fileURLToPath(import.meta.url);
	const candidates = [
		process.cwd(),
		dirname(sourcePath),
		resolve(dirname(sourcePath), ".."),
		resolve(dirname(sourcePath), "../.."),
		resolve(dirname(sourcePath), "../../.."),
		resolve(dirname(sourcePath), "../../../.."),
	];
	const seen = new Set<string>();

	for (const candidate of candidates) {
		const root = resolve(candidate);

		if (seen.has(root)) {
			continue;
		}

		seen.add(root);

		const version = await readPackageVersion(join(root, "package.json"));

		if (version !== undefined) {
			return version;
		}
	}

	return "0.1.0";
}

async function readPackageVersion(path: string): Promise<string | undefined> {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

		if (!isRecord(parsed)) {
			return undefined;
		}

		return parsed.name === runtimePackageName &&
			typeof parsed.version === "string"
			? parsed.version
			: undefined;
	} catch {
		return undefined;
	}
}

function readKuraDependencySpec(
	packageJson: WritablePackageJson,
): string | undefined {
	const dependencies = readStringRecord(packageJson.dependencies);
	const devDependencies = readStringRecord(packageJson.devDependencies);

	return dependencies[localAliasName] ?? devDependencies[localAliasName];
}

function parseDependencyVersion(spec: string | undefined): string | undefined {
	if (!spec || isLocalDependency(spec)) {
		return undefined;
	}

	const npmAliasPrefix = `npm:${runtimePackageName}@`;
	if (spec.startsWith(npmAliasPrefix)) {
		return cleanVersion(spec.slice(npmAliasPrefix.length));
	}

	if (spec.startsWith(`${runtimePackageName}@`)) {
		return cleanVersion(spec.slice(runtimePackageName.length + 1));
	}

	return cleanVersion(spec);
}

function cleanVersion(version: string): string | undefined {
	const match = version.match(/(\d+)\.(\d+)\.(\d+)/);

	return match?.[0];
}

function compareUpgradeStatus(
	installedVersion: string | undefined,
	targetVersion: string,
): UpgradeStatus {
	if (!installedVersion) {
		return "unknown";
	}

	const comparison = compareVersions(installedVersion, targetVersion);

	if (comparison < 0) {
		return "behind";
	}

	if (comparison > 0) {
		return "ahead";
	}

	return "current";
}

function compareVersions(left: string, right: string): number {
	const leftParts = parseVersionParts(left);
	const rightParts = parseVersionParts(right);

	for (let index = 0; index < 3; index += 1) {
		const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

		if (diff !== 0) {
			return diff;
		}
	}

	return 0;
}

function parseVersionParts(version: string): readonly [number, number, number] {
	const match = version.match(/(\d+)\.(\d+)\.(\d+)/);

	if (!match) {
		return [0, 0, 0];
	}

	return [
		Number.parseInt(match[1] ?? "0", 10),
		Number.parseInt(match[2] ?? "0", 10),
		Number.parseInt(match[3] ?? "0", 10),
	];
}

function isLocalDependency(version: string): boolean {
	return (
		version.startsWith("file:") ||
		version.startsWith("link:") ||
		version.startsWith("workspace:")
	);
}

async function readOptionalText(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return undefined;
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

function sortRecord(
	record: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
	);
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializePlan(plan: UpgradePlan): Record<string, unknown> {
	return {
		root: plan.root,
		dependencySpec: plan.dependencySpec,
		installedVersion: plan.installedVersion,
		targetVersion: plan.targetVersion,
		status: plan.status,
		actions: plan.actions.map((action) => ({
			name: action.name,
			status: action.status,
			path: action.path,
			message: action.message,
		})),
	};
}

function formatUpgradePlan(
	plan: UpgradePlan,
	mode: {
		readonly checkOnly: boolean;
		readonly dryRun: boolean;
	},
): string {
	const lines = [
		"Kura upgrade",
		"",
		"  Project",
		formatRow("Root", plan.root),
		formatRow("Installed", plan.installedVersion ?? "unknown"),
		formatRow("Target", plan.targetVersion),
		formatRow("Status", plan.status),
	];

	if (plan.dependencySpec) {
		lines.push(formatRow("Dependency", plan.dependencySpec));
	}

	if (!mode.checkOnly) {
		lines.push(
			"",
			mode.dryRun ? "  Migration plan (dry run)" : "  Migration plan",
			...formatActionRows(plan.actions),
		);
	}

	const suggestions = plan.actions.filter(
		(action) => action.status === "suggest",
	);
	if (suggestions.length > 0) {
		lines.push("", "  Manual follow-up");
		for (const suggestion of suggestions) {
			lines.push(`  - ${suggestion.message}`);
		}
	}

	if (!mode.checkOnly && !mode.dryRun) {
		lines.push("", "  Next steps", "  bun install", "  bun kura doctor --fix");
	}

	return lines.join("\n");
}

function formatActionRows(actions: readonly UpgradeAction[]): string[] {
	if (actions.length === 0) {
		return ["  No migrations registered."];
	}

	const rows = actions.map((action) => [
		formatActionStatus(action.status),
		action.name,
		action.path ?? "-",
		action.message,
	]);

	return formatTable(["Action", "Migration", "Path", "Message"], rows).map(
		(row) => `  ${row}`,
	);
}

function formatTable(
	headers: readonly string[],
	rows: readonly (readonly string[])[],
): string[] {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
	);
	const formatLine = (row: readonly string[]) =>
		row
			.map((cell, index) => cell.padEnd(widths[index] ?? 0))
			.join("  ")
			.trimEnd();

	return [
		formatLine(headers),
		formatLine(widths.map((width) => "-".repeat(width))),
		...rows.map(formatLine),
	];
}

function formatRow(label: string, value: string): string {
	return `  ${label.padEnd(10)} ${value}`;
}

function formatActionStatus(status: UpgradeActionStatus): string {
	if (status === "apply") {
		return "APPLY";
	}

	if (status === "skip") {
		return "SKIP";
	}

	return "SUGGEST";
}

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { type Command, type ConsoleKernel, defineCommand } from "./Console";
import { isEnabled } from "./new-app/Choices";
import { resolveRoot } from "./new-app/Paths";

export interface PluginConsoleOptions {
	readonly root?: string;
}

export type PluginManifest = {
	readonly name: string;
	readonly description?: string;
	readonly files?: readonly PluginFile[];
	readonly env?: readonly PluginEnvEntry[];
	readonly package?: PluginPackageSetup;
	readonly patches?: readonly PluginTextPatch[];
};

export type PluginFile = {
	readonly path: string;
	readonly content: string;
	readonly mode?: number;
};

export type PluginEnvEntry = {
	readonly file?: string;
	readonly key: string;
	readonly value: string;
};

export type PluginPackageSetup = {
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly devDependencies?: Readonly<Record<string, string>>;
	readonly scripts?: Readonly<Record<string, string>>;
};

export type PluginTextPatch = {
	readonly path: string;
	readonly marker: string;
	readonly content: string;
	readonly position?: "after" | "append" | "before";
};

export type PluginActionStatus = "apply" | "skip" | "suggest";

export type PluginAction = {
	readonly name: string;
	readonly status: PluginActionStatus;
	readonly path?: string;
	readonly message: string;
	apply?(): Promise<void>;
};

export type PluginInstallPlan = {
	readonly root: string;
	readonly manifest: PluginManifest;
	readonly actions: readonly PluginAction[];
};

type WritablePackageJson = Record<string, unknown> & {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

export function createPluginCommands(
	options: PluginConsoleOptions = {},
): readonly Command[] {
	return [createConfigureCommand(options)];
}

export function registerPluginCommands(
	console: ConsoleKernel,
	options: PluginConsoleOptions = {},
): ConsoleKernel {
	for (const command of createPluginCommands(options)) {
		console.register(command);
	}

	return console;
}

export function definePluginManifest(manifest: PluginManifest): PluginManifest {
	validateManifest(manifest);

	return manifest;
}

export async function readPluginManifest(
	path: string,
): Promise<PluginManifest> {
	const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

	if (!isRecord(parsed)) {
		throw new Error("Plugin manifest must be an object");
	}

	return definePluginManifest(readManifest(parsed));
}

export async function planPluginInstall(
	root: string,
	manifest: PluginManifest,
	options: {
		readonly force?: boolean;
	} = {},
): Promise<PluginInstallPlan> {
	const normalized = definePluginManifest(manifest);
	const actions = [
		...(await planFileActions(root, normalized, options.force === true)),
		...(await planEnvActions(root, normalized)),
		...(await planPackageActions(root, normalized)),
		...(await planPatchActions(root, normalized)),
	];

	return {
		root,
		manifest: normalized,
		actions,
	};
}

export async function applyPluginInstall(
	plan: PluginInstallPlan,
): Promise<void> {
	for (const action of plan.actions) {
		if (action.status === "apply") {
			await action.apply?.();
		}
	}
}

export function formatPluginInstallPlan(plan: PluginInstallPlan): string {
	const rows = plan.actions.map((action) => [
		formatStatus(action.status),
		action.name,
		action.path ?? "-",
		action.message,
	]);

	return formatTable(
		`Kura configure ${plan.manifest.name}`,
		["Action", "Step", "Path", "Message"],
		rows,
	);
}

function createConfigureCommand(options: PluginConsoleOptions): Command {
	return defineCommand(
		{
			name: "configure",
			description: "Apply a Kura plugin manifest",
			arguments: [
				{
					name: "manifest",
					required: true,
					description: "Path to a plugin manifest JSON file",
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
					name: "dry-run",
					description: "Print the plan without writing files",
				},
				{
					name: "force",
					alias: "f",
					description: "Overwrite files declared by the plugin manifest",
				},
				{
					name: "json",
					alias: "j",
					description: "Print the plan as JSON",
				},
			],
		},
		async (context) => {
			const root = resolveRoot(options, context.options);
			const manifestPath = resolveManifestPath(root, context.args[0]);
			const manifest = await readPluginManifest(manifestPath);
			const plan = await planPluginInstall(root, manifest, {
				force: isEnabled(context.options, "force"),
			});

			if (isEnabled(context.options, "json")) {
				context.output.write(JSON.stringify(serializePlan(plan), null, "\t"));
			} else {
				context.output.write(formatPluginInstallPlan(plan));
			}

			if (isEnabled(context.options, "dry-run")) {
				context.output.write("Dry run enabled. No files were written.");
				return 0;
			}

			await applyPluginInstall(plan);
			return 0;
		},
	);
}

function resolveManifestPath(root: string, path: string | undefined): string {
	if (!path) {
		throw new Error("Command [configure] requires a manifest path");
	}

	return isAbsolute(path) ? path : resolve(root, path);
}

async function planFileActions(
	root: string,
	manifest: PluginManifest,
	force: boolean,
): Promise<readonly PluginAction[]> {
	const actions: PluginAction[] = [];

	for (const file of manifest.files ?? []) {
		const path = join(root, file.path);
		const exists = await pathExists(path);
		const status = exists ? (force ? "apply" : "skip") : "apply";

		actions.push({
			name: "file",
			status,
			path: file.path,
			message: exists
				? force
					? "overwrite file"
					: "file exists"
				: "create file",
			apply: async () => {
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, file.content, {
					flag: exists && force ? "w" : "wx",
					mode: file.mode,
				});
			},
		});
	}

	return actions;
}

async function planEnvActions(
	root: string,
	manifest: PluginManifest,
): Promise<readonly PluginAction[]> {
	const grouped = groupEnvEntries(manifest.env ?? []);
	const actions: PluginAction[] = [];

	for (const [fileName, entries] of Object.entries(grouped)) {
		const path = join(root, fileName);
		const current = await readOptionalText(path);
		const currentValues = parseEnvText(current);
		const missing = entries.filter(
			(entry) => currentValues[entry.key] === undefined,
		);

		if (missing.length === 0) {
			actions.push({
				name: "env",
				status: "skip",
				path: fileName,
				message: "environment keys already configured",
			});
			continue;
		}

		const next = appendEnvEntries(current ?? "", missing);
		actions.push({
			name: "env",
			status: "apply",
			path: fileName,
			message: `add ${missing.map((entry) => entry.key).join(", ")}`,
			apply: async () => {
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, next);
			},
		});
	}

	return actions;
}

async function planPackageActions(
	root: string,
	manifest: PluginManifest,
): Promise<readonly PluginAction[]> {
	const setup = manifest.package;

	if (!setup) {
		return [];
	}

	const path = join(root, "package.json");
	const packageJson = await readPackageJson(path);

	if (!packageJson) {
		return [
			{
				name: "package",
				status: "suggest",
				path: "package.json",
				message: "package.json is missing or could not be parsed",
			},
		];
	}

	const changes = describePackageChanges(packageJson, setup);

	if (changes.length === 0) {
		return [
			{
				name: "package",
				status: "skip",
				path: "package.json",
				message: "package setup already configured",
			},
		];
	}

	return [
		{
			name: "package",
			status: "apply",
			path: "package.json",
			message: changes.join(", "),
			apply: async () => {
				await patchPackageJson(path, setup);
			},
		},
	];
}

async function planPatchActions(
	root: string,
	manifest: PluginManifest,
): Promise<readonly PluginAction[]> {
	const actions: PluginAction[] = [];

	for (const patch of manifest.patches ?? []) {
		const path = join(root, patch.path);
		const current = await readOptionalText(path);

		if (current === undefined) {
			actions.push({
				name: "patch",
				status: "suggest",
				path: patch.path,
				message: "target file is missing",
			});
			continue;
		}

		if (current.includes(patch.content)) {
			actions.push({
				name: "patch",
				status: "skip",
				path: patch.path,
				message: "patch content already exists",
			});
			continue;
		}

		const next = applyTextPatch(current, patch);
		if (next === current) {
			actions.push({
				name: "patch",
				status: "suggest",
				path: patch.path,
				message: "patch marker was not found",
			});
			continue;
		}

		actions.push({
			name: "patch",
			status: "apply",
			path: patch.path,
			message: "apply text patch",
			apply: async () => {
				await writeFile(path, next);
			},
		});
	}

	return actions;
}

function applyTextPatch(source: string, patch: PluginTextPatch): string {
	if (patch.position === "append") {
		const separator = source.endsWith("\n") ? "" : "\n";
		return `${source}${separator}${patch.content}`;
	}

	const index = source.indexOf(patch.marker);
	if (index === -1) {
		return source;
	}

	if (patch.position === "before") {
		return `${source.slice(0, index)}${patch.content}${source.slice(index)}`;
	}

	const insertionIndex = index + patch.marker.length;
	return `${source.slice(0, insertionIndex)}${patch.content}${source.slice(insertionIndex)}`;
}

function readManifest(value: Record<string, unknown>): PluginManifest {
	const manifest = {
		name: readRequiredString(value, "name"),
		description: readOptionalString(value.description),
		files: readFiles(value.files),
		env: readEnvEntries(value.env),
		package: readPackageSetup(value.package),
		patches: readPatches(value.patches),
	};

	return manifest;
}

function validateManifest(manifest: PluginManifest): void {
	if (!manifest.name.trim()) {
		throw new Error("Plugin manifest name is required");
	}

	const hasSetup =
		(manifest.files?.length ?? 0) > 0 ||
		(manifest.env?.length ?? 0) > 0 ||
		manifest.package !== undefined ||
		(manifest.patches?.length ?? 0) > 0;

	if (!hasSetup) {
		throw new Error("Plugin manifest must declare at least one setup step");
	}

	for (const path of [
		...(manifest.files ?? []).map((file) => file.path),
		...(manifest.env ?? []).map((entry) => entry.file ?? ".env"),
		...(manifest.patches ?? []).map((patch) => patch.path),
	]) {
		assertSafeRelativePath(path);
	}

	assertNoDuplicates(
		(manifest.files ?? []).map((file) => file.path),
		"Duplicate plugin file",
	);
	assertNoDuplicates(
		(manifest.env ?? []).map((entry) => `${entry.file ?? ".env"}:${entry.key}`),
		"Duplicate plugin env key",
	);
	assertNoDuplicates(
		Object.keys(manifest.package?.dependencies ?? {}),
		"Duplicate plugin dependency",
	);
	assertNoDuplicates(
		Object.keys(manifest.package?.devDependencies ?? {}),
		"Duplicate plugin dev dependency",
	);
	assertNoDuplicates(
		Object.keys(manifest.package?.scripts ?? {}),
		"Duplicate plugin script",
	);
}

function assertSafeRelativePath(path: string): void {
	if (isAbsolute(path)) {
		throw new Error(`Plugin path [${path}] must be relative`);
	}

	const normalized = path.replaceAll("\\", "/");
	const segments = normalized.split("/");

	if (
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		)
	) {
		throw new Error(`Plugin path [${path}] is invalid`);
	}
}

function assertNoDuplicates(values: readonly string[], message: string): void {
	const seen = new Set<string>();

	for (const value of values) {
		if (seen.has(value)) {
			throw new Error(`${message} [${value}]`);
		}

		seen.add(value);
	}
}

function readFiles(value: unknown): readonly PluginFile[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!Array.isArray(value)) {
		throw new Error("Plugin manifest files must be an array");
	}

	return value.map((entry) => {
		if (!isRecord(entry)) {
			throw new Error("Plugin file must be an object");
		}

		return {
			path: readRequiredString(entry, "path"),
			content: readRequiredString(entry, "content"),
			mode: readOptionalNumber(entry.mode),
		};
	});
}

function readEnvEntries(value: unknown): readonly PluginEnvEntry[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!Array.isArray(value)) {
		throw new Error("Plugin manifest env must be an array");
	}

	return value.map((entry) => {
		if (!isRecord(entry)) {
			throw new Error("Plugin env entry must be an object");
		}

		return {
			file: readOptionalString(entry.file),
			key: readRequiredString(entry, "key"),
			value: readRequiredString(entry, "value"),
		};
	});
}

function readPackageSetup(value: unknown): PluginPackageSetup | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!isRecord(value)) {
		throw new Error("Plugin package setup must be an object");
	}

	return {
		dependencies: readStringMap(value.dependencies),
		devDependencies: readStringMap(value.devDependencies),
		scripts: readStringMap(value.scripts),
	};
}

function readPatches(value: unknown): readonly PluginTextPatch[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!Array.isArray(value)) {
		throw new Error("Plugin manifest patches must be an array");
	}

	return value.map((entry) => {
		if (!isRecord(entry)) {
			throw new Error("Plugin patch must be an object");
		}

		const position = readOptionalString(entry.position);
		if (
			position !== undefined &&
			position !== "after" &&
			position !== "append" &&
			position !== "before"
		) {
			throw new Error("Plugin patch position must be after, append, or before");
		}

		return {
			path: readRequiredString(entry, "path"),
			marker: readRequiredString(entry, "marker"),
			content: readRequiredString(entry, "content"),
			position,
		};
	});
}

function readRequiredString(
	value: Record<string, unknown>,
	key: string,
): string {
	const candidate = value[key];

	if (typeof candidate !== "string") {
		throw new Error(`Plugin manifest field [${key}] must be a string`);
	}

	return candidate;
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function readStringMap(
	value: unknown,
): Readonly<Record<string, string>> | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!isRecord(value)) {
		throw new Error("Plugin package maps must be objects");
	}

	const output: Record<string, string> = {};

	for (const [key, entryValue] of Object.entries(value)) {
		if (typeof entryValue !== "string") {
			throw new Error(`Plugin package value [${key}] must be a string`);
		}

		output[key] = entryValue;
	}

	return output;
}

function groupEnvEntries(
	entries: readonly PluginEnvEntry[],
): Record<string, readonly PluginEnvEntry[]> {
	const grouped: Record<string, PluginEnvEntry[]> = {};

	for (const entry of entries) {
		const file = entry.file ?? ".env";
		grouped[file] ??= [];
		grouped[file].push(entry);
	}

	return grouped;
}

function appendEnvEntries(
	source: string,
	entries: readonly PluginEnvEntry[],
): string {
	const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";
	const next = entries.map((entry) => `${entry.key}=${entry.value}`).join("\n");

	return `${source}${separator}${next}\n`;
}

function parseEnvText(
	source: string | undefined,
): Readonly<Record<string, string>> {
	if (!source) {
		return {};
	}

	const entries: [string, string][] = [];

	for (const line of source.split("\n")) {
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

function describePackageChanges(
	packageJson: WritablePackageJson,
	setup: PluginPackageSetup,
): readonly string[] {
	const changes: string[] = [];

	for (const [name, version] of Object.entries(setup.dependencies ?? {})) {
		if (packageJson.dependencies?.[name] !== version) {
			changes.push(`dependency ${name}`);
		}
	}

	for (const [name, version] of Object.entries(setup.devDependencies ?? {})) {
		if (packageJson.devDependencies?.[name] !== version) {
			changes.push(`dev dependency ${name}`);
		}
	}

	for (const [name, script] of Object.entries(setup.scripts ?? {})) {
		if (packageJson.scripts?.[name] !== script) {
			changes.push(`script ${name}`);
		}
	}

	return changes;
}

async function patchPackageJson(
	path: string,
	setup: PluginPackageSetup,
): Promise<void> {
	const packageJson = await readPackageJson(path);

	if (!packageJson) {
		throw new Error("package.json is missing or could not be parsed");
	}

	const next: WritablePackageJson = {
		...packageJson,
		dependencies:
			setup.dependencies === undefined
				? packageJson.dependencies
				: sortRecord({
						...readStringRecord(packageJson.dependencies),
						...setup.dependencies,
					}),
		devDependencies:
			setup.devDependencies === undefined
				? packageJson.devDependencies
				: sortRecord({
						...readStringRecord(packageJson.devDependencies),
						...setup.devDependencies,
					}),
		scripts:
			setup.scripts === undefined
				? packageJson.scripts
				: sortRecord({
						...readStringRecord(packageJson.scripts),
						...setup.scripts,
					}),
	};

	await writeFile(path, `${JSON.stringify(next, null, "\t")}\n`);
}

async function readPackageJson(
	path: string,
): Promise<WritablePackageJson | undefined> {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
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

function readStringRecord(value: unknown): Readonly<Record<string, string>> {
	if (!isRecord(value)) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function sortRecord(
	record: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
	);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function serializePlan(plan: PluginInstallPlan): Record<string, unknown> {
	return {
		root: plan.root,
		manifest: {
			name: plan.manifest.name,
			description: plan.manifest.description,
		},
		actions: plan.actions.map((action) => ({
			name: action.name,
			status: action.status,
			path: action.path,
			message: action.message,
		})),
	};
}

function formatStatus(status: PluginActionStatus): string {
	if (status === "apply") {
		return "APPLY";
	}

	if (status === "skip") {
		return "SKIP";
	}

	return "SUGGEST";
}

function formatTable(
	title: string,
	headers: readonly string[],
	rows: readonly (readonly string[])[],
): string {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
	);
	const formatLine = (row: readonly string[]) =>
		`  ${row
			.map((cell, index) => cell.padEnd(widths[index] ?? 0))
			.join("  ")
			.trimEnd()}`;

	return [
		title,
		"",
		formatLine(headers),
		formatLine(widths.map((width) => "-".repeat(width))),
		...rows.map(formatLine),
	].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

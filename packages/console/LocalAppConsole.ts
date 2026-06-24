import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface LocalAppConsole {
	readonly root: string;
	readonly entry: string;
}

export interface LocalAppConsoleRuntime {
	readonly cwd?: string;
	readonly bunPath?: string;
	readonly spawn?: typeof Bun.spawn;
}

export async function runLocalAppConsole(
	argv: readonly string[],
	runtime: LocalAppConsoleRuntime = {},
): Promise<number | undefined> {
	if (shouldRunGlobalCli(argv)) {
		return undefined;
	}

	const localConsole = findLocalAppConsole(runtime.cwd ?? process.cwd());

	if (!localConsole) {
		return undefined;
	}

	const subprocess = (runtime.spawn ?? Bun.spawn)({
		cmd: [runtime.bunPath ?? process.execPath, localConsole.entry, ...argv],
		cwd: localConsole.root,
		env: Bun.env,
		stderr: "inherit",
		stdin: "inherit",
		stdout: "inherit",
	});

	return await subprocess.exited;
}

export function findLocalAppConsole(cwd: string): LocalAppConsole | undefined {
	let current = resolve(cwd);

	while (true) {
		const entry = join(current, "bin", "console.ts");
		const manifest = join(current, "package.json");

		if (isFile(entry) && isFile(manifest) && isKuraAppManifest(manifest)) {
			return { root: current, entry };
		}

		const parent = dirname(current);

		if (parent === current) {
			return undefined;
		}

		current = parent;
	}
}

function shouldRunGlobalCli(argv: readonly string[]): boolean {
	const command = argv[0];

	if (command === "new" || command === "upgrade") {
		return true;
	}

	return command === "help" && (argv[1] === "new" || argv[1] === "upgrade");
}

function isKuraAppManifest(path: string): boolean {
	const manifest = readPackageManifest(path);

	if (!manifest) {
		return false;
	}

	const scripts = readStringRecord(manifest, "scripts");
	const dependencies = {
		...readStringRecord(manifest, "dependencies"),
		...readStringRecord(manifest, "devDependencies"),
		...readStringRecord(manifest, "peerDependencies"),
		...readStringRecord(manifest, "optionalDependencies"),
	};

	return (
		dependencies.kura !== undefined ||
		dependencies["@akuseru_w/kura"] !== undefined ||
		scripts?.kura?.includes("bin/console.ts") === true
	);
}

function readPackageManifest(
	path: string,
): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));

		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function readStringRecord(
	value: Record<string, unknown>,
	key: string,
): Record<string, string> | undefined {
	const candidate = value[key];

	if (!isRecord(candidate)) {
		return undefined;
	}

	const output: Record<string, string> = {};

	for (const [entryKey, entryValue] of Object.entries(candidate)) {
		if (typeof entryValue !== "string") {
			return undefined;
		}

		output[entryKey] = entryValue;
	}

	return output;
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return existsSync(path);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type KuraBenchmarkApp, resolveBenchmarkApps } from "./Matrix";

type ScaffoldOptions = {
	readonly apps: readonly string[];
	readonly buildApps: boolean;
	readonly buildRuntime: boolean;
	readonly install: boolean;
};

const root = process.cwd();
const appsRoot = join(root, "benchmarks/apps");
const options = readOptions(Bun.argv.slice(2));
const selectedApps = resolveBenchmarkApps(options.apps).filter(
	(app): app is KuraBenchmarkApp => app.kind === "kura",
);

if (selectedApps.length === 0) {
	throw new Error("No Kura benchmark apps selected");
}

if (options.buildRuntime) {
	run("Building Kura runtime", [process.execPath, "run", "build"], root);
}

await mkdir(appsRoot, { recursive: true });

for (const app of selectedApps) {
	const appRoot = join(appsRoot, app.name);
	await rm(appRoot, { force: true, recursive: true });

	run(
		`Scaffolding ${app.name}`,
		[
			process.execPath,
			"dist/bin/kura.js",
			"new",
			app.name,
			"--yes",
			"--preset",
			app.preset,
			"--architecture",
			app.architecture,
			"--root",
			appsRoot,
		],
		root,
	);

	if (options.install) {
		run(`Installing ${app.name}`, [process.execPath, "install"], appRoot);
	}

	if (options.buildApps) {
		run(`Building ${app.name}`, [process.execPath, "run", "build"], appRoot);
	}
}

console.log("");
console.log(
	`Generated ${selectedApps.length} benchmark app(s) in benchmarks/apps`,
);
console.log("Run benchmarks with:");
console.log("  bun run bench:run -- --tools bun");

function readOptions(args: readonly string[]): ScaffoldOptions {
	return {
		apps: readListOption(args, "--apps"),
		buildApps: !hasFlag(args, "--no-build-apps"),
		buildRuntime: !hasFlag(args, "--no-build-runtime"),
		install: !hasFlag(args, "--no-install"),
	};
}

function readListOption(
	args: readonly string[],
	name: string,
): readonly string[] {
	const value = readStringOption(args, name);

	return value === undefined
		? []
		: value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
}

function readStringOption(
	args: readonly string[],
	name: string,
): string | undefined {
	const equalsPrefix = `${name}=`;
	const equalsValue = args.find((arg) => arg.startsWith(equalsPrefix));
	if (equalsValue !== undefined) {
		return equalsValue.slice(equalsPrefix.length);
	}

	const index = args.indexOf(name);
	if (index >= 0) {
		return args[index + 1];
	}

	return undefined;
}

function hasFlag(args: readonly string[], name: string): boolean {
	return args.includes(name);
}

function run(label: string, cmd: readonly string[], cwd: string): void {
	console.log(`\n${label}`);
	const result = Bun.spawnSync({
		cmd: [...cmd],
		cwd,
		stderr: "inherit",
		stdout: "inherit",
	});

	if (result.exitCode !== 0) {
		throw new Error(`${label} failed with exit code ${result.exitCode}`);
	}
}

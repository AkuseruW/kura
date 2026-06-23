import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type BuildTarget = {
	readonly entrypoint: string;
	readonly outdir: string;
};

type ExportTarget = {
	readonly path: string;
	readonly source: string;
	readonly output: string;
};

const runtimeExports: readonly ExportTarget[] = [
	{ path: ".", source: "index.ts", output: "index" },
	{ path: "./auth", source: "auth.ts", output: "auth" },
	{ path: "./cache", source: "cache.ts", output: "cache" },
	{ path: "./client", source: "client.ts", output: "client" },
	{ path: "./config", source: "config.ts", output: "config" },
	{ path: "./container", source: "container.ts", output: "container" },
	{ path: "./console", source: "console.ts", output: "console" },
	{ path: "./core", source: "core.ts", output: "core" },
	{ path: "./database", source: "database.ts", output: "database" },
	{ path: "./env", source: "env.ts", output: "env" },
	{ path: "./events", source: "events.ts", output: "events" },
	{ path: "./hash", source: "hash.ts", output: "hash" },
	{ path: "./http", source: "http.ts", output: "http" },
	{ path: "./openapi", source: "openapi.ts", output: "openapi" },
	{ path: "./queue", source: "queue.ts", output: "queue" },
	{
		path: "./queue/redis",
		source: "queue/redis.ts",
		output: "queue/redis",
	},
	{
		path: "./queue/sqlite",
		source: "queue/sqlite.ts",
		output: "queue/sqlite",
	},
	{ path: "./testing", source: "testing.ts", output: "testing" },
	{ path: "./validation", source: "validation.ts", output: "validation" },
	{ path: "./view", source: "view.ts", output: "view" },
];

const targets: readonly BuildTarget[] = [
	...runtimeExports.map((target) => ({
		entrypoint: target.source,
		outdir: target.output.includes("/")
			? `dist/${dirname(target.output)}`
			: "dist",
	})),
	{ entrypoint: "bin/kura.ts", outdir: "dist/bin" },
	{
		entrypoint: "packages/create-kura-app/index.ts",
		outdir: "packages/create-kura-app/dist",
	},
];

await rm("dist", { force: true, recursive: true });
await rm("packages/create-kura-app/dist", { force: true, recursive: true });

for (const target of targets) {
	await buildTarget(target);
}

await emitDeclarations();
await emitDistPackageManifest();
await chmod("dist/bin/kura.js", 0o755);
await chmod("packages/create-kura-app/dist/index.js", 0o755);

async function buildTarget(target: BuildTarget): Promise<void> {
	const result = await Bun.build({
		entrypoints: [target.entrypoint],
		format: "esm",
		minify: true,
		outdir: target.outdir,
		packages: "external",
		sourcemap: "external",
		target: "bun",
	});

	if (!result.success) {
		for (const log of result.logs) {
			console.error(log.message);
		}

		throw new Error(`Build failed for [${target.entrypoint}]`);
	}
}

async function emitDeclarations(): Promise<void> {
	const result = Bun.spawnSync({
		cmd: [process.execPath, "x", "tsc", "--project", "tsconfig.build.json"],
		stderr: "inherit",
		stdout: "inherit",
	});

	if (result.exitCode !== 0) {
		throw new Error("Declaration build failed");
	}
}

type RuntimePackageManifest = {
	readonly bugs?: unknown;
	readonly description?: string;
	readonly engines?: Record<string, string>;
	readonly homepage?: string;
	readonly keywords?: readonly string[];
	readonly license?: string;
	readonly name: string;
	readonly peerDependencies?: Record<string, string>;
	readonly peerDependenciesMeta?: Record<string, unknown>;
	readonly repository?: unknown;
	readonly version: string;
};

async function emitDistPackageManifest(): Promise<void> {
	const packageJson = JSON.parse(
		await readFile("package.json", "utf8"),
	) as RuntimePackageManifest;
	const manifest = {
		name: packageJson.name,
		version: packageJson.version,
		description: packageJson.description,
		keywords: packageJson.keywords,
		homepage: packageJson.homepage,
		bugs: packageJson.bugs,
		repository: packageJson.repository,
		license: packageJson.license,
		type: "module",
		main: "./index.js",
		module: "./index.js",
		types: "./index.d.ts",
		bin: {
			kura: "./bin/kura.js",
		},
		exports: createDistExports(),
		engines: packageJson.engines,
		peerDependencies: packageJson.peerDependencies,
		peerDependenciesMeta: packageJson.peerDependenciesMeta,
	};

	await writeFile(
		"dist/package.json",
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
}

function createDistExports(): Record<string, unknown> {
	return {
		...Object.fromEntries(
			runtimeExports.map((target) => [
				target.path,
				{
					types: `./${target.output}.d.ts`,
					import: `./${target.output}.js`,
					default: `./${target.output}.js`,
				},
			]),
		),
		"./package.json": "./package.json",
	};
}

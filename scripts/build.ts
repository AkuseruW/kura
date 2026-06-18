import { chmod, readFile, rm, writeFile } from "node:fs/promises";

type BuildTarget = {
	readonly entrypoint: string;
	readonly outdir: string;
};

const targets: readonly BuildTarget[] = [
	{ entrypoint: "index.ts", outdir: "dist" },
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
		exports: {
			".": {
				types: "./index.d.ts",
				import: "./index.js",
				default: "./index.js",
			},
			"./package.json": "./package.json",
		},
		engines: packageJson.engines,
		peerDependencies: packageJson.peerDependencies,
		peerDependenciesMeta: packageJson.peerDependenciesMeta,
	};

	await writeFile(
		"dist/package.json",
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
}

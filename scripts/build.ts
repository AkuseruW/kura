import { chmod, rm } from "node:fs/promises";

type BuildTarget = {
	readonly entrypoint: string;
	readonly outdir: string;
};

const targets: readonly BuildTarget[] = [
	{ entrypoint: "index.ts", outdir: "dist" },
	{ entrypoint: "bin/kura.ts", outdir: "dist/bin" },
	{
		entrypoint: "packages/create-kurajs/index.ts",
		outdir: "packages/create-kurajs/dist",
	},
];

await rm("dist", { force: true, recursive: true });
await rm("packages/create-kurajs/dist", { force: true, recursive: true });

for (const target of targets) {
	await buildTarget(target);
}

await emitDeclarations();
await chmod("dist/bin/kura.js", 0o755);
await chmod("packages/create-kurajs/dist/index.js", 0o755);

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

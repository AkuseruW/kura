import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NewAppFile, PackageManager } from "./Types";

export async function writeNewApp(
	targetPath: string,
	files: readonly NewAppFile[],
	force: boolean,
): Promise<void> {
	const exists = await pathExists(targetPath);

	if (exists && !force) {
		throw new Error(
			`Directory [${targetPath}] already exists. Use --force to write into it.`,
		);
	}

	await mkdir(targetPath, { recursive: true });

	for (const file of files) {
		const path = join(targetPath, file.path);

		if (file.kind === "directory") {
			await mkdir(path, { recursive: true });
			continue;
		}

		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, file.content, {
			flag: force ? "w" : "wx",
			mode: file.mode,
		});
	}
}

export async function installDependencies(options: {
	readonly cwd: string;
	readonly packageManager: PackageManager;
}): Promise<void> {
	const result = Bun.spawnSync({
		cmd: [options.packageManager, "install"],
		cwd: options.cwd,
		stderr: "inherit",
		stdout: "inherit",
	});

	if (result.exitCode !== 0) {
		throw new Error("Dependency installation failed");
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

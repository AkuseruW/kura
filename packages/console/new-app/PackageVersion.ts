import { access, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function resolveDefaultPackageVersion(
	targetPath: string,
): Promise<string> {
	const localRoot = await findLocalKuraRoot();

	if (localRoot === undefined) {
		return "latest";
	}

	const dependencyPath = normalizeDependencyPath(
		relative(
			await resolveFutureRealPath(targetPath),
			await resolveFutureRealPath(localRoot),
		),
	);

	return `file:${dependencyPath}`;
}

async function findLocalKuraRoot(): Promise<string | undefined> {
	const sourcePath = fileURLToPath(import.meta.url);
	const candidates = [
		process.cwd(),
		dirname(sourcePath),
		resolve(dirname(sourcePath), ".."),
		resolve(dirname(sourcePath), "../.."),
		resolve(dirname(sourcePath), "../../.."),
	];
	const seen = new Set<string>();

	for (const candidate of candidates) {
		const root = resolve(candidate);

		if (seen.has(root)) {
			continue;
		}

		seen.add(root);

		if (await isKuraPackageRoot(root)) {
			return root;
		}
	}

	return undefined;
}

async function isKuraPackageRoot(path: string): Promise<boolean> {
	try {
		const packageJson = JSON.parse(
			await readFile(join(path, "package.json"), "utf8"),
		) as { readonly name?: string };

		if (packageJson.name !== "kurajs") {
			return false;
		}

		return (
			(await pathExists(join(path, "index.ts"))) &&
			(await pathExists(join(path, "packages/core/Container.ts")))
		);
	} catch {
		return false;
	}
}

function normalizeDependencyPath(path: string): string {
	const normalized = (path || ".").replaceAll("\\", "/");

	if (normalized === "." || normalized.startsWith(".")) {
		return normalized;
	}

	return `./${normalized}`;
}

async function resolveFutureRealPath(path: string): Promise<string> {
	const segments: string[] = [];
	let current = resolve(path);

	while (!(await pathExists(current))) {
		const parent = dirname(current);

		if (parent === current) {
			break;
		}

		segments.unshift(basename(current));
		current = parent;
	}

	return resolve(await realpath(current), ...segments);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

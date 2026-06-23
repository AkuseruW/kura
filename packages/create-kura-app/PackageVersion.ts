import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const createPackageName = "create-kura-app";
const runtimePackageName = "@akuseru_w/kura";

export async function resolveBundledRuntimePackageVersion(
	sourceUrl: string = import.meta.url,
): Promise<string> {
	const version = await readCreatePackageVersion(sourceUrl);

	if (!version) {
		throw new Error(
			"Unable to resolve create-kura-app package version for the generated runtime dependency.",
		);
	}

	return `npm:${runtimePackageName}@${version}`;
}

async function readCreatePackageVersion(
	sourceUrl: string,
): Promise<string | undefined> {
	const sourceDirectory = dirname(fileURLToPath(sourceUrl));
	const candidates = [sourceDirectory, resolve(sourceDirectory, "..")];

	for (const candidate of candidates) {
		const version = await readVersionFromPackageJson(candidate);

		if (version) {
			return version;
		}
	}

	return undefined;
}

async function readVersionFromPackageJson(
	directory: string,
): Promise<string | undefined> {
	try {
		const packageJson = JSON.parse(
			await readFile(resolve(directory, "package.json"), "utf8"),
		) as { readonly name?: string; readonly version?: string };

		if (
			packageJson.name === createPackageName &&
			typeof packageJson.version === "string"
		) {
			return packageJson.version;
		}
	} catch {
		return undefined;
	}

	return undefined;
}

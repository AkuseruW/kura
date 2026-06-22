import { readFile } from "node:fs/promises";

type PackageJson = {
	readonly name: string;
	readonly version: string;
};

const tagName = Bun.env.GITHUB_REF_NAME ?? Bun.argv[2];

if (!tagName) {
	throw new Error(
		"Missing release tag. Expected GITHUB_REF_NAME or an argument.",
	);
}

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tagName)) {
	throw new Error(
		`Release tag [${tagName}] is invalid. Expected a semver tag like v0.1.5.`,
	);
}

const releaseVersion = tagName.slice(1);
const runtimePackage = await readPackageJson("package.json");
const creatorPackage = await readPackageJson(
	"packages/create-kura-app/package.json",
);

assertPackage(runtimePackage, "@akuseru_w/kura", releaseVersion);
assertPackage(creatorPackage, "create-kura-app", releaseVersion);

console.log(`Release tag ${tagName} matches npm package versions.`);

async function readPackageJson(path: string): Promise<PackageJson> {
	const contents = await readFile(path, "utf8");
	const parsed = JSON.parse(contents) as Partial<PackageJson>;

	if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
		throw new Error(`Package manifest [${path}] is missing name or version.`);
	}

	return {
		name: parsed.name,
		version: parsed.version,
	};
}

function assertPackage(
	packageJson: PackageJson,
	expectedName: string,
	expectedVersion: string,
): void {
	if (packageJson.name !== expectedName) {
		throw new Error(
			`Package name [${packageJson.name}] does not match [${expectedName}].`,
		);
	}

	if (packageJson.version !== expectedVersion) {
		throw new Error(
			`Package [${packageJson.name}] version [${packageJson.version}] does not match tag [v${expectedVersion}].`,
		);
	}
}

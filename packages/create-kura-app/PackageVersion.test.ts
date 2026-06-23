import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveBundledRuntimePackageVersion } from "./PackageVersion";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true })),
	);
});

describe("create-kura-app package version", () => {
	test("uses the create package version as the runtime dependency version", async () => {
		expect(await resolveBundledRuntimePackageVersion()).toBe(
			"npm:@akuseru_w/kura@0.1.12",
		);
	});

	test("resolves from a bundled dist entry next to the package manifest", async () => {
		const root = await mkdtemp(join(tmpdir(), "kura-create-version-"));
		tempRoots.push(root);
		await mkdir(join(root, "dist"), { recursive: true });
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ name: "create-kura-app", version: "9.8.7" }),
		);

		expect(
			await resolveBundledRuntimePackageVersion(
				pathToFileURL(resolve(root, "dist/index.js")).href,
			),
		).toBe("npm:@akuseru_w/kura@9.8.7");
	});

	test("fails clearly when the create package manifest cannot be resolved", async () => {
		const root = await mkdtemp(join(tmpdir(), "kura-create-version-missing-"));
		tempRoots.push(root);

		await expect(
			resolveBundledRuntimePackageVersion(
				pathToFileURL(join(root, "index.js")).href,
			),
		).rejects.toThrow(
			"Unable to resolve create-kura-app package version for the generated runtime dependency.",
		);
	});
});

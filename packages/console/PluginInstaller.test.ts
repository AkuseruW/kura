import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleKernel, MemoryConsoleOutput } from "./Console";
import {
	applyPluginInstall,
	definePluginManifest,
	planPluginInstall,
	readPluginManifest,
	registerPluginCommands,
} from "./PluginInstaller";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { force: true, recursive: true });
	}
});

describe("plugin installer", () => {
	test("registers the configure command", () => {
		const console = new ConsoleKernel();

		registerPluginCommands(console);

		expect(console.find("configure")).toBeDefined();
	});

	test("validates plugin manifests", () => {
		expect(() =>
			definePluginManifest({
				name: "bad",
				files: [
					{
						path: "../outside.ts",
						content: "export {};\n",
					},
				],
			}),
		).toThrow("invalid");

		expect(() =>
			definePluginManifest({
				name: "bad",
				files: [
					{
						path: "config/plugin.ts",
						content: "export {};\n",
					},
					{
						path: "config/plugin.ts",
						content: "export {};\n",
					},
				],
			}),
		).toThrow("Duplicate plugin file");
	});

	test("reads a plugin manifest from json", async () => {
		const root = await makeRoot();
		await writeFile(
			join(root, "plugin.json"),
			JSON.stringify({
				name: "demo",
				description: "Demo plugin",
				files: [{ path: "config/demo.ts", content: "export default {};\n" }],
			}),
		);

		const manifest = await readPluginManifest(join(root, "plugin.json"));

		expect(manifest.name).toBe("demo");
		expect(manifest.description).toBe("Demo plugin");
		expect(manifest.files?.[0]?.path).toBe("config/demo.ts");
	});

	test("plans and applies files, env, package changes, and text patches", async () => {
		const root = await makeGeneratedApp();
		const manifest = definePluginManifest({
			name: "fixture",
			files: [
				{
					path: "app/services/fixture_service.ts",
					content: "export class FixtureService {}\n",
				},
			],
			env: [
				{ key: "FIXTURE_ENABLED", value: "true" },
				{ file: ".env.example", key: "FIXTURE_ENABLED", value: "true" },
				{ file: "storage/plugin/.env", key: "FIXTURE_PATH", value: "yes" },
			],
			package: {
				dependencies: {
					"fixture-runtime": "^1.0.0",
				},
				scripts: {
					fixture: "bun fixture.ts",
				},
			},
			patches: [
				{
					path: "start/routes.ts",
					marker: "export const router = new Router();",
					content:
						'\nrouter.get("/fixture", () => Response.json({ ok: true }));\n',
					position: "after",
				},
			],
		});

		const plan = await planPluginInstall(root, manifest);

		expect(plan.actions.map((action) => action.status)).toEqual([
			"apply",
			"apply",
			"apply",
			"apply",
			"apply",
			"apply",
		]);
		await applyPluginInstall(plan);

		expect(
			await readFile(join(root, "app/services/fixture_service.ts"), "utf8"),
		).toContain("FixtureService");
		expect(await readFile(join(root, ".env"), "utf8")).toContain(
			"FIXTURE_ENABLED=true",
		);
		expect(await readFile(join(root, ".env.example"), "utf8")).toContain(
			"FIXTURE_ENABLED=true",
		);
		expect(await readFile(join(root, "storage/plugin/.env"), "utf8")).toContain(
			"FIXTURE_PATH=yes",
		);
		const packageJson = JSON.parse(
			await readFile(join(root, "package.json"), "utf8"),
		) as {
			readonly dependencies: Record<string, string>;
			readonly scripts: Record<string, string>;
		};
		expect(packageJson.dependencies["fixture-runtime"]).toBe("^1.0.0");
		expect(packageJson.scripts.fixture).toBe("bun fixture.ts");
		expect(await readFile(join(root, "start/routes.ts"), "utf8")).toContain(
			"/fixture",
		);
	});

	test("is idempotent unless force is enabled", async () => {
		const root = await makeGeneratedApp();
		const manifest = definePluginManifest({
			name: "fixture",
			files: [
				{
					path: "config/fixture.ts",
					content: "export default { enabled: true };\n",
				},
			],
			env: [{ key: "FIXTURE_ENABLED", value: "true" }],
		});

		await applyPluginInstall(await planPluginInstall(root, manifest));
		await writeFile(join(root, "config/fixture.ts"), "// user change\n");

		const secondPlan = await planPluginInstall(root, manifest);
		expect(secondPlan.actions.map((action) => action.status)).toEqual([
			"skip",
			"skip",
		]);
		await applyPluginInstall(secondPlan);
		expect(await readFile(join(root, "config/fixture.ts"), "utf8")).toBe(
			"// user change\n",
		);

		const forcePlan = await planPluginInstall(root, manifest, { force: true });
		expect(forcePlan.actions[0]?.status).toBe("apply");
		await applyPluginInstall(forcePlan);
		expect(await readFile(join(root, "config/fixture.ts"), "utf8")).toContain(
			"enabled: true",
		);
	});

	test("applies fixture plugins through the configure command", async () => {
		const root = await makeGeneratedApp();
		await writeFile(
			join(root, "fixture-plugin.json"),
			JSON.stringify({
				name: "fixture",
				files: [
					{
						path: "config/fixture.ts",
						content: "export default { enabled: true };\n",
					},
				],
				env: [{ key: "FIXTURE_ENABLED", value: "true" }],
			}),
		);
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerPluginCommands(console, { root });

		expect(await console.run(["configure", "fixture-plugin.json"])).toBe(0);

		expect(output.text()).toContain("Kura configure fixture");
		expect(output.text()).toContain("APPLY");
		expect(await readFile(join(root, "config/fixture.ts"), "utf8")).toContain(
			"enabled: true",
		);
		expect(await readFile(join(root, ".env"), "utf8")).toContain(
			"FIXTURE_ENABLED=true",
		);
	});

	test("prints dry-run plans without writing files", async () => {
		const root = await makeGeneratedApp();
		await writeFile(
			join(root, "fixture-plugin.json"),
			JSON.stringify({
				name: "fixture",
				files: [
					{
						path: "config/fixture.ts",
						content: "export default { enabled: true };\n",
					},
				],
			}),
		);
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerPluginCommands(console, { root });

		expect(
			await console.run(["configure", "fixture-plugin.json", "--dry-run"]),
		).toBe(0);

		expect(output.text()).toContain("Dry run enabled");
		await expect(
			readFile(join(root, "config/fixture.ts"), "utf8"),
		).rejects.toThrow();
	});
});

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-plugin-"));
	roots.push(root);
	return root;
}

async function makeGeneratedApp(): Promise<string> {
	const root = await makeRoot();
	await mkdir(join(root, "app/services"), { recursive: true });
	await mkdir(join(root, "start"), { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify(
			{
				name: "demo",
				type: "module",
				dependencies: {
					kura: "npm:@akuseru_w/kura@0.1.0",
				},
				scripts: {
					kura: "bun bin/console.ts",
				},
			},
			null,
			"\t",
		),
	);
	await writeFile(join(root, ".env"), "APP_KEY=local-development-key\n");
	await writeFile(
		join(root, ".env.example"),
		"APP_KEY=local-development-key\n",
	);
	await writeFile(
		join(root, "start/routes.ts"),
		[
			'import { Router } from "kura";',
			"",
			"export const router = new Router();",
			"",
		].join("\n"),
	);

	return root;
}

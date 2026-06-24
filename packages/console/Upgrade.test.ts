import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleKernel, MemoryConsoleOutput } from "./Console";
import { registerUpgradeCommands } from "./Upgrade";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { force: true, recursive: true });
	}
});

describe("upgrade console commands", () => {
	test("registers the upgrade command", () => {
		const console = new ConsoleKernel();

		registerUpgradeCommands(console);

		expect(console.find("upgrade")).toBeDefined();
	});

	test("checks whether an app is behind", async () => {
		const root = await makeAppRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerUpgradeCommands(console, { root, runtimeVersion: "0.1.14" });

		expect(await console.run(["upgrade", "--check", "--from", "0.1.0"])).toBe(
			0,
		);

		expect(output.text()).toContain("Kura upgrade");
		expect(output.text()).toContain("Installed  0.1.0");
		expect(output.text()).toContain("Target     0.1.14");
		expect(output.text()).toContain("Status     behind");
		expect(output.text()).not.toContain("Migration plan");
	});

	test("prints migration plans without writing during dry runs", async () => {
		const root = await makeAppRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerUpgradeCommands(console, { root, runtimeVersion: "0.1.14" });

		expect(await console.run(["upgrade", "--dry-run", "--from", "0.1.0"])).toBe(
			0,
		);

		expect(output.text()).toContain("Migration plan (dry run)");
		expect(output.text()).toContain("dependency:kura");
		expect(output.text()).toContain("package:scripts");
		expect(output.text()).toContain("console:upgrade");
		expect(await readFile(join(root, "package.json"), "utf8")).toContain(
			"npm:@akuseru_w/kura@0.1.0",
		);
		expect(await readFile(join(root, "bin/console.ts"), "utf8")).not.toContain(
			"registerUpgradeCommands",
		);
	});

	test("applies safe generated app migrations", async () => {
		const root = await makeAppRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerUpgradeCommands(console, { root, runtimeVersion: "0.1.14" });

		expect(await console.run(["upgrade", "--from", "0.1.0"])).toBe(0);

		const packageJson = JSON.parse(
			await readFile(join(root, "package.json"), "utf8"),
		) as {
			readonly dependencies: Record<string, string>;
			readonly scripts: Record<string, string>;
		};
		expect(packageJson.dependencies.kura).toBe("npm:@akuseru_w/kura@0.1.14");
		expect(packageJson.scripts.upgrade).toBe("bun bin/console.ts upgrade");
		const consoleEntrypoint = await readFile(
			join(root, "bin/console.ts"),
			"utf8",
		);
		expect(consoleEntrypoint).toContain("registerUpgradeCommands");
		expect(consoleEntrypoint).toContain("registerUpgradeCommands(appConsole");
		expect(output.text()).toContain("Next steps");
		expect(output.text()).toContain("bun install");
	});

	test("keeps local runtime dependencies as manual follow-up", async () => {
		const root = await makeAppRoot({
			dependency: "file:../kura/dist",
			withUpgradeCommand: true,
			withUpgradeScript: true,
		});
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerUpgradeCommands(console, { root, runtimeVersion: "0.1.14" });

		expect(await console.run(["upgrade", "--dry-run"])).toBe(0);

		expect(output.text()).toContain("SUGGEST");
		expect(output.text()).toContain("local runtime dependency detected");
		expect(await readFile(join(root, "package.json"), "utf8")).toContain(
			"file:../kura/dist",
		);
	});
});

async function makeAppRoot(
	options: {
		readonly dependency?: string;
		readonly withUpgradeCommand?: boolean;
		readonly withUpgradeScript?: boolean;
	} = {},
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-upgrade-"));
	roots.push(root);
	await mkdir(join(root, "bin"), { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify(
			{
				name: "demo",
				type: "module",
				scripts: {
					kura: "bun bin/console.ts",
					...(options.withUpgradeScript
						? { upgrade: "bun bin/console.ts upgrade" }
						: {}),
				},
				dependencies: {
					kura: options.dependency ?? "npm:@akuseru_w/kura@0.1.0",
				},
			},
			null,
			"\t",
		),
	);
	await writeFile(join(root, "bin/console.ts"), makeConsoleEntrypoint(options));

	return root;
}

function makeConsoleEntrypoint(options: {
	readonly withUpgradeCommand?: boolean;
}): string {
	const upgradeImport = options.withUpgradeCommand
		? "\tregisterUpgradeCommands,\n"
		: "";
	const upgradeRegistration = options.withUpgradeCommand
		? "registerUpgradeCommands(appConsole, {\n\troot: process.cwd(),\n});\n"
		: "";

	return `import {
\tcreateConsole,
\tregisterFeatureCommands,
\tregisterGeneratorCommands,
${upgradeImport}} from "kura/console";

const appConsole = createConsole();

registerGeneratorCommands(appConsole, {
\tarchitecture: "standard",
});
registerFeatureCommands(appConsole, {
\troot: process.cwd(),
});
${upgradeRegistration}const exitCode = await appConsole.run(Bun.argv.slice(2));
process.exit(exitCode);
`;
}

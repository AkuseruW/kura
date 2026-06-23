import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleKernel, MemoryConsoleOutput } from "./Console";
import { registerFeatureCommands } from "./FeatureInstaller";
import { registerNewAppCommand } from "./NewApp";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { force: true, recursive: true });
	}
});

describe("feature installer console commands", () => {
	test("registers the add command", () => {
		const console = new ConsoleKernel();

		registerFeatureCommands(console);

		expect(console.find("add")).toBeDefined();
	});

	test("adds database files to an existing app", async () => {
		const appRoot = await makeGeneratedApp();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerFeatureCommands(console, { root: appRoot });

		expect(await console.run(["add", "database", "--database", "sqlite"])).toBe(
			0,
		);

		expect(output.text()).toContain("Kura add");
		expect(output.text()).toContain("create    config/database.ts");
		expect(await fileExists(join(appRoot, "config/database.ts"))).toBe(true);
		expect(await fileExists(join(appRoot, "database/connection.ts"))).toBe(
			true,
		);
		expect(await fileExists(join(appRoot, "database/migrations.ts"))).toBe(
			true,
		);
		expect(await readFile(join(appRoot, "config/app.ts"), "utf8")).toContain(
			'database: "sqlite"',
		);
		expect(await readFile(join(appRoot, "start/env.ts"), "utf8")).toContain(
			"DB_CONNECTION",
		);
		expect(await readFile(join(appRoot, "bin/console.ts"), "utf8")).toContain(
			"registerDatabaseCommands",
		);
	});

	test("is idempotent unless force is enabled", async () => {
		const appRoot = await makeGeneratedApp();
		const console = new ConsoleKernel(new MemoryConsoleOutput());
		registerFeatureCommands(console, { root: appRoot });

		expect(await console.run(["add", "database"])).toBe(0);
		await writeFile(join(appRoot, "config/database.ts"), "// changed\n");

		const skipOutput = new MemoryConsoleOutput();
		const skipConsole = new ConsoleKernel(skipOutput);
		registerFeatureCommands(skipConsole, { root: appRoot });
		expect(await skipConsole.run(["add", "database"])).toBe(0);
		expect(skipOutput.text()).toContain("skip      config/database.ts");
		expect(await readFile(join(appRoot, "config/database.ts"), "utf8")).toBe(
			"// changed\n",
		);

		const forceOutput = new MemoryConsoleOutput();
		const forceConsole = new ConsoleKernel(forceOutput);
		registerFeatureCommands(forceConsole, { root: appRoot });
		expect(await forceConsole.run(["add", "database", "--force"])).toBe(0);
		expect(forceOutput.text()).toContain("overwrite config/database.ts");
		expect(
			await readFile(join(appRoot, "config/database.ts"), "utf8"),
		).toContain("Database configuration");
	});

	test("adds auth routes, schemas, migrations, and starter metadata", async () => {
		const appRoot = await makeGeneratedApp();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerFeatureCommands(console, { root: appRoot });

		expect(await console.run(["add", "auth", "--auth", "access-token"])).toBe(
			0,
		);

		expect(await fileExists(join(appRoot, "routes/auth.ts"))).toBe(true);
		expect(await fileExists(join(appRoot, "app/validators/auth.ts"))).toBe(
			true,
		);
		expect(
			await fileExists(
				join(appRoot, "database/migrations/00000000000000_create_users.ts"),
			),
		).toBe(true);
		expect(
			await fileExists(
				join(
					appRoot,
					"database/migrations/00000000000001_create_access_tokens.ts",
				),
			),
		).toBe(true);
		expect(await readFile(join(appRoot, "start/routes.ts"), "utf8")).toContain(
			"registerAuthRoutes(router);",
		);
		expect(await readFile(join(appRoot, "start/kernel.ts"), "utf8")).toContain(
			"auth: authMiddleware",
		);
		expect(await readFile(join(appRoot, "config/app.ts"), "utf8")).toContain(
			'auth: "access-token"',
		);
		expect(await readFile(join(appRoot, ".env"), "utf8")).toContain(
			"AUTH_GUARD=api",
		);
	});

	test("prints a dry-run plan without writing files", async () => {
		const appRoot = await makeGeneratedApp();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerFeatureCommands(console, { root: appRoot });

		expect(await console.run(["add", "queue", "--dry-run"])).toBe(0);

		expect(output.text()).toContain("Dry run enabled");
		expect(output.text()).toContain("create    config/queue.ts");
		expect(await fileExists(join(appRoot, "config/queue.ts"))).toBe(false);
	});
});

async function makeGeneratedApp(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-add-test-"));
	roots.push(root);

	const console = new ConsoleKernel(new MemoryConsoleOutput());
	registerNewAppCommand(console, {
		root,
		packageVersion: "0.0.0-test",
	});

	expect(await console.run(["new", "demo", "--yes"])).toBe(0);

	return join(root, "demo");
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

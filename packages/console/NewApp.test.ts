import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleKernel, MemoryConsoleOutput } from "./Console";
import { type NewAppPrompt, registerNewAppCommand } from "./NewApp";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-new-"));
	roots.push(root);
	return root;
}

async function readGenerated(root: string, path: string): Promise<string> {
	return readFile(join(root, path), "utf8");
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("new app command", () => {
	test("registers the new command", () => {
		const console = new ConsoleKernel(new MemoryConsoleOutput());

		registerNewAppCommand(console);

		expect(console.find("new")?.description).toBe(
			"Create a new Kura application",
		);
	});

	test("generates a non-interactive API application", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerNewAppCommand(console, {
			root,
			packageVersion: "file:../kura",
		});

		const exitCode = await console.run([
			"new",
			"demo-api",
			"--yes",
			"--database",
			"sqlite",
			"--auth",
			"jwt",
			"--cache",
			"file",
			"--queue",
			"memory",
			"--module",
			"mail,storage",
		]);

		expect(exitCode).toBe(0);
		expect(output.text()).toContain("Created demo-api");
		expect(output.text()).toContain("Database: sqlite");
		expect(output.text()).toContain("Modules: mail, storage");

		const packageJson = JSON.parse(
			await readGenerated(root, "demo-api/package.json"),
		) as {
			dependencies: { kura: string };
			scripts: { dev: string; build: string };
		};
		expect(packageJson.dependencies.kura).toBe("file:../kura");
		expect(packageJson.scripts.dev).toBe("bun --watch src/server.ts");
		expect(packageJson.scripts.build).toContain("--target=bun");
		expect(await readGenerated(root, "demo-api/src/routes.ts")).toContain(
			'framework: "kura"',
		);
		expect(await readGenerated(root, "demo-api/.env.example")).toContain(
			"APP_KEY=",
		);
	});

	test("uses the local framework package when generated from the Kura repo", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerNewAppCommand(console, { root });

		const exitCode = await console.run(["new", "demo", "--yes"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toContain("Framework: file:");

		const packageJson = JSON.parse(
			await readGenerated(root, "demo/package.json"),
		) as { dependencies: { kura: string } };
		expect(packageJson.dependencies.kura).toStartWith("file:");
		expect(packageJson.dependencies.kura).not.toBe("latest");
	});

	test("uses injected prompts for interactive generation", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerNewAppCommand(console, {
			root,
			prompt: new FakePrompt({
				selects: ["web", "postgres", "session", "redis", "redis"],
				modules: ["i18n", "websockets"],
				install: true,
			}),
			install: async () => {
				output.write("fake install");
			},
		});

		const exitCode = await console.run(["new", "demo-web"], {
			output,
		});

		expect(exitCode).toBe(0);
		expect(output.text()).toContain("fake install");
		expect(output.text()).toContain("Preset: web");
		expect(output.text()).toContain("Modules: i18n, websockets");
		expect(await readGenerated(root, "demo-web/config/app.ts")).toContain(
			'preset: "web"',
		);
		expect(await readGenerated(root, "demo-web/.env.example")).toContain(
			"REDIS_URL=",
		);
	});

	test("refuses existing directories unless force is enabled", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerNewAppCommand(console, { root });

		expect(await console.run(["new", "demo", "--yes"])).toBe(0);
		expect(await console.run(["new", "demo", "--yes"])).toBe(1);
		expect(output.errorText()).toContain("already exists");

		const forceOutput = new MemoryConsoleOutput();
		expect(
			await console.run(["new", "demo", "--yes", "--force"], {
				output: forceOutput,
			}),
		).toBe(0);
		expect(forceOutput.text()).toContain("Created demo");
	});

	test("validates application names and option values", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerNewAppCommand(console, { root });

		expect(await console.run(["new", "../bad", "--yes"])).toBe(1);
		expect(output.errorText()).toContain(
			"Application name segment [..] is invalid",
		);

		expect(
			await console.run(["new", "demo", "--yes", "--database", "oracle"]),
		).toBe(1);
		expect(output.errorText()).toContain("Invalid database [oracle]");
	});

	test("generates a server entry that Bun can build for Bun", async () => {
		const root = await makeRoot();
		const console = new ConsoleKernel(new MemoryConsoleOutput());
		registerNewAppCommand(console, { root });

		expect(await console.run(["new", "demo", "--yes"])).toBe(0);

		const build = Bun.spawnSync({
			cmd: [
				process.execPath,
				"build",
				"src/server.ts",
				"--target=bun",
				"--packages=external",
				"--outdir=dist",
			],
			cwd: join(root, "demo"),
			stderr: "pipe",
			stdout: "pipe",
		});

		expect(build.exitCode).toBe(0);
	});
});

class FakePrompt implements NewAppPrompt {
	private readonly selects: string[];

	constructor(
		private readonly answers: {
			readonly selects: readonly string[];
			readonly modules: readonly string[];
			readonly install: boolean;
		},
	) {
		this.selects = [...answers.selects];
	}

	select(
		_message: string,
		_choices: readonly string[],
		defaultValue: string,
	): string {
		const answer = this.selects.shift();

		return answer ?? defaultValue;
	}

	multiSelect(): readonly string[] {
		return this.answers.modules;
	}

	confirm(): boolean {
		return this.answers.install;
	}
}

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleKernel, MemoryConsoleOutput } from "./Console";
import { type NewAppPrompt, registerNewAppCommand } from "./NewApp";

const roots: string[] = [];

function fakeClock(...timestamps: number[]): () => number {
	let index = 0;

	return () => {
		const value = timestamps[Math.min(index, timestamps.length - 1)] ?? 0;
		index += 1;

		return value;
	};
}

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-new-"));
	roots.push(root);
	return root;
}

async function readGenerated(root: string, path: string): Promise<string> {
	return readFile(join(root, path), "utf8");
}

async function generatedDirectoryExists(
	root: string,
	path: string,
): Promise<boolean> {
	return (await stat(join(root, path))).isDirectory();
}

async function generatedFileExists(
	root: string,
	path: string,
): Promise<boolean> {
	try {
		return (await stat(join(root, path))).isFile();
	} catch {
		return false;
	}
}

async function generatedPathExists(
	root: string,
	path: string,
): Promise<boolean> {
	try {
		await stat(join(root, path));
		return true;
	} catch {
		return false;
	}
}

async function findFilesNamed(
	root: string,
	name: string,
	prefix = "",
): Promise<string[]> {
	const directory = join(root, prefix);
	const entries = await readdir(directory, { withFileTypes: true });
	const matches: string[] = [];

	for (const entry of entries) {
		const entryPath = prefix ? join(prefix, entry.name) : entry.name;

		if (entry.isDirectory()) {
			matches.push(...(await findFilesNamed(root, name, entryPath)));
			continue;
		}

		if (entry.name === name) {
			matches.push(entryPath);
		}
	}

	return matches;
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
			clock: fakeClock(100, 142),
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
		expect(output.text()).toContain("Kura new");
		expect(output.text()).toContain("Database sqlite");
		expect(output.text()).toContain("Modules  mail, storage");
		expect(output.text()).toContain("Created demo-api in 42ms");

		const packageJson = JSON.parse(
			await readGenerated(root, "demo-api/package.json"),
		) as {
			dependencies: { kura: string };
			imports: Record<string, string>;
			scripts: { build: string; dev: string; kura: string; test: string };
		};
		expect(packageJson.dependencies.kura).toBe("file:../kura");
		expect(packageJson.scripts.kura).toBe("bun bin/console.ts");
		expect(packageJson.scripts.dev).toBe("bun bin/console.ts serve --watch");
		expect(packageJson.scripts.test).toBe("bun bin/test.ts");
		expect(packageJson.scripts.build).toContain("--target=bun");
		expect(packageJson.scripts.build).toContain("bin/server.ts");
		expect(packageJson.imports["#controllers/*"]).toBe(
			"./app/controllers/*.ts",
		);
		expect(packageJson.imports["#start/*"]).toBe("./start/*.ts");
		expect(await readGenerated(root, "demo-api/kura.config.ts")).toContain(
			'preloads: ["#start/env", "#start/kernel", "#start/routes"]',
		);
		expect(await readGenerated(root, "demo-api/bin/console.ts")).toContain(
			'await import("#start/env")',
		);
		expect(await readGenerated(root, "demo-api/bin/console.ts")).toContain(
			'entry: "bin/server.ts"',
		);
		expect(await readGenerated(root, "demo-api/bin/server.ts")).toContain(
			'import env from "#start/env"',
		);
		expect(await readGenerated(root, "demo-api/start/env.ts")).toContain(
			"new Env()",
		);
		expect(await readGenerated(root, "demo-api/start/kernel.ts")).toContain(
			"serverMiddleware",
		);
		expect(await readGenerated(root, "demo-api/start/routes.ts")).toContain(
			'framework: "kura"',
		);
		const appConfig = await readGenerated(root, "demo-api/config/app.ts");
		expect(appConfig).toContain("export const appUrl");
		expect(appConfig).toContain("const appConfig = defineConfig");
		expect(appConfig).toContain("http: {");
		expect(appConfig).toContain("starter: {");
		const authConfig = await readGenerated(root, "demo-api/config/auth.ts");
		expect(authConfig).toContain("const authConfig = defineConfig");
		expect(authConfig).toContain("guards: {");
		expect(authConfig).toContain('driver: "jwt"');
		expect(
			await readGenerated(root, "demo-api/config/bodyparser.ts"),
		).toContain("const bodyParserConfig = defineConfig");
		const databaseConfig = await readGenerated(
			root,
			"demo-api/config/database.ts",
		);
		expect(databaseConfig).toContain("const databaseConfig = defineConfig");
		expect(databaseConfig).toContain('env.get("DB_CONNECTION", "sqlite")');
		expect(databaseConfig).toContain("connections: {");
		expect(
			await readGenerated(root, "demo-api/config/encryption.ts"),
		).toContain("const encryptionConfig = defineConfig");
		const hashConfig = await readGenerated(root, "demo-api/config/hash.ts");
		expect(hashConfig).toContain("const hashConfig = defineConfig");
		expect(hashConfig).toContain("argon2id");
		expect(hashConfig).toContain("bcrypt");
		expect(await readGenerated(root, "demo-api/config/logger.ts")).toContain(
			"loggers: {",
		);
		expect(await readGenerated(root, "demo-api/config/queue.ts")).toContain(
			'env.get("QUEUE_CONNECTION", "memory")',
		);
		expect(await readGenerated(root, "demo-api/config/session.ts")).toContain(
			'store: env.get("SESSION_DRIVER", "memory")',
		);
		expect(await readGenerated(root, "demo-api/config/shield.ts")).toContain(
			"enabled: false",
		);
		expect(await readGenerated(root, "demo-api/config/static.ts")).toContain(
			"enabled: false",
		);
		expect(await generatedFileExists(root, "demo-api/config/vite.ts")).toBe(
			false,
		);
		const envExample = await readGenerated(root, "demo-api/.env.example");
		expect(envExample).toContain("APP_NAME=Kura API");
		expect(envExample).toContain("APP_KEY=");
		expect(envExample).toContain("HASH_DRIVER=bcrypt");
		expect(envExample).toContain("DB_CONNECTION=sqlite");
		expect(await readGenerated(root, "demo-api/.env.test")).toContain(
			"NODE_ENV=test",
		);
		expect(
			await generatedDirectoryExists(root, "demo-api/app/controllers"),
		).toBe(true);
		expect(
			await generatedDirectoryExists(root, "demo-api/database/migrations"),
		).toBe(true);
		expect(
			await generatedDirectoryExists(root, "demo-api/resources/views"),
		).toBe(true);
		expect(await readGenerated(root, "demo-api/.gitignore")).not.toContain(
			".gitkeep",
		);
		expect(await readGenerated(root, "demo-api/.gitignore")).toContain(".kura");
		expect(await generatedPathExists(root, "demo-api/.kura/server")).toBe(
			false,
		);
		expect(await findFilesNamed(join(root, "demo-api"), ".gitkeep")).toEqual(
			[],
		);
	});

	test("uses the local framework package when generated from the Kura repo", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerNewAppCommand(console, { root, clock: fakeClock(100, 142) });

		const exitCode = await console.run(["new", "demo", "--yes"]);

		expect(exitCode).toBe(0);
		expect(output.text()).not.toContain("Framework:");
		expect(output.text()).toContain("Created demo in 42ms");

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
			clock: fakeClock(100, 142),
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
		expect(output.text()).toContain("Preset   web");
		expect(output.text()).toContain("Modules  i18n, websockets");
		expect(output.text()).toContain("Dependencies installed");
		expect(output.text()).not.toContain("  bun install");
		expect(await readGenerated(root, "demo-web/config/app.ts")).toContain(
			'preset: "web"',
		);
		expect(await readGenerated(root, "demo-web/config/vite.ts")).toContain(
			"const viteConfig = defineConfig",
		);
		expect(await readGenerated(root, "demo-web/config/shield.ts")).toContain(
			"enabled: true",
		);
		expect(await readGenerated(root, "demo-web/.env.example")).toContain(
			"REDIS_URL=",
		);
	});

	test("renders guided terminal prompts with numbered choices", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		const messages: string[] = [];
		const answers = ["2", "postgres", "2", "3", "2", "mail,4", "yes"];
		const promptHost = globalThis as {
			prompt?: (message: string, defaultValue?: string) => string | null;
		};
		const previousPrompt = promptHost.prompt;

		promptHost.prompt = (message: string): string => {
			messages.push(message);

			return answers.shift() ?? "";
		};

		try {
			registerNewAppCommand(console, {
				root,
				clock: fakeClock(100, 142),
				install: () => {
					output.write("fake install");
				},
			});

			expect(await console.run(["new", "guided", "--interactive"])).toBe(0);
		} finally {
			promptHost.prompt = previousPrompt;
		}

		expect(messages[0]).toContain("Application type\n\n  1. API");
		expect(messages[0]).toContain("  2. Web");
		expect(messages[0]).toContain("Select [1]");
		expect(messages[1]).toContain("Database\n\n  1. None");
		expect(messages[5]).toContain(
			"Select names or numbers, comma separated [none]",
		);
		expect(output.text()).toContain("fake install");
		expect(output.text()).toContain("Preset   web");
		expect(output.text()).toContain("Database postgres");
		expect(output.text()).toContain("Auth     session");
		expect(output.text()).toContain("Cache    redis");
		expect(output.text()).toContain("Queue    memory");
		expect(output.text()).toContain("Modules  mail, websockets");
		expect(output.text()).toContain("Dependencies installed");
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
				"bin/server.ts",
				"--target=bun",
				"--packages=external",
				"--outdir=build",
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

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleKernel, MemoryConsoleOutput } from "./Console";
import { type NewAppPrompt, registerNewAppCommand } from "./NewApp";
import { TerminalPrompt } from "./new-app/Prompt";

const roots: string[] = [];

class FakeTtyInput {
	readonly isTTY = true;
	readonly rawModes: boolean[] = [];
	private readonly listeners = new Set<(chunk: Uint8Array | string) => void>();

	setRawMode(enabled: boolean): void {
		this.rawModes.push(enabled);
	}

	resume(): void {}

	pause(): void {}

	on(event: "data", listener: (chunk: Uint8Array | string) => void): void {
		if (event === "data") {
			this.listeners.add(listener);
		}
	}

	off(event: "data", listener: (chunk: Uint8Array | string) => void): void {
		if (event === "data") {
			this.listeners.delete(listener);
		}
	}

	send(chunk: string): void {
		for (const listener of this.listeners) {
			listener(chunk);
		}
	}
}

class FakeTtyOutput {
	readonly isTTY = true;
	readonly chunks: string[] = [];

	write(chunk: string): void {
		this.chunks.push(chunk);
	}

	text(): string {
		return this.chunks.join("");
	}
}

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

async function findEmptyDirectories(
	root: string,
	prefix = "",
): Promise<string[]> {
	const directory = join(root, prefix);
	const entries = await readdir(directory, { withFileTypes: true });
	const matches: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const entryPath = prefix ? join(prefix, entry.name) : entry.name;
		matches.push(...(await findEmptyDirectories(root, entryPath)));
	}

	if (prefix && entries.length === 0) {
		matches.push(prefix);
	}

	return matches;
}

function buildGeneratedServer(
	root: string,
	path: string,
): ReturnType<typeof Bun.spawnSync> {
	return Bun.spawnSync({
		cmd: [
			process.execPath,
			"build",
			"bin/server.ts",
			"--target=bun",
			"--packages=external",
			"--outdir=build",
		],
		cwd: join(root, path),
		stderr: "pipe",
		stdout: "pipe",
	});
}

function stripAnsi(value: string): string {
	let output = "";
	let index = 0;

	while (index < value.length) {
		if (value.charCodeAt(index) !== 27 || value[index + 1] !== "[") {
			output += value[index] ?? "";
			index += 1;
			continue;
		}

		index += 2;

		while (index < value.length && !/[A-Za-z]/.test(value[index] ?? "")) {
			index += 1;
		}

		index += 1;
	}

	return output;
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
		expect(output.text()).toContain("Structure standard");
		expect(output.text()).toContain("Database sqlite");
		expect(output.text()).toContain("Modules  mail, storage");
		expect(output.text()).toContain("Created demo-api in 42ms");
		expect(output.text()).toContain("Useful commands");
		expect(output.text()).toContain("bun kura routes");
		expect(output.text()).toContain("Open http://localhost:3333");

		const packageJson = JSON.parse(
			await readGenerated(root, "demo-api/package.json"),
		) as {
			dependencies: { kura: string };
			imports: Record<string, string>;
			scripts: {
				build: string;
				config: string;
				dev: string;
				doctor: string;
				env: string;
				kura: string;
				routes: string;
				test: string;
			};
		};
		expect(packageJson.dependencies.kura).toBe("file:../kura");
		expect(packageJson.scripts.kura).toBe("bun bin/console.ts");
		expect(packageJson.scripts.dev).toBe("bun bin/console.ts serve --watch");
		expect(packageJson.scripts.routes).toBe("bun bin/console.ts routes");
		expect(packageJson.scripts.doctor).toBe("bun bin/console.ts doctor");
		expect(packageJson.scripts.env).toBe("bun bin/console.ts env");
		expect(packageJson.scripts.config).toBe("bun bin/console.ts config");
		expect(packageJson.scripts.test).toBe("bun bin/test.ts");
		expect(packageJson.scripts.build).toContain("--target=bun");
		expect(packageJson.scripts.build).toContain("--production");
		expect(packageJson.scripts.build).toContain("bin/server.ts");
		expect(packageJson.imports["#controllers/*"]).toBe(
			"./app/controllers/*.ts",
		);
		expect(packageJson.imports["#modules/*"]).toBe("./app/modules/*.ts");
		expect(packageJson.imports["#domains/*"]).toBe("./app/domains/*.ts");
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
		expect(await readGenerated(root, "demo-api/bin/console.ts")).toContain(
			"registerDevToolCommands",
		);
		expect(await readGenerated(root, "demo-api/bin/console.ts")).toContain(
			'await import("#start/routes")',
		);
		expect(await readGenerated(root, "demo-api/bin/server.ts")).toContain(
			'import env from "#start/env"',
		);
		expect(await readGenerated(root, "demo-api/bin/server.ts")).toContain(
			"new MiddlewarePipeline()",
		);
		expect(await readGenerated(root, "demo-api/bin/server.ts")).toContain(
			"pipeline.toHandler(dispatchRouter)",
		);
		expect(await readGenerated(root, "demo-api/start/env.ts")).toContain(
			"new Env()",
		);
		expect(await readGenerated(root, "demo-api/start/kernel.ts")).toContain(
			"serverMiddleware",
		);
		expect(await readGenerated(root, "demo-api/start/routes.ts")).toContain(
			'import { ApiController } from "#controllers/api_controller"',
		);
		expect(await readGenerated(root, "demo-api/start/routes.ts")).toContain(
			'router.get("/", (ctx) => apiController.index(ctx)).as("home")',
		);
		expect(
			await readGenerated(root, "demo-api/app/controllers/api_controller.ts"),
		).toContain('framework: "kura"');
		expect(
			await readGenerated(root, "demo-api/app/controllers/auth_controller.ts"),
		).toContain("Wire this action to your jwt guard");
		expect(await readGenerated(root, "demo-api/app/models/user.ts")).toContain(
			"export class User extends BaseModel<UserAttributes>",
		);
		expect(
			await readGenerated(
				root,
				"demo-api/database/migrations/00000000000000_create_users.ts",
			),
		).toContain('schema.createTable("users"');
		expect(
			await generatedFileExists(
				root,
				"demo-api/database/migrations/00000000000001_create_sessions.ts",
			),
		).toBe(false);
		expect(await readGenerated(root, "demo-api/config/mail.ts")).toContain(
			"const mailConfig = defineConfig",
		);
		expect(
			await readGenerated(root, "demo-api/app/mails/welcome_mail.ts"),
		).toContain("WelcomeMail");
		expect(await readGenerated(root, "demo-api/config/storage.ts")).toContain(
			"const storageConfig = defineConfig",
		);
		expect(
			await readGenerated(root, "demo-api/app/services/storage_service.ts"),
		).toContain("class StorageService");
		expect(await readGenerated(root, "demo-api/README.md")).toContain(
			"HTTP kernel",
		);
		const appConfig = await readGenerated(root, "demo-api/config/app.ts");
		expect(appConfig).toContain("export const appUrl");
		expect(appConfig).toContain("const appConfig = defineConfig");
		expect(appConfig).toContain("http: {");
		expect(appConfig).toContain("starter: {");
		expect(appConfig).toContain('architecture: "standard"');
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
		expect(await generatedFileExists(root, "demo-api/config/session.ts")).toBe(
			false,
		);
		expect(await generatedFileExists(root, "demo-api/config/shield.ts")).toBe(
			false,
		);
		expect(await generatedFileExists(root, "demo-api/config/static.ts")).toBe(
			false,
		);
		expect(await generatedFileExists(root, "demo-api/config/vite.ts")).toBe(
			false,
		);
		const envExample = await readGenerated(root, "demo-api/.env.example");
		expect(envExample).toContain("APP_NAME=Kura API");
		expect(envExample).toContain("APP_KEY=");
		expect(envExample).toContain("HASH_DRIVER=bcrypt");
		expect(envExample).toContain("DB_CONNECTION=sqlite");
		expect(envExample).toContain("CACHE_STORE=file");
		expect(envExample).toContain("QUEUE_CONNECTION=memory");
		expect(await readGenerated(root, "demo-api/.env.test")).toContain(
			"NODE_ENV=test",
		);
		expect(
			await generatedDirectoryExists(root, "demo-api/app/controllers"),
		).toBe(true);
		expect(
			await generatedDirectoryExists(root, "demo-api/database/migrations"),
		).toBe(true);
		expect(await generatedDirectoryExists(root, "demo-api/tmp/cache")).toBe(
			true,
		);
		expect(await generatedDirectoryExists(root, "demo-api/storage/app")).toBe(
			true,
		);
		expect(await generatedPathExists(root, "demo-api/resources/views")).toBe(
			false,
		);
		expect(await generatedPathExists(root, "demo-api/public")).toBe(false);
		expect(await generatedPathExists(root, "demo-api/app/events")).toBe(false);
		expect(await generatedPathExists(root, "demo-api/app/jobs")).toBe(false);
		expect(await generatedPathExists(root, "demo-api/app/listeners")).toBe(
			false,
		);
		expect(await generatedPathExists(root, "demo-api/app/middleware")).toBe(
			false,
		);
		expect(await generatedPathExists(root, "demo-api/app/policies")).toBe(
			false,
		);
		expect(await generatedPathExists(root, "demo-api/app/validators")).toBe(
			false,
		);
		expect(await findEmptyDirectories(join(root, "demo-api"), "app")).toEqual(
			[],
		);
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

	test("generates a modular application structure", async () => {
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
			"demo-modular",
			"--yes",
			"--preset",
			"full",
			"--architecture",
			"modular",
			"--auth",
			"session",
			"--module",
			"storage",
		]);

		expect(exitCode).toBe(0);
		expect(output.text()).toContain("Structure modular");

		const packageJson = JSON.parse(
			await readGenerated(root, "demo-modular/package.json"),
		) as { imports: Record<string, string> };
		expect(packageJson.imports["#modules/*"]).toBe("./app/modules/*.ts");
		expect(await readGenerated(root, "demo-modular/tsconfig.json")).toContain(
			'"lib": ["ESNext", "DOM"]',
		);
		expect(
			await generatedFileExists(
				root,
				"demo-modular/app/modules/api/api_controller.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-modular/app/modules/web/home_controller.ts",
			),
		).toBe(false);
		expect(
			await generatedFileExists(root, "demo-modular/resources/pages/home.html"),
		).toBe(true);
		expect(
			await generatedFileExists(root, "demo-modular/resources/client/app.ts"),
		).toBe(true);
		expect(
			await readGenerated(root, "demo-modular/resources/client/app.ts"),
		).toContain("export {}");
		expect(
			await generatedFileExists(root, "demo-modular/resources/css/app.css"),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-modular/app/modules/auth/auth_controller.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(root, "demo-modular/app/modules/auth/user.ts"),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-modular/app/modules/storage/storage_service.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-modular/app/controllers/api_controller.ts",
			),
		).toBe(false);
		expect(await readGenerated(root, "demo-modular/start/routes.ts")).toContain(
			'from "#modules/api/api_controller"',
		);
		expect(await readGenerated(root, "demo-modular/start/routes.ts")).toContain(
			'from "#modules/auth/auth_controller"',
		);
		expect(
			await readGenerated(root, "demo-modular/start/routes.ts"),
		).not.toContain('from "#modules/web/home_controller"');
		expect(await readGenerated(root, "demo-modular/bin/server.ts")).toContain(
			'import home from "../resources/pages/home.html"',
		);
		expect(await readGenerated(root, "demo-modular/bin/server.ts")).toContain(
			"export const staticRoutes",
		);
		expect(await readGenerated(root, "demo-modular/bin/server.ts")).toContain(
			"export const development",
		);
		expect(await readGenerated(root, "demo-modular/bin/console.ts")).toContain(
			"loadStaticRoutes",
		);
		expect(await readGenerated(root, "demo-modular/config/auth.ts")).toContain(
			'model: "#modules/auth/user"',
		);
		expect(await readGenerated(root, "demo-modular/config/app.ts")).toContain(
			'architecture: "modular"',
		);
		expect(await readGenerated(root, "demo-modular/README.md")).toContain(
			"`app/modules/`",
		);
		expect(buildGeneratedServer(root, "demo-modular").exitCode).toBe(0);
	});

	test("generates a domain architecture structure", async () => {
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
			"demo-domain",
			"--yes",
			"--preset",
			"full",
			"--architecture",
			"domain",
			"--auth",
			"session",
			"--module",
			"storage",
		]);

		expect(exitCode).toBe(0);
		expect(output.text()).toContain("Structure domain");

		const packageJson = JSON.parse(
			await readGenerated(root, "demo-domain/package.json"),
		) as { imports: Record<string, string> };
		expect(packageJson.imports["#domains/*"]).toBe("./app/domains/*.ts");
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/domains/api/http/api_controller.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/domains/web/http/home_controller.ts",
			),
		).toBe(false);
		expect(
			await generatedFileExists(root, "demo-domain/resources/pages/home.html"),
		).toBe(true);
		expect(
			await generatedFileExists(root, "demo-domain/resources/client/app.ts"),
		).toBe(true);
		expect(
			await generatedFileExists(root, "demo-domain/resources/css/app.css"),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/domains/auth/http/auth_controller.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/domains/auth/domain/user.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/domains/auth/domain/user_repository.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/domains/auth/application/register_user.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/domains/auth/infrastructure/persistence/user_record.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/domains/auth/infrastructure/persistence/sql_user_repository.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/domains/storage/infrastructure/storage_service.ts",
			),
		).toBe(true);
		expect(
			await generatedFileExists(
				root,
				"demo-domain/app/modules/auth/auth_controller.ts",
			),
		).toBe(false);
		expect(
			await readGenerated(root, "demo-domain/app/domains/auth/domain/user.ts"),
		).not.toContain("BaseModel");
		expect(
			await readGenerated(
				root,
				"demo-domain/app/domains/auth/infrastructure/persistence/user_record.ts",
			),
		).toContain("extends BaseModel<UserRecordAttributes>");
		expect(
			await readGenerated(
				root,
				"demo-domain/app/domains/auth/application/register_user.ts",
			),
		).toContain("constructor(private readonly users: UserRepository)");
		expect(await readGenerated(root, "demo-domain/start/routes.ts")).toContain(
			'from "#domains/api/http/api_controller"',
		);
		expect(await readGenerated(root, "demo-domain/start/routes.ts")).toContain(
			'from "#domains/auth/http/auth_controller"',
		);
		expect(
			await readGenerated(root, "demo-domain/start/routes.ts"),
		).not.toContain('from "#domains/web/http/home_controller"');
		expect(await readGenerated(root, "demo-domain/config/auth.ts")).toContain(
			'model: "#domains/auth/infrastructure/persistence/user_record"',
		);
		expect(await readGenerated(root, "demo-domain/config/app.ts")).toContain(
			'architecture: "domain"',
		);
		expect(await readGenerated(root, "demo-domain/README.md")).toContain(
			"`app/domains/`",
		);
		expect(buildGeneratedServer(root, "demo-domain").exitCode).toBe(0);
	});

	test("uses a Kura import alias for the framework package", async () => {
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
		expect(packageJson.dependencies.kura).not.toBe("latest");
		expect(
			packageJson.dependencies.kura === "npm:@akuseru_w/kura@^0.1.6" ||
				(packageJson.dependencies.kura.startsWith("file:") &&
					packageJson.dependencies.kura.endsWith("dist")),
		).toBe(true);
	});

	test("keeps minimal applications free of unselected feature configs", async () => {
		const root = await makeRoot();
		const console = new ConsoleKernel(new MemoryConsoleOutput());
		registerNewAppCommand(console, { root, clock: fakeClock(100, 142) });

		expect(await console.run(["new", "minimal", "--yes"])).toBe(0);

		expect(await generatedFileExists(root, "minimal/config/app.ts")).toBe(true);
		expect(
			await generatedFileExists(root, "minimal/config/bodyparser.ts"),
		).toBe(true);
		expect(await generatedFileExists(root, "minimal/config/logger.ts")).toBe(
			true,
		);
		expect(await generatedFileExists(root, "minimal/config/auth.ts")).toBe(
			false,
		);
		expect(await generatedFileExists(root, "minimal/config/cache.ts")).toBe(
			false,
		);
		expect(await generatedFileExists(root, "minimal/config/database.ts")).toBe(
			false,
		);
		expect(
			await generatedFileExists(root, "minimal/config/encryption.ts"),
		).toBe(false);
		expect(await generatedFileExists(root, "minimal/config/hash.ts")).toBe(
			false,
		);
		expect(await generatedFileExists(root, "minimal/config/queue.ts")).toBe(
			false,
		);
		expect(await generatedFileExists(root, "minimal/config/session.ts")).toBe(
			false,
		);
		expect(await generatedFileExists(root, "minimal/config/shield.ts")).toBe(
			false,
		);
		expect(await generatedFileExists(root, "minimal/config/static.ts")).toBe(
			false,
		);
		expect(await generatedPathExists(root, "minimal/database")).toBe(false);

		const envExample = await readGenerated(root, "minimal/.env.example");
		expect(envExample).not.toContain("CACHE_STORE");
		expect(envExample).not.toContain("QUEUE_CONNECTION");
		expect(envExample).not.toContain("AUTH_GUARD");
		expect(envExample).not.toContain("HASH_DRIVER");
		expect(envExample).not.toContain("DB_CONNECTION");
	});

	test("uses injected prompts for interactive generation", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerNewAppCommand(console, {
			root,
			clock: fakeClock(100, 142),
			prompt: new FakePrompt({
				selects: ["web", "standard", "postgres", "session", "redis", "redis"],
				features: ["database", "auth", "cache", "queue", "i18n", "websockets"],
				confirms: [true, true],
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
		expect(output.text()).toContain("Structure standard");
		expect(output.text()).toContain("Modules  i18n, websockets");
		expect(output.text()).toContain("Scaffold");
		expect(output.text()).toContain("Dependencies installed");
		expect(output.text()).not.toContain("  bun install");
		expect(await readGenerated(root, "demo-web/config/app.ts")).toContain(
			'preset: "web"',
		);
		expect(await generatedFileExists(root, "demo-web/config/vite.ts")).toBe(
			false,
		);
		expect(
			await readGenerated(root, "demo-web/app/controllers/home_controller.ts"),
		).toContain('view("home"');
		expect(
			await readGenerated(root, "demo-web/resources/views/home.kura.html"),
		).toContain("<p>{{ preset }} app</p>");
		expect(await readGenerated(root, "demo-web/start/routes.ts")).toContain(
			'import { HomeController } from "#controllers/home_controller"',
		);
		expect(await readGenerated(root, "demo-web/start/routes.ts")).toContain(
			'router.group().prefix("/auth").as("auth.")',
		);
		expect(
			await readGenerated(root, "demo-web/app/controllers/auth_controller.ts"),
		).toContain("Wire this action to your session guard");
		expect(
			await readGenerated(
				root,
				"demo-web/database/migrations/00000000000001_create_sessions.ts",
			),
		).toContain('schema.createTable("sessions"');
		expect(await readGenerated(root, "demo-web/config/shield.ts")).toContain(
			"enabled: true",
		);
		expect(await readGenerated(root, "demo-web/.env.example")).toContain(
			"REDIS_URL=",
		);
		expect(await readGenerated(root, "demo-web/config/i18n.ts")).toContain(
			"defaultLocale",
		);
		expect(
			await readGenerated(root, "demo-web/resources/lang/en/messages.ts"),
		).toContain("Welcome to Kura");
		expect(
			await readGenerated(root, "demo-web/config/websockets.ts"),
		).toContain('path: "/ws"');
		expect(
			await readGenerated(root, "demo-web/app/services/websocket_service.ts"),
		).toContain("class WebSocketService");
		expect(buildGeneratedServer(root, "demo-web").exitCode).toBe(0);
	});

	test("supports TTY arrow navigation for single-select prompts", async () => {
		const input = new FakeTtyInput();
		const output = new FakeTtyOutput();
		const prompt = new TerminalPrompt({
			banner: true,
			color: false,
			input,
			output,
		});
		const value = prompt.select(
			"Application type",
			["api", "web", "full"],
			"api",
			[
				{
					value: "api",
					label: "API",
					description: "JSON API starter",
				},
				{
					value: "web",
					label: "Web",
					description: "Server-rendered web app",
				},
				{
					value: "full",
					label: "Full",
					description: "API and web app",
				},
			],
		);

		input.send("\u001b[B");
		input.send("\r");

		expect(await value).toBe("web");
		expect(input.rawModes).toEqual([true, false]);
		expect(stripAnsi(output.text())).toContain("_  __");
		expect(stripAnsi(output.text())).toContain(
			"❯ Application type? Press <ENTER> to select",
		);
		expect(stripAnsi(output.text())).toContain("❯     Web");
	});

	test("supports TTY multi-select prompts", async () => {
		const input = new FakeTtyInput();
		const output = new FakeTtyOutput();
		const prompt = new TerminalPrompt({
			banner: false,
			color: false,
			input,
			output,
		});
		const value = prompt.multiSelect(
			"Optional modules",
			["mail", "storage", "i18n", "websockets"],
			[],
			[
				{
					value: "mail",
					label: "Mail",
					description: "Email delivery",
				},
				{
					value: "storage",
					label: "Storage",
					description: "File storage",
				},
				{
					value: "i18n",
					label: "i18n",
					description: "Translations",
				},
				{
					value: "websockets",
					label: "WebSockets",
					description: "Realtime server",
				},
			],
		);

		input.send("\u001b[B");
		input.send(" ");
		input.send("\u001b[B");
		input.send(" ");
		input.send("\r");

		expect(await value).toEqual(["storage", "i18n"]);
		expect(stripAnsi(output.text())).toContain(
			"❯ Optional modules? Press <SPACE> to toggle, <ENTER> to continue",
		);
		expect(stripAnsi(output.text())).toContain("[x] Storage");
		expect(stripAnsi(output.text())).toContain("[x] i18n");
	});

	test("supports clearing default TTY multi-select values", async () => {
		const input = new FakeTtyInput();
		const output = new FakeTtyOutput();
		const prompt = new TerminalPrompt({
			banner: false,
			color: false,
			input,
			output,
		});
		const value = prompt.multiSelect(
			"Features",
			["mail", "storage"],
			["mail"],
			[
				{
					value: "mail",
					label: "Mail",
					description: "Email delivery",
				},
				{
					value: "storage",
					label: "Storage",
					description: "File storage",
				},
			],
		);

		input.send(" ");
		input.send("\r");

		expect(await value).toEqual([]);
		expect(stripAnsi(output.text())).toContain("❯     Mail");
	});

	test("renders guided terminal prompts with numbered choices", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		const messages: string[] = [];
		const answers = [
			"2",
			"1",
			"1,2,3,4,5,8",
			"postgres",
			"2",
			"3",
			"2",
			"yes",
			"yes",
		];
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
		expect(messages[1]).toContain("Project structure\n\n  1. Standard");
		expect(messages[1]).toContain("  2. Modular");
		expect(messages[1]).toContain("  3. Domain");
		expect(messages[2]).toContain("Features\n\n  1. Database");
		expect(messages[2]).toContain("  8. WebSockets");
		expect(messages[2]).toContain(
			"Select names or numbers, comma separated [none]",
		);
		expect(messages[3]).toContain("Database\n\n  1. None");
		expect(messages[8]).toContain("Create project");
		expect(output.text()).toContain("fake install");
		expect(output.text()).toContain("Scaffold");
		expect(output.text()).toContain("Preset   web");
		expect(output.text()).toContain("Structure standard");
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

		expect(
			await console.run(["new", "demo", "--yes", "--architecture", "layers"]),
		).toBe(1);
		expect(output.errorText()).toContain("Invalid architecture [layers]");
	});

	test("generates a server entry that Bun can build for Bun", async () => {
		const root = await makeRoot();
		const console = new ConsoleKernel(new MemoryConsoleOutput());
		registerNewAppCommand(console, { root });

		expect(await console.run(["new", "demo", "--yes"])).toBe(0);

		const build = buildGeneratedServer(root, "demo");

		expect(build.exitCode).toBe(0);
	});
});

class FakePrompt implements NewAppPrompt {
	private readonly confirms: boolean[];
	private readonly selects: string[];

	constructor(
		private readonly answers: {
			readonly confirms: readonly boolean[];
			readonly features: readonly string[];
			readonly selects: readonly string[];
		},
	) {
		this.confirms = [...answers.confirms];
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
		return this.answers.features;
	}

	confirm(_message: string, defaultValue: boolean): boolean {
		const answer = this.confirms.shift();

		return answer ?? defaultValue;
	}
}

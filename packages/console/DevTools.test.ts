import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "../core/Config";
import { defineEnv, envVar } from "../core/EnvSchema";
import { Router } from "../http/Router";
import { k } from "../validation/Schema";
import { ConsoleKernel, MemoryConsoleOutput } from "./Console";
import { registerDevToolCommands } from "./DevTools";

const roots: string[] = [];
const previousEnv = new Map<string, string | undefined>();

afterEach(async () => {
	for (const [key, value] of previousEnv) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	previousEnv.clear();

	for (const root of roots.splice(0)) {
		await rm(root, { force: true, recursive: true });
	}
});

describe("dev tool console commands", () => {
	test("lists registered routes", async () => {
		const router = new Router();
		router.get("/", () => Response.json({ ok: true })).as("home");
		router
			.get("/users/:id", () => Response.json({ ok: true }))
			.as("users.show");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			loadRouter: () => router,
		});

		expect(await console.run(["routes"])).toBe(0);

		expect(output.text()).toContain("Routes");
		expect(output.text()).toContain("GET");
		expect(output.text()).toContain("/users/:id");
		expect(output.text()).toContain("users.show");
	});

	test("lists Bun static routes with registered routes", async () => {
		const router = new Router();
		router.get("/api/health", () => Response.json({ status: "up" }));
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			loadRouter: () => router,
			loadStaticRoutes: () => ({
				"/": new Response("home"),
			}),
		});

		expect(await console.run(["routes"])).toBe(0);

		expect(output.text()).toContain("GET");
		expect(output.text()).toContain("/");
		expect(output.text()).toContain("bun.static");
		expect(output.text()).toContain("/api/health");
	});

	test("prints routes as json", async () => {
		const router = new Router();
		router.get("/", () => Response.json({ ok: true })).as("home");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			loadRouter: () => router,
		});

		expect(await console.run(["route:list", "--json"])).toBe(0);

		expect(JSON.parse(output.text())).toEqual([
			{
				method: "GET",
				name: "home",
				params: [],
				path: "/",
			},
		]);
	});

	test("generates a typed API client from registered routes", async () => {
		const root = await makeRoot();
		const router = new Router();
		router
			.post("/users/:id", () => Response.json({ id: 1 }))
			.as("users.update")
			.schema({
				body: k.object({ email: k.string().email() }),
				params: k.object({ id: k.string() }),
				responses: {
					200: k.object({ id: k.number(), email: k.string() }),
				},
			});
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			root,
			loadRouter: () => router,
		});

		expect(await console.run(["client:generate"])).toBe(0);

		const generated = await readFile(
			join(root, "app/client/api_client.ts"),
			"utf8",
		);
		expect(output.text()).toContain("Kura client");
		expect(output.text()).toContain("app/client/api_client.ts");
		expect(generated).toContain("usersUpdate");
		expect(generated).toContain("export type UsersUpdateBody");
		expect(generated).toContain("id: number");
	});

	test("prints selected environment values and redacts secrets", async () => {
		setEnv("APP_NAME", "Kura");
		setEnv("APP_KEY", "local-development-key");
		setEnv("PORT", "3333");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console);

		expect(await console.run(["env"])).toBe(0);

		expect(output.text()).toContain("Environment");
		expect(output.text()).toContain("APP_NAME");
		expect(output.text()).toContain("Kura");
		expect(output.text()).toContain("APP_KEY");
		expect(output.text()).toContain("lo********ey");
	});

	test("prints schema environment values and redacts schema secrets", async () => {
		setEnv("APP_KEY", "local-development-key");
		setEnv("PORT", "3333");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			loadEnvSchema: () =>
				defineEnv({
					APP_KEY: envVar.secret(),
					DATABASE_URL: envVar.url().secret().optional(),
					PORT: envVar.number().default(3333),
				}),
		});

		expect(await console.run(["env"])).toBe(0);

		expect(output.text()).toContain("APP_KEY");
		expect(output.text()).toContain("lo********ey");
		expect(output.text()).toContain("DATABASE_URL");
		expect(output.text()).toContain("<missing>");
		expect(output.text()).toContain("PORT");
		expect(output.text()).toContain("3333");
	});

	test("prints config roots and dot-notation values", async () => {
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			loadConfig: () =>
				new Config({
					app: {
						name: "Kura",
						starter: {
							preset: "api",
						},
					},
				}),
		});

		expect(await console.run(["config"])).toBe(0);
		expect(await console.run(["config", "app.name"])).toBe(0);

		expect(output.text()).toContain("Config");
		expect(output.text()).toContain("app");
		expect(output.text()).toContain("app.name = Kura");
	});

	test("checks generated project health", async () => {
		const root = await makeRoot();
		await writeFile(join(root, "package.json"), "{}");
		await writeFile(join(root, ".env"), "APP_KEY=local-development-key");
		await writeFile(join(root, "tsconfig.json"), "{}");
		await mkdir(join(root, "config"));
		await mkdir(join(root, "node_modules"));
		setEnv("APP_KEY", "local-development-key");
		const router = new Router();
		router.get("/", () => Response.json({ ok: true })).as("home");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			root,
			loadRouter: () => router,
		});

		expect(await console.run(["doctor"])).toBe(0);

		expect(output.text()).toContain("Kura doctor");
		expect(output.text()).toContain("OK");
		expect(output.text()).toContain("1 route registered");
	});

	test("checks environment schema health for doctor and deploy doctor", async () => {
		const root = await makeRoot();
		await writeFile(join(root, "package.json"), "{}");
		await writeFile(join(root, ".env"), "APP_KEY=local-development-key");
		await writeFile(join(root, "tsconfig.json"), "{}");
		await mkdir(join(root, "config"));
		await mkdir(join(root, "node_modules"));
		setEnv("APP_KEY", "local-development-key");
		setEnv("APP_URL", "not-a-url");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			root,
			loadEnvSchema: () =>
				defineEnv({
					APP_KEY: envVar.secret(),
					APP_URL: envVar.url(),
				}),
		});

		expect(await console.run(["doctor"])).toBe(1);
		expect(await console.run(["deploy:doctor"])).toBe(1);

		expect(output.text()).toContain("env-schema");
		expect(output.text()).toContain(
			"invalid or missing environment variables: APP_URL",
		);
		expect(output.text()).not.toContain("local-development-key");
	});

	test("checks Docker deployment templates for deploy doctor", async () => {
		const root = await makeRoot();
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				scripts: {
					build: "bun build bin/server.ts --target=bun --production",
					preview: "bun bin/console.ts preview",
					start: "bun bin/console.ts serve --host 0.0.0.0",
				},
				dependencies: {
					kura: "^0.1.10",
				},
			}),
		);
		await writeFile(join(root, ".env"), "APP_KEY=local-development-key");
		await writeFile(join(root, "tsconfig.json"), "{}");
		await writeFile(
			join(root, "Dockerfile"),
			'CMD ["bun", "bin/console.ts", "preview", "--no-build", "--host", "0.0.0.0"]',
		);
		await writeFile(
			join(root, ".dockerignore"),
			[".env", "node_modules", "build", ""].join("\n"),
		);
		await mkdir(join(root, "config"));
		setEnv("APP_KEY", "local-development-key");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			root,
			loadConfig: () =>
				new Config({
					app: {
						starter: {
							database: "sqlite",
							auth: "none",
							cache: "file",
							queue: "none",
							modules: ["storage"],
						},
					},
				}),
		});

		expect(await console.run(["deploy:doctor"])).toBe(0);

		expect(output.text()).toContain("deploy:dockerfile");
		expect(output.text()).toContain("Dockerfile runs the built app");
		expect(output.text()).toContain("deploy:dockerignore");
		expect(output.text()).toContain("deploy:dependencies");
		expect(output.text()).toContain(
			"runtime dependencies are registry-compatible",
		);
		expect(output.text()).toContain("/app/database");
		expect(output.text()).toContain("/app/tmp");
		expect(output.text()).toContain("/app/storage");
	});

	test("checks named deployment targets", async () => {
		const root = await makeRoot();
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				scripts: {
					build: "bun build bin/server.ts --target=bun --production",
					preview: "bun bin/console.ts preview",
					start: "bun bin/console.ts serve --host 0.0.0.0",
				},
				dependencies: {
					kura: "^0.1.14",
				},
			}),
		);
		await writeFile(join(root, ".env"), "APP_KEY=local-development-key");
		await mkdir(join(root, "config"));
		setEnv("APP_KEY", "local-development-key");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, { root });

		expect(await console.run(["deploy:doctor", "--target", "railway"])).toBe(0);
		expect(await console.run(["deploy:doctor", "--target", "vercel"])).toBe(1);

		expect(output.text()).toContain("Railway deployment target selected");
		expect(output.text()).toContain("Vercel serverless/edge deployment needs");
	});

	test("fails deploy doctor for local runtime dependencies", async () => {
		const root = await makeRoot();
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				scripts: {
					build: "bun build bin/server.ts --target=bun --production",
					preview: "bun bin/console.ts preview",
					start: "bun bin/console.ts serve --host 0.0.0.0",
				},
				dependencies: {
					kura: "file:../kura/dist",
				},
			}),
		);
		await writeFile(join(root, ".env"), "APP_KEY=local-development-key");
		await writeFile(
			join(root, "Dockerfile"),
			'CMD ["bun", "bin/console.ts", "preview", "--no-build", "--host", "0.0.0.0"]',
		);
		await writeFile(
			join(root, ".dockerignore"),
			[".env", "node_modules", "build", ""].join("\n"),
		);
		setEnv("APP_KEY", "local-development-key");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			root,
		});

		expect(await console.run(["deploy:doctor"])).toBe(1);

		expect(output.text()).toContain("deploy:dependencies");
		expect(output.text()).toContain(
			"runtime dependencies use local paths: kura",
		);
	});

	test("checks HTTP/3 deployment prerequisites", async () => {
		const root = await makeRoot();
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				scripts: {
					build: "bun build bin/server.ts --target=bun --production",
					preview: "bun bin/console.ts preview",
					start: "bun bin/console.ts serve --host 0.0.0.0",
				},
				dependencies: {
					kura: "^0.1.14",
				},
			}),
		);
		await writeFile(
			join(root, ".env"),
			["APP_KEY=local-development-key", "HTTP3=true", ""].join("\n"),
		);
		setEnv("APP_KEY", "local-development-key");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, { root });

		expect(await console.run(["deploy:doctor"])).toBe(1);

		expect(output.text()).toContain("deploy:protocol");
		expect(output.text()).toContain("HTTP3=true requires TLS_CERT and TLS_KEY");
	});

	test("warns when HTTP/3 is configured for deployment", async () => {
		const root = await makeRoot();
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				scripts: {
					build: "bun build bin/server.ts --target=bun --production",
					preview: "bun bin/console.ts preview",
					start: "bun bin/console.ts serve --host 0.0.0.0",
				},
				dependencies: {
					kura: "^0.1.14",
				},
			}),
		);
		await writeFile(
			join(root, ".env"),
			[
				"APP_KEY=local-development-key",
				"HTTP3=true",
				"TLS_CERT=cert.pem",
				"TLS_KEY=key.pem",
				"",
			].join("\n"),
		);
		await mkdir(join(root, "config"));
		setEnv("APP_KEY", "local-development-key");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, { root });

		expect(await console.run(["deploy:doctor"])).toBe(0);

		expect(output.text()).toContain("deploy:protocol");
		expect(output.text()).toContain("HTTP/3 is enabled with TLS");
		expect(output.text()).toContain("UDP/QUIC");
	});

	test("warns about scaffold-only generated features", async () => {
		const root = await makeRoot();
		await writeFile(join(root, "package.json"), "{}");
		await writeFile(join(root, ".env"), "APP_KEY=local-development-key");
		await writeFile(join(root, "tsconfig.json"), "{}");
		await mkdir(join(root, "config"));
		setEnv("APP_KEY", "local-development-key");
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerDevToolCommands(console, {
			root,
			loadConfig: () =>
				new Config({
					app: {
						starter: {
							database: "postgres",
							auth: "session",
							cache: "redis",
							queue: "redis",
							modules: ["mail", "storage", "i18n", "websockets"],
						},
					},
				}),
		});

		expect(await console.run(["doctor"])).toBe(0);

		expect(output.text()).not.toContain("feature:database");
		expect(output.text()).not.toContain("config-only: Postgres config");
		expect(output.text()).toContain("feature:auth");
		expect(output.text()).toContain("starter: Session auth routes");
		expect(output.text()).toContain("feature:cache");
		expect(output.text()).toContain("Redis cache settings are scaffolded");
		expect(output.text()).toContain("feature:queue");
		expect(output.text()).toContain("Redis queue settings are scaffolded");
		expect(output.text()).toContain("feature:mail");
		expect(output.text()).toContain("feature:storage");
		expect(output.text()).toContain("feature:i18n");
		expect(output.text()).toContain("feature:websockets");
	});
});

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-devtools-"));
	roots.push(root);
	return root;
}

function setEnv(key: string, value: string): void {
	if (!previousEnv.has(key)) {
		previousEnv.set(key, process.env[key]);
	}
	process.env[key] = value;
}

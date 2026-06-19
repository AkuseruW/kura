import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "../core/Config";
import { Router } from "../http/Router";
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

		expect(output.text()).toContain("feature:database");
		expect(output.text()).toContain("config-only: Postgres config");
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

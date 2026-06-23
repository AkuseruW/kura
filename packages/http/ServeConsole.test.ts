import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleKernel, MemoryConsoleOutput } from "../console/Console";
import { createContext } from "./Context";
import { Router } from "./Router";
import {
	createPreviewCommand,
	createServeCommand,
	registerPreviewCommand,
	registerServeCommand,
	type ServeServerFactory,
	type ServeServerStartOptions,
	type ServeTarget,
	type ServeWatcherChange,
	type ServeWatcherFactory,
} from "./ServeConsole";

const roots: string[] = [];

function fakeServerFactory() {
	const starts: ServeServerStartOptions[] = [];
	const stopped: URL[] = [];
	const active = new Set<string>();

	const factory: ServeServerFactory = (options) => {
		const key = `${options.host}:${options.port}`;

		if (active.has(key)) {
			throw new Error(`Server already running on ${key}`);
		}

		active.add(key);
		starts.push(options);
		const url = new URL(`http://${options.host}:${options.port}/`);
		let running = true;

		return {
			url,
			stop: () => {
				if (!running) {
					return;
				}

				running = false;
				active.delete(key);
				stopped.push(url);
			},
		};
	};

	return { factory, starts, stopped };
}

function fakeClock(...timestamps: number[]): () => number {
	let index = 0;

	return () => {
		const value = timestamps[Math.min(index, timestamps.length - 1)] ?? 0;
		index += 1;

		return value;
	};
}

function testContext(url: string, init?: RequestInit) {
	return createContext(new Request(url, init));
}

function serverStartedOutput(options: {
	readonly url: string;
	readonly banner?: string;
	readonly entry?: string;
	readonly root?: string;
	readonly mode?: string;
	readonly watch?: boolean;
	readonly duration?: number;
	readonly keepAlive?: boolean;
}): string {
	const lines = [
		options.banner ?? "Kura server started",
		"",
		"  Server",
		`  URL     ${options.url}`,
		`  Entry   ${options.entry ?? "server.ts"}`,
		`  Root    ${options.root ?? process.cwd()}`,
		`  Mode    ${options.mode ?? "testing"}`,
		`  Watch   ${options.watch === true ? "enabled" : "disabled"}`,
		"",
		`Ready in ${options.duration ?? 42}ms`,
	];

	if (options.keepAlive !== false) {
		lines.push(
			options.watch === true
				? "Watching for changes. Press Ctrl+C to stop."
				: "Press Ctrl+C to stop.",
		);
	}

	return lines.join("\n");
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-preview-"));
	roots.push(root);
	return root;
}

describe("serve console command", () => {
	test("registers the serve command", () => {
		const console = new ConsoleKernel(new MemoryConsoleOutput());

		registerServeCommand(console, {
			handler: () => new Response("ok"),
			serverFactory: fakeServerFactory().factory,
			keepAlive: false,
		});

		expect(console.list().map((command) => command.name)).toEqual(["serve"]);
	});

	test("registers the preview command", () => {
		const console = new ConsoleKernel(new MemoryConsoleOutput());

		registerPreviewCommand(console, {
			handler: () => new Response("ok"),
			serverFactory: fakeServerFactory().factory,
			keepAlive: false,
		});

		expect(console.list().map((command) => command.name)).toEqual(["preview"]);
	});

	test("starts a development server with configured host and port", async () => {
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		const fake = fakeServerFactory();
		console.register(
			createServeCommand({
				handler: () => new Response("ok"),
				serverFactory: fake.factory,
				keepAlive: false,
				clock: fakeClock(0, 42),
				environment: "testing",
			}),
		);

		const exitCode = await console.run([
			"serve",
			"--host",
			"0.0.0.0",
			"--port",
			"8080",
		]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe(
			serverStartedOutput({
				url: "http://0.0.0.0:8080/",
				keepAlive: false,
			}),
		);
		expect(fake.starts).toHaveLength(1);
		const response = await fake.starts[0]?.handler(
			testContext("http://localhost"),
		);
		expect(await response?.text()).toBe("ok");
	});

	test("starts with explicit HTTP/3 and TLS options", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		const fake = fakeServerFactory();
		console.register(
			createServeCommand({
				root,
				handler: () => new Response("ok"),
				serverFactory: fake.factory,
				keepAlive: false,
				clock: fakeClock(0, 42),
				environment: "testing",
			}),
		);

		const exitCode = await console.run([
			"serve",
			"--http3",
			"--no-http1",
			"--tls-cert",
			"cert.pem",
			"--tls-key",
			"key.pem",
		]);

		expect(exitCode).toBe(0);
		expect(fake.starts).toHaveLength(1);
		expect(fake.starts[0]?.http3).toBe(true);
		expect(fake.starts[0]?.http1).toBe(false);
		expect(fake.starts[0]?.tls).toBeDefined();
		expect(output.text()).toContain("HTTP/3  enabled, HTTP/1.1 disabled");
	});

	test("rejects HTTP/3 without TLS options", async () => {
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		console.register(
			createServeCommand({
				handler: () => new Response("ok"),
				serverFactory: fakeServerFactory().factory,
				keepAlive: false,
			}),
		);

		const exitCode = await console.run(["serve", "--http3"]);

		expect(exitCode).toBe(1);
		expect(output.errorText()).toBe(
			"HTTP/3 requires TLS. Set TLS_CERT and TLS_KEY or pass --tls-cert and --tls-key.",
		);
	});

	test("logs HTTP requests by default", async () => {
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		const fake = fakeServerFactory();
		registerServeCommand(console, {
			handler: () => new Response("docs", { status: 200 }),
			serverFactory: fake.factory,
			keepAlive: false,
			clock: fakeClock(0, 7, 20, 23),
			environment: "testing",
		});

		expect(await console.run(["serve"])).toBe(0);

		const response = await fake.starts[0]?.handler(
			testContext("http://localhost/docs?ui=scalar", {
				method: "GET",
			}),
		);

		expect(response?.status).toBe(200);
		expect(output.text()).toContain("GET /docs?ui=scalar 200 3ms");
	});

	test("renders handler errors through the configured error handler", async () => {
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		const fake = fakeServerFactory();
		registerServeCommand(console, {
			handler: () => {
				throw new Error("boom");
			},
			errorHandler: {
				render: (_error, normalized) =>
					Response.json(
						{ code: normalized.code, handled: true },
						{ status: normalized.status },
					),
			},
			serverFactory: fake.factory,
			keepAlive: false,
			clock: fakeClock(0, 7, 20, 23),
			environment: "testing",
		});

		expect(await console.run(["serve"])).toBe(0);

		const response = await fake.starts[0]?.handler(
			testContext("http://localhost/fail", {
				method: "GET",
			}),
		);

		if (!response) {
			throw new Error("Expected fake server response");
		}

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			code: "E_INTERNAL_SERVER_ERROR",
			handled: true,
		});
		expect(output.text()).toContain("GET /fail 500 3ms");
	});

	test("can disable HTTP request logs", async () => {
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		const fake = fakeServerFactory();
		registerServeCommand(console, {
			handler: () => new Response("docs", { status: 200 }),
			serverFactory: fake.factory,
			keepAlive: false,
			clock: fakeClock(0, 7, 20, 23),
			environment: "testing",
		});

		expect(await console.run(["serve", "--no-request-log"])).toBe(0);

		const response = await fake.starts[0]?.handler(
			testContext("http://localhost/docs", { method: "GET" }),
		);

		expect(response?.status).toBe(200);
		expect(output.text()).not.toContain("GET /docs 200");
	});

	test("uses PORT from the environment as the default port", async () => {
		const previousPort = Bun.env.PORT;
		Bun.env.PORT = "4444";

		try {
			const output = new MemoryConsoleOutput();
			const console = new ConsoleKernel(output);
			const fake = fakeServerFactory();
			registerServeCommand(console, {
				handler: () => new Response("ok"),
				serverFactory: fake.factory,
				keepAlive: false,
				clock: fakeClock(0, 42),
				environment: "testing",
			});

			expect(await console.run(["serve"])).toBe(0);
			expect(output.text()).toBe(
				serverStartedOutput({
					url: "http://127.0.0.1:4444/",
					keepAlive: false,
				}),
			);
		} finally {
			if (previousPort === undefined) {
				delete Bun.env.PORT;
			} else {
				Bun.env.PORT = previousPort;
			}
		}
	});

	test("serves a router target", async () => {
		const output = new MemoryConsoleOutput();
		const router = new Router();
		router.get("/users/:id", (ctx) => new Response(ctx.params?.id));
		const fake = fakeServerFactory();
		const console = new ConsoleKernel(output);
		registerServeCommand(console, {
			router,
			serverFactory: fake.factory,
			keepAlive: false,
			clock: fakeClock(0, 42),
			environment: "testing",
		});

		expect(await console.run(["serve"])).toBe(0);
		const response = await fake.starts[0]?.handler(
			testContext("http://localhost/users/42", { method: "GET" }),
		);

		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("42");
	});

	test("loads a handler from an entry module", async () => {
		const output = new MemoryConsoleOutput();
		const fake = fakeServerFactory();
		const loadedEntries: string[] = [];
		const console = new ConsoleKernel(output);
		registerServeCommand(console, {
			root: "/project",
			entry: "src/server.ts",
			loader: async (entry): Promise<ServeTarget> => {
				loadedEntries.push(entry);
				return {
					handler: () => new Response("loaded"),
				};
			},
			serverFactory: fake.factory,
			keepAlive: false,
			clock: fakeClock(0, 42),
			environment: "testing",
		});

		expect(await console.run(["serve"])).toBe(0);
		expect(loadedEntries).toEqual(["/project/src/server.ts"]);
		const response = await fake.starts[0]?.handler(
			testContext("http://localhost"),
		);
		expect(await response?.text()).toBe("loaded");
	});

	test("starts a production preview from a built entry module", async () => {
		const root = await makeRoot();
		await mkdir(join(root, "build"), { recursive: true });
		await writeFile(join(root, "build/server.js"), "");
		const previousNodeEnv = Bun.env.NODE_ENV;
		const previousCwd = process.cwd();
		const previewCwd = await realpath(join(root, "build"));
		Bun.env.NODE_ENV = "development";
		const output = new MemoryConsoleOutput();
		const fake = fakeServerFactory();
		const loadedEntries: string[] = [];
		const console = new ConsoleKernel(output);
		console.register(
			createPreviewCommand({
				root,
				loader: async (entry): Promise<ServeTarget> => {
					loadedEntries.push(entry);
					expect(Bun.env.NODE_ENV).toBe("production");
					expect(await realpath(process.cwd())).toBe(previewCwd);
					return {
						handler: () => new Response("preview"),
					};
				},
				serverFactory: fake.factory,
				keepAlive: false,
				clock: fakeClock(0, 42),
				color: false,
			}),
		);

		try {
			expect(await console.run(["preview"])).toBe(0);
		} finally {
			if (previousNodeEnv === undefined) {
				delete Bun.env.NODE_ENV;
			} else {
				Bun.env.NODE_ENV = previousNodeEnv;
			}
		}

		expect(loadedEntries).toEqual([join(root, "build/server.js")]);
		expect(await realpath(process.cwd())).toBe(await realpath(previousCwd));
		expect(output.text()).toBe(
			serverStartedOutput({
				banner: "Kura production preview started",
				url: "http://127.0.0.1:3333/",
				entry: "build/server.js",
				root,
				mode: "production",
				keepAlive: false,
			}),
		);
		expect(Bun.env.NODE_ENV).toBe(previousNodeEnv);
		const response = await fake.starts[0]?.handler(
			testContext("http://localhost"),
		);
		expect(await response?.text()).toBe("preview");
	});

	test("builds before preview when the production entry is missing", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const fake = fakeServerFactory();
		const buildCommands: string[][] = [];
		const console = new ConsoleKernel(output);
		registerPreviewCommand(console, {
			root,
			buildRunner: async ({ command, root: buildRoot }) => {
				buildCommands.push([...command]);
				await mkdir(join(buildRoot, "build"), { recursive: true });
				await writeFile(join(buildRoot, "build/server.js"), "");
			},
			loader: async (): Promise<ServeTarget> => () => new Response("built"),
			serverFactory: fake.factory,
			keepAlive: false,
			clock: fakeClock(0, 42),
			color: false,
		});

		expect(await console.run(["preview"])).toBe(0);

		expect(buildCommands).toEqual([[process.execPath, "run", "build"]]);
		expect(output.text()).toContain(
			"Production build not found. Running bun run build...",
		);
		expect(output.text()).toContain("Kura production preview started");
	});

	test("fails preview clearly when build is disabled and the entry is missing", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerPreviewCommand(console, {
			root,
			serverFactory: fakeServerFactory().factory,
			keepAlive: false,
		});

		expect(await console.run(["preview", "--no-build"])).toBe(1);

		expect(output.errorText()).toBe(
			"Production preview entry [build/server.js] was not found. Run bun run build before preview.",
		);
	});

	test("loads Bun static routes and development options from an entry module", async () => {
		const output = new MemoryConsoleOutput();
		const fake = fakeServerFactory();
		const staticRoutes = {
			"/": new Response("home"),
		};
		const console = new ConsoleKernel(output);
		registerServeCommand(console, {
			root: "/project",
			entry: "bin/server.ts",
			loader: async (): Promise<ServeTarget> => ({
				default: () => new Response("fallback"),
				staticRoutes,
				development: {
					hmr: true,
					console: true,
				},
			}),
			serverFactory: fake.factory,
			keepAlive: false,
			clock: fakeClock(0, 42),
			environment: "testing",
		});

		expect(await console.run(["serve"])).toBe(0);
		expect(fake.starts[0]?.staticRoutes).toBe(staticRoutes);
		expect(fake.starts[0]?.development).toEqual({
			hmr: true,
			console: true,
		});
		const response = await fake.starts[0]?.handler(
			testContext("http://localhost"),
		);

		expect(await response?.text()).toBe("fallback");
	});

	test("rejects invalid ports", async () => {
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerServeCommand(console, {
			handler: () => new Response("ok"),
			serverFactory: fakeServerFactory().factory,
			keepAlive: false,
		});

		const exitCode = await console.run(["serve", "--port", "99999"]);

		expect(exitCode).toBe(1);
		expect(output.errorText()).toBe(
			"Option [port] must be an integer between 1 and 65535",
		);
	});

	test("reloads the server when watch mode receives changes", async () => {
		const output = new MemoryConsoleOutput();
		const fake = fakeServerFactory();
		let onChange:
			| ((change?: ServeWatcherChange) => void | Promise<void>)
			| undefined;
		const watcherFactory: ServeWatcherFactory = (_root, callback) => {
			onChange = callback;
			return { close: () => undefined };
		};
		let loadCount = 0;
		const console = new ConsoleKernel(output);
		registerServeCommand(console, {
			root: "/project",
			loader: async (): Promise<ServeTarget> => {
				loadCount += 1;
				const body = `loaded:${loadCount}`;
				return () => new Response(body);
			},
			serverFactory: fake.factory,
			watcherFactory,
			keepAlive: false,
			clock: fakeClock(0, 20, 100, 118),
			environment: "testing",
		});

		expect(await console.run(["serve", "--watch"])).toBe(0);
		expect(fake.starts).toHaveLength(1);

		await onChange?.({ path: "start/routes.ts" });

		expect(fake.starts).toHaveLength(2);
		expect(fake.stopped).toEqual([new URL("http://127.0.0.1:3333/")]);
		expect(output.text()).toBe(
			[
				serverStartedOutput({
					url: "http://127.0.0.1:3333/",
					root: "/project",
					watch: true,
					duration: 20,
					keepAlive: false,
				}),
				"Change detected: start/routes.ts\nReloaded in 18ms\n\n  URL     http://127.0.0.1:3333/",
			].join("\n"),
		);
		const response = await fake.starts[1]?.handler(
			testContext("http://localhost"),
		);
		expect(await response?.text()).toBe("loaded:2");
	});

	test("reports reload failures without starting a replacement server", async () => {
		const output = new MemoryConsoleOutput();
		const fake = fakeServerFactory();
		let onChange:
			| ((change?: ServeWatcherChange) => void | Promise<void>)
			| undefined;
		const watcherFactory: ServeWatcherFactory = (_root, callback) => {
			onChange = callback;
			return { close: () => undefined };
		};
		let loadCount = 0;
		const console = new ConsoleKernel(output);
		registerServeCommand(console, {
			root: "/project",
			entry: "bin/server.ts",
			loader: async (): Promise<ServeTarget> => {
				loadCount += 1;

				if (loadCount > 1) {
					throw new Error('Cannot find module "#start/routes"');
				}

				return () => new Response("ok");
			},
			serverFactory: fake.factory,
			watcherFactory,
			keepAlive: false,
			clock: fakeClock(0, 12, 100, 118),
			environment: "testing",
		});

		expect(await console.run(["serve", "--watch"])).toBe(0);

		await onChange?.({ path: "start/routes.ts" });

		expect(fake.starts).toHaveLength(1);
		expect(fake.stopped).toEqual([new URL("http://127.0.0.1:3333/")]);
		expect(output.text()).toBe(
			[
				serverStartedOutput({
					url: "http://127.0.0.1:3333/",
					entry: "bin/server.ts",
					root: "/project",
					watch: true,
					duration: 12,
					keepAlive: false,
				}),
				[
					"Reload failed",
					"",
					"  Entry   bin/server.ts",
					'  Error   Cannot find module "#start/routes"',
					"",
					"Fix the error and save a file to retry.",
				].join("\n"),
			].join("\n"),
		);
	});
});

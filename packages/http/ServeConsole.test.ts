import { describe, expect, test } from "bun:test";
import { ConsoleKernel, MemoryConsoleOutput } from "../console/Console";
import { createContext } from "./Context";
import { Router } from "./Router";
import {
	createServeCommand,
	registerServeCommand,
	type ServeServerFactory,
	type ServeServerStartOptions,
	type ServeTarget,
	type ServeWatcherChange,
	type ServeWatcherFactory,
} from "./ServeConsole";

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
	readonly entry?: string;
	readonly root?: string;
	readonly mode?: string;
	readonly watch?: boolean;
	readonly duration?: number;
	readonly keepAlive?: boolean;
}): string {
	const lines = [
		"Kura server started",
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

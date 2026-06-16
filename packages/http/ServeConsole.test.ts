import { describe, expect, test } from "bun:test";
import { ConsoleKernel, MemoryConsoleOutput } from "../console/Console";
import { Router } from "./Router";
import {
	createServeCommand,
	registerServeCommand,
	type ServeServerFactory,
	type ServeServerStartOptions,
	type ServeTarget,
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
		expect(output.text()).toBe("Server running at http://0.0.0.0:8080/");
		expect(fake.starts).toHaveLength(1);
		const response = await fake.starts[0]?.handler({
			request: new Request("http://localhost"),
		});
		expect(await response?.text()).toBe("ok");
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
			});

			expect(await console.run(["serve"])).toBe(0);
			expect(output.text()).toBe("Server running at http://127.0.0.1:4444/");
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
		});

		expect(await console.run(["serve"])).toBe(0);
		const response = await fake.starts[0]?.handler({
			request: new Request("http://localhost/users/42", { method: "GET" }),
		});

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
		});

		expect(await console.run(["serve"])).toBe(0);
		expect(loadedEntries).toEqual(["/project/src/server.ts"]);
		const response = await fake.starts[0]?.handler({
			request: new Request("http://localhost"),
		});
		expect(await response?.text()).toBe("loaded");
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
		let onChange: (() => void | Promise<void>) | undefined;
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
		});

		expect(await console.run(["serve", "--watch"])).toBe(0);
		expect(fake.starts).toHaveLength(1);

		await onChange?.();

		expect(fake.starts).toHaveLength(2);
		expect(fake.stopped).toEqual([new URL("http://127.0.0.1:3333/")]);
		expect(output.text()).toBe(
			[
				"Server running at http://127.0.0.1:3333/ with watch",
				"Reloaded server at http://127.0.0.1:3333/",
			].join("\n"),
		);
		const response = await fake.starts[1]?.handler({
			request: new Request("http://localhost"),
		});
		expect(await response?.text()).toBe("loaded:2");
	});
});

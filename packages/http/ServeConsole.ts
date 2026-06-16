import { watch } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type Command,
	type ConsoleKernel,
	type ConsoleOptions,
	defineCommand,
} from "../console/Console";
import { BaseException } from "../core/BaseException";
import type { Router } from "./Router";
import type { Context } from "./Server";

export type ServeHandler = (ctx: Context) => Response | Promise<Response>;

export interface ServeConsoleOptions {
	readonly root?: string;
	readonly entry?: string;
	readonly host?: string;
	readonly port?: number;
	readonly handler?: ServeHandler;
	readonly router?: Router;
	readonly loader?: ServeEntryLoader;
	readonly serverFactory?: ServeServerFactory;
	readonly watcherFactory?: ServeWatcherFactory;
	readonly keepAlive?: boolean;
}

export type ServeEntryLoader = (
	entry: string,
	cacheKey: string,
) => Promise<ServeTarget>;

export type ServeTarget =
	| ServeHandler
	| Router
	| {
			readonly default?: unknown;
			readonly handler?: unknown;
			readonly router?: unknown;
	  };

export interface ServeServer {
	readonly url: URL;
	stop(): void;
}

export interface ServeServerStartOptions {
	readonly host: string;
	readonly port: number;
	readonly handler: ServeHandler;
}

export type ServeServerFactory = (
	options: ServeServerStartOptions,
) => ServeServer;

export interface ServeWatcher {
	close(): void;
}

export type ServeWatcherFactory = (
	root: string,
	onChange: () => void | Promise<void>,
) => ServeWatcher;

export function createServeCommand(options: ServeConsoleOptions = {}): Command {
	return defineCommand(
		{
			name: "serve",
			description: "Start the development HTTP server",
			options: [
				{
					name: "host",
					value: "string",
					default: options.host ?? "127.0.0.1",
					description: "Host to bind",
				},
				{
					name: "port",
					alias: "p",
					value: "string",
					default: String(options.port ?? 3333),
					description: "Port to bind",
				},
				{
					name: "entry",
					alias: "e",
					value: "string",
					default: options.entry ?? "server.ts",
					description: "Server entry module",
				},
				{
					name: "root",
					alias: "r",
					value: "string",
					default: options.root ?? process.cwd(),
					description: "Project root directory",
				},
				{
					name: "watch",
					alias: "w",
					description: "Reload the server when project files change",
				},
			],
		},
		async (context) => {
			const config = resolveServeConfig(options, context.options);
			const runtime = await startDevServer(
				config,
				context.output.write.bind(context.output),
			);

			if (!config.watch) {
				context.output.write(`Server running at ${runtime.server.url}`);
			} else {
				context.output.write(
					`Server running at ${runtime.server.url} with watch`,
				);
			}

			if (options.keepAlive === false) {
				return;
			}

			await waitForShutdown(runtime);
		},
	);
}

export function registerServeCommand(
	console: ConsoleKernel,
	options: ServeConsoleOptions = {},
): ConsoleKernel {
	console.register(createServeCommand(options));

	return console;
}

type ServeConfig = {
	readonly root: string;
	readonly entry: string;
	readonly host: string;
	readonly port: number;
	readonly watch: boolean;
	readonly explicitHandler?: ServeHandler;
	readonly explicitRouter?: Router;
	readonly loader: ServeEntryLoader;
	readonly serverFactory: ServeServerFactory;
	readonly watcherFactory: ServeWatcherFactory;
};

type ServeRuntime = {
	server: ServeServer;
	watcher?: ServeWatcher;
};

async function startDevServer(
	config: ServeConfig,
	write: (message: string) => void,
): Promise<ServeRuntime> {
	let server = config.serverFactory({
		host: config.host,
		port: config.port,
		handler: await resolveHandler(config, Date.now().toString()),
	});
	let reloading = false;
	const runtime: ServeRuntime = { server };

	if (config.watch) {
		runtime.watcher = config.watcherFactory(config.root, async () => {
			if (reloading) {
				return;
			}

			reloading = true;
			try {
				const nextHandler = await resolveHandler(config, Date.now().toString());
				server.stop();
				const nextServer = config.serverFactory({
					host: config.host,
					port: config.port,
					handler: nextHandler,
				});
				server = nextServer;
				runtime.server = nextServer;
				write(`Reloaded server at ${nextServer.url}`);
			} finally {
				reloading = false;
			}
		});
	}

	return runtime;
}

function resolveServeConfig(
	options: ServeConsoleOptions,
	consoleOptions: ConsoleOptions,
): ServeConfig {
	const root = resolveRoot(
		readStringOption(consoleOptions, "root") ?? options.root,
	);
	const entry = resolveEntry(
		root,
		readStringOption(consoleOptions, "entry") ?? options.entry ?? "server.ts",
	);
	const port = parsePort(readStringOption(consoleOptions, "port"));
	const host =
		readStringOption(consoleOptions, "host") ?? options.host ?? "127.0.0.1";

	return {
		root,
		entry,
		host,
		port,
		watch: isEnabled(consoleOptions, "watch"),
		explicitHandler: options.handler,
		explicitRouter: options.router,
		loader: options.loader ?? loadServeEntry,
		serverFactory: options.serverFactory ?? createBunServer,
		watcherFactory: options.watcherFactory ?? createNodeWatcher,
	};
}

async function resolveHandler(
	config: ServeConfig,
	cacheKey: string,
): Promise<ServeHandler> {
	if (config.explicitHandler) {
		return config.explicitHandler;
	}

	if (config.explicitRouter) {
		return handlerFromRouter(config.explicitRouter);
	}

	return handlerFromTarget(await config.loader(config.entry, cacheKey));
}

async function loadServeEntry(
	entry: string,
	cacheKey: string,
): Promise<ServeTarget> {
	const url = pathToFileURL(entry);
	url.searchParams.set("t", cacheKey);

	return (await import(url.href)) as ServeTarget;
}

function handlerFromTarget(target: ServeTarget): ServeHandler {
	if (typeof target === "function") {
		return target;
	}

	if (isRouter(target)) {
		return handlerFromRouter(target);
	}

	if (isRecord(target)) {
		if (typeof target.handler === "function") {
			return target.handler as ServeHandler;
		}

		if (isRouter(target.router)) {
			return handlerFromRouter(target.router);
		}

		if (typeof target.default === "function") {
			return target.default as ServeHandler;
		}

		if (isRouter(target.default)) {
			return handlerFromRouter(target.default);
		}

		if (isRecord(target.default)) {
			return handlerFromTarget(target.default);
		}
	}

	throw new Error(
		"Serve entry must export a handler, router, or default handler/router",
	);
}

function handlerFromRouter(router: Router): ServeHandler {
	return async (ctx) => {
		const url = new URL(ctx.request.url);
		const match = router.match(ctx.request.method, url.pathname);

		if (!match) {
			return new Response("Not Found", { status: 404 });
		}

		ctx.params = match.params;
		return match.handler(ctx);
	};
}

function createBunServer(options: ServeServerStartOptions): ServeServer {
	const server = Bun.serve({
		hostname: options.host,
		port: options.port,
		fetch: async (request) => {
			try {
				return await options.handler({ request });
			} catch (error) {
				if (error instanceof BaseException) {
					return new Response(
						JSON.stringify({ code: error.code, error: error.message }),
						{
							status: error.status,
							headers: { "Content-Type": "application/json" },
						},
					);
				}

				return new Response("Internal Server Error", { status: 500 });
			}
		},
	});

	return {
		url: server.url,
		stop: () => server.stop(),
	};
}

function createNodeWatcher(
	root: string,
	onChange: () => void | Promise<void>,
): ServeWatcher {
	const watcher = watch(root, { recursive: true }, () => {
		void onChange();
	});

	return {
		close: () => watcher.close(),
	};
}

function waitForShutdown(runtime: ServeRuntime): Promise<void> {
	return new Promise((resolveShutdown) => {
		const shutdown = () => {
			process.off("SIGINT", shutdown);
			process.off("SIGTERM", shutdown);
			runtime.watcher?.close();
			runtime.server.stop();
			resolveShutdown();
		};

		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	});
}

function resolveRoot(root: string | undefined): string {
	const value = root ?? process.cwd();

	return isAbsolute(value) ? value : resolve(value);
}

function resolveEntry(root: string, entry: string): string {
	return isAbsolute(entry) ? entry : resolve(root, entry);
}

function parsePort(value: string | undefined): number {
	const port = Number(value ?? "3333");

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("Option [port] must be an integer between 1 and 65535");
	}

	return port;
}

function readStringOption(
	options: ConsoleOptions,
	name: string,
): string | undefined {
	const value = options[name];

	if (Array.isArray(value)) {
		return value.at(-1);
	}

	if (typeof value === "string") {
		return value;
	}

	return undefined;
}

function isEnabled(options: ConsoleOptions, name: string): boolean {
	return options[name] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isRouter(value: unknown): value is Router {
	return (
		isRecord(value) && "match" in value && typeof value.match === "function"
	);
}

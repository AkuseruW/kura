import { watch } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type Command,
	type ConsoleKernel,
	type ConsoleOptions,
	defineCommand,
} from "../console/Console";
import { BaseException } from "../core/BaseException";
import { createContext } from "./Context";
import { KuraResponse } from "./Response";
import type { Router } from "./Router";
import type {
	BunDevelopmentOptions,
	BunStaticRouteMap,
	Context,
} from "./Server";

export type ServeHandler = (ctx: Context) => Response | Promise<Response>;

export interface ServeConsoleOptions {
	readonly root?: string;
	readonly entry?: string;
	readonly host?: string;
	readonly port?: number;
	readonly environment?: string;
	readonly handler?: ServeHandler;
	readonly router?: Router;
	readonly staticRoutes?: BunStaticRouteMap;
	readonly development?: BunDevelopmentOptions;
	readonly loader?: ServeEntryLoader;
	readonly serverFactory?: ServeServerFactory;
	readonly watcherFactory?: ServeWatcherFactory;
	readonly keepAlive?: boolean;
	readonly clock?: ServeClock;
	readonly color?: boolean;
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
			readonly development?: unknown;
			readonly handler?: unknown;
			readonly router?: unknown;
			readonly routes?: unknown;
			readonly staticRoutes?: unknown;
	  };

export type ResolvedServeTarget = {
	readonly handler: ServeHandler;
	readonly staticRoutes?: BunStaticRouteMap;
	readonly development?: BunDevelopmentOptions;
};

export interface ServeServer {
	readonly url: URL;
	stop(): void;
}

export interface ServeServerStartOptions {
	readonly host: string;
	readonly port: number;
	readonly handler: ServeHandler;
	readonly staticRoutes?: BunStaticRouteMap;
	readonly development?: BunDevelopmentOptions;
}

export type ServeServerFactory = (
	options: ServeServerStartOptions,
) => ServeServer;

export interface ServeWatcher {
	close(): void;
}

export interface ServeWatcherChange {
	readonly path?: string;
}

export type ServeWatcherFactory = (
	root: string,
	onChange: (change?: ServeWatcherChange) => void | Promise<void>,
) => ServeWatcher;

export type ServeClock = () => number;

export function createServeCommand(options: ServeConsoleOptions = {}): Command {
	const defaultPort = options.port ?? readEnvPort() ?? 3333;

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
					default: String(defaultPort),
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
				{
					name: "request-log",
					default: true,
					description: "Log HTTP requests",
				},
			],
		},
		async (context) => {
			const config = resolveServeConfig(options, context.options);
			const startedAt = config.clock();
			const runtime = await startDevServer(
				config,
				context.output.write.bind(context.output),
			);
			const duration = elapsedMilliseconds(startedAt, config.clock());

			context.output.write(formatServerStarted(config, runtime, duration));

			if (options.keepAlive === false) {
				runtime.watcher?.close();
				runtime.server.stop();
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
	readonly requestLog: boolean;
	readonly keepAlive: boolean;
	readonly environment: string;
	readonly color: boolean;
	readonly clock: ServeClock;
	readonly explicitHandler?: ServeHandler;
	readonly explicitRouter?: Router;
	readonly explicitStaticRoutes?: BunStaticRouteMap;
	readonly explicitDevelopment?: BunDevelopmentOptions;
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
	let target = await resolveTarget(config, Date.now().toString());
	let server = config.serverFactory({
		host: config.host,
		port: config.port,
		handler: withRequestLogging(target.handler, config, write),
		staticRoutes: target.staticRoutes,
		development: target.development,
	});
	let reloading = false;
	const runtime: ServeRuntime = { server };

	if (config.watch) {
		runtime.watcher = config.watcherFactory(config.root, async (change) => {
			if (reloading) {
				return;
			}

			reloading = true;
			const startedAt = config.clock();
			try {
				target = await resolveTarget(config, Date.now().toString());
				server.stop();
				const nextServer = config.serverFactory({
					host: config.host,
					port: config.port,
					handler: withRequestLogging(target.handler, config, write),
					staticRoutes: target.staticRoutes,
					development: target.development,
				});
				server = nextServer;
				runtime.server = nextServer;
				write(
					formatServerReloaded(
						config,
						runtime,
						change,
						elapsedMilliseconds(startedAt, config.clock()),
					),
				);
			} catch (error) {
				write(formatServerReloadFailed(config, error));
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
		requestLog: consoleOptions["request-log"] !== false,
		keepAlive: options.keepAlive !== false,
		environment: options.environment ?? Bun.env.NODE_ENV ?? "development",
		color: options.color ?? shouldUseColor(),
		clock: options.clock ?? Date.now,
		explicitHandler: options.handler,
		explicitRouter: options.router,
		explicitStaticRoutes: options.staticRoutes,
		explicitDevelopment: options.development,
		loader: options.loader ?? loadServeEntry,
		serverFactory: options.serverFactory ?? createBunServer,
		watcherFactory: options.watcherFactory ?? createNodeWatcher,
	};
}

function withRequestLogging(
	handler: ServeHandler,
	config: ServeConfig,
	write: (message: string) => void,
): ServeHandler {
	if (!config.requestLog) {
		return handler;
	}

	return async (ctx) => {
		const startedAt = config.clock();
		let status = 500;

		try {
			const response = await handler(ctx);
			status = response.status;
			return response;
		} catch (error) {
			status = error instanceof BaseException ? error.status : 500;
			throw error;
		} finally {
			write(
				formatRequestLog(
					ctx.request,
					status,
					elapsedMilliseconds(startedAt, config.clock()),
				),
			);
		}
	};
}

async function resolveTarget(
	config: ServeConfig,
	cacheKey: string,
): Promise<ResolvedServeTarget> {
	if (config.explicitHandler) {
		return {
			handler: config.explicitHandler,
			staticRoutes: config.explicitStaticRoutes,
			development: config.explicitDevelopment,
		};
	}

	if (config.explicitRouter) {
		return {
			handler: handlerFromRouter(config.explicitRouter),
			staticRoutes: config.explicitStaticRoutes,
			development: config.explicitDevelopment,
		};
	}

	const target = await config.loader(config.entry, cacheKey);

	return {
		handler: handlerFromTarget(target),
		staticRoutes: staticRoutesFromTarget(target) ?? config.explicitStaticRoutes,
		development: developmentFromTarget(target) ?? config.explicitDevelopment,
	};
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

function staticRoutesFromTarget(
	target: ServeTarget,
): BunStaticRouteMap | undefined {
	if (!isRecord(target) || isRouter(target)) {
		return undefined;
	}

	if (isBunStaticRouteMap(target.staticRoutes)) {
		return target.staticRoutes;
	}

	if (isBunStaticRouteMap(target.routes)) {
		return target.routes;
	}

	if (isRecord(target.default)) {
		return staticRoutesFromTarget(target.default as ServeTarget);
	}

	return undefined;
}

function developmentFromTarget(
	target: ServeTarget,
): BunDevelopmentOptions | undefined {
	if (!isRecord(target)) {
		return undefined;
	}

	if (isBunDevelopmentOptions(target.development)) {
		return target.development;
	}

	if (isRecord(target.default)) {
		return developmentFromTarget(target.default as ServeTarget);
	}

	return undefined;
}

function handlerFromRouter(router: Router): ServeHandler {
	return (ctx) => router.dispatch(ctx);
}

function createBunServer(options: ServeServerStartOptions): ServeServer {
	const server = Bun.serve({
		hostname: options.host,
		port: options.port,
		routes: options.staticRoutes,
		development: options.development,
		fetch: async (request) => {
			try {
				return await options.handler(createContext(request));
			} catch (error) {
				if (error instanceof BaseException) {
					return KuraResponse.exception(error);
				}

				return KuraResponse.internalServerError();
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
	onChange: (change?: ServeWatcherChange) => void | Promise<void>,
): ServeWatcher {
	const watcher = watch(root, { recursive: true }, (_event, filename) => {
		const changedPath =
			filename === null || filename === undefined
				? undefined
				: filename.toString();

		if (changedPath !== undefined && shouldIgnoreWatchPath(changedPath)) {
			return;
		}

		void onChange(
			changedPath === undefined ? undefined : { path: changedPath },
		);
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

function readEnvPort(): number | undefined {
	const value = Bun.env.PORT;

	return value === undefined || value === "" ? undefined : Number(value);
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

function isBunStaticRouteMap(value: unknown): value is BunStaticRouteMap {
	return isRecord(value);
}

function isBunDevelopmentOptions(
	value: unknown,
): value is BunDevelopmentOptions {
	if (typeof value === "boolean") {
		return true;
	}

	if (!isRecord(value)) {
		return false;
	}

	return (
		isOptionalBoolean(value.hmr) &&
		isOptionalBoolean(value.console) &&
		isOptionalBoolean(value.chromeDevToolsAutomaticWorkspaceFolders)
	);
}

function isOptionalBoolean(value: unknown): boolean {
	return value === undefined || typeof value === "boolean";
}

function formatServerStarted(
	config: ServeConfig,
	runtime: ServeRuntime,
	duration: number,
): string {
	const theme = makeConsoleTheme(config.color);
	const lines = [
		theme.success("Kura server started"),
		"",
		`  ${theme.heading("Server")}`,
		formatServerRow(theme, "URL", runtime.server.url.href),
		formatServerRow(theme, "Entry", displayPath(config.root, config.entry)),
		formatServerRow(theme, "Root", config.root),
		formatServerRow(theme, "Mode", config.environment),
		formatServerRow(theme, "Watch", config.watch ? "enabled" : "disabled"),
		"",
		theme.muted(`Ready in ${formatDuration(duration)}`),
	];

	if (config.watch && config.keepAlive) {
		lines.push(theme.muted("Watching for changes. Press Ctrl+C to stop."));
	} else if (config.keepAlive) {
		lines.push(theme.muted("Press Ctrl+C to stop."));
	}

	return lines.join("\n");
}

function formatServerReloaded(
	config: ServeConfig,
	runtime: ServeRuntime,
	change: ServeWatcherChange | undefined,
	duration: number,
): string {
	const theme = makeConsoleTheme(config.color);
	const changedPath = change?.path
		? displayChangedPath(config.root, change.path)
		: undefined;
	const lines = [
		changedPath
			? theme.muted(`Change detected: ${changedPath}`)
			: theme.muted("Change detected"),
		theme.success(`Reloaded in ${formatDuration(duration)}`),
		"",
		formatServerRow(theme, "URL", runtime.server.url.href),
	];

	return lines.join("\n");
}

function formatServerReloadFailed(config: ServeConfig, error: unknown): string {
	const theme = makeConsoleTheme(config.color);
	const message = error instanceof Error ? error.message : "Unknown error";

	return [
		theme.error("Reload failed"),
		"",
		formatServerRow(theme, "Entry", displayPath(config.root, config.entry)),
		formatServerRow(theme, "Error", message),
		"",
		theme.muted("Fix the error and save a file to retry."),
	].join("\n");
}

function formatRequestLog(
	request: Request,
	status: number,
	duration: number,
): string {
	const url = new URL(request.url);
	const target = `${url.pathname}${url.search}`;

	return `${request.method} ${target} ${status} ${formatDuration(duration)}`;
}

function formatServerRow(
	theme: ConsoleTheme,
	label: string,
	value: string,
): string {
	return `  ${theme.muted(label.padEnd(7))} ${value}`;
}

function displayPath(root: string, path: string): string {
	const value = relative(root, path).replaceAll("\\", "/");

	if (value === "") {
		return ".";
	}

	if (value === ".." || value.startsWith("../")) {
		return path;
	}

	return value;
}

function displayChangedPath(root: string, path: string): string {
	const absolutePath = isAbsolute(path) ? path : resolve(root, path);

	return displayPath(root, absolutePath);
}

function formatDuration(duration: number): string {
	return `${Math.max(0, Math.round(duration))}ms`;
}

function elapsedMilliseconds(startedAt: number, finishedAt: number): number {
	return Math.max(0, finishedAt - startedAt);
}

function shouldIgnoreWatchPath(path: string): boolean {
	const normalized = path.replaceAll("\\", "/");
	const segments = normalized.split("/");

	return segments.some((segment) =>
		[".git", ".kura", "build", "dist", "node_modules", "tmp"].includes(segment),
	);
}

type ConsoleTheme = {
	readonly success: (value: string) => string;
	readonly error: (value: string) => string;
	readonly heading: (value: string) => string;
	readonly muted: (value: string) => string;
};

function makeConsoleTheme(color: boolean): ConsoleTheme {
	if (!color) {
		return {
			success: identity,
			error: identity,
			heading: identity,
			muted: identity,
		};
	}

	return {
		success: (value) => `\u001b[32m${value}\u001b[39m`,
		error: (value) => `\u001b[31m${value}\u001b[39m`,
		heading: (value) => `\u001b[1m${value}\u001b[22m`,
		muted: (value) => `\u001b[2m${value}\u001b[22m`,
	};
}

function identity(value: string): string {
	return value;
}

function shouldUseColor(): boolean {
	if (Bun.env.NO_COLOR !== undefined || Bun.env.CI === "true") {
		return false;
	}

	const stdout = process.stdout as { readonly isTTY?: boolean };

	return stdout.isTTY === true;
}

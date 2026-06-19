import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type BenchmarkApp,
	type BenchmarkEndpoint,
	resolveBenchmarkApps,
	selectedEndpoints,
} from "./Matrix";

type BenchmarkTool =
	| "autocannon"
	| "bombardier"
	| "bun"
	| "hey"
	| "oha"
	| "wrk";

type BenchmarkOptions = {
	readonly apps: readonly string[];
	readonly connections: number;
	readonly durationSeconds: number;
	readonly endpointMode: "all" | "primary";
	readonly outputDirectory: string;
	readonly portBase: number;
	readonly threads: number;
	readonly tools: readonly BenchmarkTool[] | "auto";
	readonly warmupSeconds: number;
};

type BenchmarkStats = {
	readonly errors?: number;
	readonly latencyMs?: {
		readonly average?: number;
		readonly p50?: number;
		readonly p95?: number;
		readonly p99?: number;
	};
	readonly requestsPerSecond?: number;
	readonly totalRequests?: number;
};

type BenchmarkResult = BenchmarkStats & {
	readonly app: string;
	readonly architecture?: string;
	readonly command: readonly string[];
	readonly endpoint: string;
	readonly kind: BenchmarkApp["kind"];
	readonly path: string;
	readonly preset?: string;
	readonly rawOutput: string;
	readonly tool: BenchmarkTool;
	readonly url: string;
};

const root = process.cwd();
const options = readOptions(Bun.argv.slice(2));
const apps = resolveBenchmarkApps(options.apps);
const tools = resolveTools(options.tools);
const results: BenchmarkResult[] = [];

await mkdir(options.outputDirectory, { recursive: true });

console.log("Kura benchmark run");
console.log(`Apps: ${apps.map((app) => app.name).join(", ")}`);
console.log(`Tools: ${tools.join(", ")}`);
console.log(
	`Duration: ${options.durationSeconds}s, warmup: ${options.warmupSeconds}s, connections: ${options.connections}`,
);

for (const [index, app] of apps.entries()) {
	const port = options.portBase + index;
	const server = await startServer(app, port);
	const healthUrl = `http://127.0.0.1:${port}${app.healthPath}`;

	try {
		await waitForServer(healthUrl);

		for (const endpoint of selectedEndpoints(app, options.endpointMode)) {
			const url = `http://127.0.0.1:${port}${endpoint.path}`;

			for (const tool of tools) {
				console.log(`${app.name} ${endpoint.label} ${tool}`);
				await warmup(tool, url, options);
				results.push(await runBenchmark(app, endpoint, tool, url, options));
			}
		}
	} finally {
		server.kill();
		await server.exited.catch(() => undefined);
	}
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = join(options.outputDirectory, `${timestamp}.json`);
const reportPath = join(options.outputDirectory, `${timestamp}.md`);

await writeFile(
	jsonPath,
	`${JSON.stringify({ options, results, timestamp }, null, "\t")}\n`,
);
await writeFile(reportPath, renderReport(results, options));

console.log("");
console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${reportPath}`);

function readOptions(args: readonly string[]): BenchmarkOptions {
	const tools = readListOption(args, "--tools", "--tool");

	return {
		apps: readListOption(args, "--apps", "--app"),
		connections: readIntegerOption(args, "--connections", 128),
		durationSeconds: readDurationOption(args, "--duration", 10),
		endpointMode:
			readStringOption(args, "--endpoints") === "all" ? "all" : "primary",
		outputDirectory: join(
			root,
			readStringOption(args, "--out") ?? "benchmarks/results",
		),
		portBase: readIntegerOption(args, "--port-base", 4300),
		threads: readIntegerOption(args, "--threads", 8),
		tools:
			tools.length === 0 || tools.includes("auto")
				? "auto"
				: tools.map(readTool),
		warmupSeconds: readDurationOption(args, "--warmup", 3),
	};
}

function readListOption(
	args: readonly string[],
	...names: readonly string[]
): readonly string[] {
	for (const name of names) {
		const value = readStringOption(args, name);
		if (value !== undefined) {
			return value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
		}
	}

	return [];
}

function readStringOption(
	args: readonly string[],
	name: string,
): string | undefined {
	const equalsPrefix = `${name}=`;
	const equalsValue = args.find((arg) => arg.startsWith(equalsPrefix));
	if (equalsValue !== undefined) {
		return equalsValue.slice(equalsPrefix.length);
	}

	const index = args.indexOf(name);
	if (index >= 0) {
		return args[index + 1];
	}

	return undefined;
}

function readIntegerOption(
	args: readonly string[],
	name: string,
	defaultValue: number,
): number {
	const value = readStringOption(args, name);
	if (value === undefined) {
		return defaultValue;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`Option ${name} must be a positive integer`);
	}

	return parsed;
}

function readDurationOption(
	args: readonly string[],
	name: string,
	defaultValue: number,
): number {
	const value = readStringOption(args, name);
	if (value === undefined) {
		return defaultValue;
	}

	const parsed = value.endsWith("s")
		? Number(value.slice(0, -1))
		: Number(value);
	const minimum = name === "--warmup" ? 0 : Number.MIN_VALUE;
	if (!Number.isFinite(parsed) || parsed < minimum) {
		throw new Error(
			`Option ${name} must be a ${minimum === 0 ? "non-negative" : "positive"} duration in seconds`,
		);
	}

	return parsed;
}

function readTool(value: string): BenchmarkTool {
	if (isBenchmarkTool(value)) {
		return value;
	}

	throw new Error(`Unknown benchmark tool [${value}]`);
}

function isBenchmarkTool(value: string): value is BenchmarkTool {
	return ["autocannon", "bombardier", "bun", "hey", "oha", "wrk"].includes(
		value,
	);
}

function resolveTools(
	tools: readonly BenchmarkTool[] | "auto",
): readonly BenchmarkTool[] {
	if (tools !== "auto") {
		return tools;
	}

	const installedTools = (
		["oha", "bombardier", "wrk", "hey", "autocannon"] as const
	).filter(commandExists);

	return installedTools.length > 0 ? installedTools : ["bun"];
}

function commandExists(command: string): boolean {
	const result = Bun.spawnSync({
		cmd: ["sh", "-lc", `command -v ${shellQuote(command)}`],
		stderr: "ignore",
		stdout: "ignore",
	});

	return result.exitCode === 0;
}

function startServer(
	app: BenchmarkApp,
	port: number,
): Promise<ReturnType<typeof Bun.spawn>> {
	const command =
		app.kind === "baseline"
			? [process.execPath, "benchmarks/baselines/bun-raw/server.ts"]
			: [process.execPath, "bin/server.ts"];
	const cwd =
		app.kind === "baseline" ? root : join(root, "benchmarks/apps", app.name);

	if (!existsSync(cwd)) {
		throw new Error(
			`Benchmark app [${app.name}] is missing. Run bun run bench:scaffold first.`,
		);
	}

	return startServerProcess(command, cwd, app, port);
}

async function startServerProcess(
	command: readonly string[],
	cwd: string,
	app: BenchmarkApp,
	port: number,
): Promise<ReturnType<typeof Bun.spawn>> {
	if (app.kind === "kura") {
		await writeBenchmarkEnv(cwd, port);
	}

	return Bun.spawn({
		cmd: [...command],
		cwd,
		env: {
			...Bun.env,
			HOST: "127.0.0.1",
			LOG_LEVEL: "silent",
			NODE_ENV: "production",
			PORT: String(port),
		},
		stderr: "pipe",
		stdout: "pipe",
	});
}

async function writeBenchmarkEnv(cwd: string, port: number): Promise<void> {
	const path = join(cwd, ".env");
	const content = await readFile(path, "utf8");
	const replacements = new Map([
		["HOST", "127.0.0.1"],
		["LOG_LEVEL", "silent"],
		["NODE_ENV", "production"],
		["PORT", String(port)],
	]);
	const seen = new Set<string>();
	const lines = content.split("\n").map((line) => {
		const separatorIndex = line.indexOf("=");
		const key = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
		const replacement = replacements.get(key);
		if (replacement === undefined) {
			return line;
		}

		seen.add(key);
		return `${key}=${replacement}`;
	});

	for (const [key, value] of replacements) {
		if (!seen.has(key)) {
			lines.push(`${key}=${value}`);
		}
	}

	await writeFile(path, lines.join("\n"));
}

async function waitForServer(url: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			await response.arrayBuffer();
			if (response.ok) {
				return;
			}
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}

		await Bun.sleep(100);
	}

	throw new Error(
		`Server did not become ready at ${url}: ${errorMessage(lastError)}`,
	);
}

async function warmup(
	tool: BenchmarkTool,
	url: string,
	options: BenchmarkOptions,
): Promise<void> {
	if (options.warmupSeconds <= 0) {
		return;
	}

	if (tool === "bun") {
		await runBunLoad(url, options.warmupSeconds, options.connections);
		return;
	}

	runTool(tool, url, {
		...options,
		durationSeconds: options.warmupSeconds,
	});
}

async function runBenchmark(
	app: BenchmarkApp,
	endpoint: BenchmarkEndpoint,
	tool: BenchmarkTool,
	url: string,
	options: BenchmarkOptions,
): Promise<BenchmarkResult> {
	const command =
		tool === "bun" ? ["bun-fetch-load"] : toolCommand(tool, url, options);
	const output =
		tool === "bun"
			? await runBunLoad(url, options.durationSeconds, options.connections)
			: runTool(tool, url, options);
	const stats =
		tool === "bun" ? parseJsonStats(output) : parseToolStats(tool, output);

	return {
		...stats,
		app: app.name,
		architecture: app.kind === "kura" ? app.architecture : undefined,
		command,
		endpoint: endpoint.label,
		kind: app.kind,
		path: endpoint.path,
		preset: app.kind === "kura" ? app.preset : undefined,
		rawOutput: output,
		tool,
		url,
	};
}

function runTool(
	tool: Exclude<BenchmarkTool, "bun">,
	url: string,
	options: BenchmarkOptions,
): string {
	const command = toolCommand(tool, url, options);
	const result = Bun.spawnSync({
		cmd: [...command],
		stderr: "pipe",
		stdout: "pipe",
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	const output = [stdout, stderr].filter(Boolean).join("\n");

	if (result.exitCode !== 0) {
		throw new Error(
			`${tool} failed with exit code ${result.exitCode}\n${output}`,
		);
	}

	return output;
}

function toolCommand(
	tool: Exclude<BenchmarkTool, "bun">,
	url: string,
	options: BenchmarkOptions,
): readonly string[] {
	if (tool === "oha") {
		return [
			"oha",
			"-z",
			`${options.durationSeconds}s`,
			"-c",
			String(options.connections),
			"--json",
			url,
		];
	}

	if (tool === "bombardier") {
		return [
			"bombardier",
			"-d",
			`${options.durationSeconds}s`,
			"-c",
			String(options.connections),
			"-o",
			"json",
			url,
		];
	}

	if (tool === "wrk") {
		return [
			"wrk",
			"-d",
			`${options.durationSeconds}s`,
			"-c",
			String(options.connections),
			"-t",
			String(options.threads),
			url,
		];
	}

	if (tool === "hey") {
		return [
			"hey",
			"-z",
			`${options.durationSeconds}s`,
			"-c",
			String(options.connections),
			url,
		];
	}

	return [
		"autocannon",
		"-d",
		String(Math.ceil(options.durationSeconds)),
		"-c",
		String(options.connections),
		"--json",
		url,
	];
}

async function runBunLoad(
	url: string,
	durationSeconds: number,
	connections: number,
): Promise<string> {
	const deadline = performance.now() + durationSeconds * 1000;
	const latencySamples: number[] = [];
	let completed = 0;
	let errors = 0;
	const startedAt = performance.now();

	await Promise.all(
		Array.from({ length: connections }, async () => {
			while (performance.now() < deadline) {
				const started = performance.now();
				try {
					const response = await fetch(url);
					await response.arrayBuffer();
					if (response.status >= 500) {
						errors += 1;
					}
				} catch {
					errors += 1;
				} finally {
					completed += 1;
					if (latencySamples.length < 200_000) {
						latencySamples.push(performance.now() - started);
					}
				}
			}
		}),
	);

	const elapsedSeconds = (performance.now() - startedAt) / 1000;
	const sortedLatencies = latencySamples.toSorted(
		(left, right) => left - right,
	);
	const payload = {
		errors,
		latencyMs: {
			average: average(sortedLatencies),
			p50: percentile(sortedLatencies, 50),
			p95: percentile(sortedLatencies, 95),
			p99: percentile(sortedLatencies, 99),
		},
		requestsPerSecond: completed / elapsedSeconds,
		totalRequests: completed,
	};

	return JSON.stringify(payload);
}

function parseToolStats(_tool: BenchmarkTool, output: string): BenchmarkStats {
	const json = parseJson(output);
	if (json !== undefined) {
		return parseJsonStats(JSON.stringify(json));
	}

	const requestsPerSecond = matchNumber(output, /Requests\/sec:\s*([0-9.]+)/i);
	const averageLatency =
		matchDurationMs(output, /Latency\s+([0-9.]+)(us|ms|s)/i) ??
		matchDurationMs(output, /Average:\s+([0-9.]+)\s*secs/i);
	const totalRequests = matchNumber(output, /(\d+)\s+requests\s+in/i);

	return {
		latencyMs:
			averageLatency === undefined ? undefined : { average: averageLatency },
		requestsPerSecond,
		totalRequests,
	};
}

function parseJsonStats(output: string): BenchmarkStats {
	const json = parseJson(output);
	if (json === undefined) {
		return {};
	}

	return {
		errors: firstNumberAtPaths(json, [
			["errors"],
			["result", "errors"],
			["non2xx"],
			["timeouts"],
		]),
		latencyMs: {
			average: firstNumberAtPaths(json, [
				["latencyMs", "average"],
				["latency", "average"],
				["latency", "mean"],
				["result", "latency", "mean"],
			]),
			p50: firstNumberAtPaths(json, [
				["latencyMs", "p50"],
				["latency", "p50"],
				["result", "latency", "p50"],
			]),
			p95: firstNumberAtPaths(json, [
				["latencyMs", "p95"],
				["latency", "p95"],
				["result", "latency", "p95"],
			]),
			p99: firstNumberAtPaths(json, [
				["latencyMs", "p99"],
				["latency", "p99"],
				["result", "latency", "p99"],
			]),
		},
		requestsPerSecond: firstNumberAtPaths(json, [
			["requestsPerSecond"],
			["requests", "average"],
			["summary", "requestsPerSec"],
			["result", "rps", "mean"],
			["rps", "mean"],
		]),
		totalRequests: firstNumberAtPaths(json, [
			["totalRequests"],
			["requests", "total"],
			["summary", "total"],
			["result", "reqs"],
		]),
	};
}

function parseJson(output: string): unknown | undefined {
	try {
		return JSON.parse(output);
	} catch {
		return undefined;
	}
}

function firstNumberAtPaths(
	value: unknown,
	paths: readonly (readonly string[])[],
): number | undefined {
	for (const path of paths) {
		const found = numberAtPath(value, path);
		if (found !== undefined) {
			return found;
		}
	}

	return undefined;
}

function numberAtPath(
	value: unknown,
	path: readonly string[],
): number | undefined {
	let current = value;

	for (const segment of path) {
		if (!isRecord(current)) {
			return undefined;
		}
		current = current[segment];
	}

	return typeof current === "number" && Number.isFinite(current)
		? current
		: undefined;
}

function matchNumber(text: string, pattern: RegExp): number | undefined {
	const match = text.match(pattern);
	if (!match?.[1]) {
		return undefined;
	}

	const value = Number(match[1].replaceAll(",", ""));
	return Number.isFinite(value) ? value : undefined;
}

function matchDurationMs(text: string, pattern: RegExp): number | undefined {
	const match = text.match(pattern);
	if (!match?.[1]) {
		return undefined;
	}

	const value = Number(match[1]);
	if (!Number.isFinite(value)) {
		return undefined;
	}

	const unit = match[2] ?? "s";
	if (unit === "us") {
		return value / 1000;
	}
	if (unit === "ms") {
		return value;
	}
	return value * 1000;
}

function renderReport(
	results: readonly BenchmarkResult[],
	options: BenchmarkOptions,
): string {
	const rows = [...results].sort(
		(left, right) =>
			(right.requestsPerSecond ?? 0) - (left.requestsPerSecond ?? 0),
	);
	const lines = [
		"# Kura Benchmark Report",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Duration: ${options.durationSeconds}s`,
		`Warmup: ${options.warmupSeconds}s`,
		`Connections: ${options.connections}`,
		"",
		"| App | Tool | Endpoint | Req/s | p50 ms | p95 ms | p99 ms | Errors |",
		"| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
	];

	for (const result of rows) {
		lines.push(
			[
				result.app,
				result.tool,
				`${result.endpoint} \`${result.path}\``,
				formatNumber(result.requestsPerSecond),
				formatNumber(result.latencyMs?.p50),
				formatNumber(result.latencyMs?.p95),
				formatNumber(result.latencyMs?.p99),
				formatNumber(result.errors),
			]
				.join(" | ")
				.replace(/^/, "| ")
				.replace(/$/, " |"),
		);
	}

	lines.push(
		"",
		"Notes:",
		"- `bun` is an internal fallback client and should not be used for public performance claims.",
		"- Prefer `oha`, `bombardier`, or `wrk` for local HTTP load testing.",
		"- Keep hardware, OS, Bun version, tool version, duration, warmup, and connection count fixed before comparing runs.",
		"",
	);

	return lines.join("\n");
}

function formatNumber(value: number | undefined): string {
	if (value === undefined) {
		return "-";
	}

	return value.toLocaleString("en-US", {
		maximumFractionDigits: 2,
		minimumFractionDigits: 0,
	});
}

function average(values: readonly number[]): number | undefined {
	if (values.length === 0) {
		return undefined;
	}

	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(
	values: readonly number[],
	percentileValue: number,
): number | undefined {
	if (values.length === 0) {
		return undefined;
	}

	const index = Math.min(
		values.length - 1,
		Math.floor((percentileValue / 100) * values.length),
	);

	return values[index];
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

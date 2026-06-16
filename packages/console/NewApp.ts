import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
	type Command,
	type ConsoleKernel,
	type ConsoleOptions,
	defineCommand,
} from "./Console";

type AppPreset = "api" | "web" | "full";
type DatabasePreset = "none" | "sqlite" | "postgres" | "mysql";
type AuthPreset = "none" | "session" | "jwt";
type CachePreset = "memory" | "file" | "redis";
type QueuePreset = "none" | "memory" | "sqlite" | "redis";
type PackageManager = "bun";
type ModulePreset = "mail" | "storage" | "i18n" | "websockets";

export type NewAppPrompt = {
	select(
		message: string,
		choices: readonly string[],
		defaultValue: string,
	): string | Promise<string>;
	multiSelect(
		message: string,
		choices: readonly string[],
		defaultValues: readonly string[],
	): readonly string[] | Promise<readonly string[]>;
	confirm(message: string, defaultValue: boolean): boolean | Promise<boolean>;
};

export type NewAppConsoleOptions = {
	readonly root?: string;
	readonly prompt?: NewAppPrompt;
	readonly install?: NewAppInstaller;
	readonly packageVersion?: string;
};

export type NewAppInstaller = (options: {
	readonly cwd: string;
	readonly packageManager: PackageManager;
}) => Promise<void> | void;

type NewAppChoices = {
	readonly preset: AppPreset;
	readonly database: DatabasePreset;
	readonly auth: AuthPreset;
	readonly cache: CachePreset;
	readonly queue: QueuePreset;
	readonly modules: readonly ModulePreset[];
	readonly packageManager: PackageManager;
	readonly install: boolean;
};

type NewAppFile = {
	readonly path: string;
	readonly content: string;
};

const appPresets = ["api", "web", "full"] as const;
const databasePresets = ["none", "sqlite", "postgres", "mysql"] as const;
const authPresets = ["none", "session", "jwt"] as const;
const cachePresets = ["memory", "file", "redis"] as const;
const queuePresets = ["none", "memory", "sqlite", "redis"] as const;
const modulePresets = ["mail", "storage", "i18n", "websockets"] as const;

export function createNewAppCommand(
	options: NewAppConsoleOptions = {},
): Command {
	return defineCommand(
		{
			name: "new",
			description: "Create a new Kura application",
			arguments: [
				{
					name: "name",
					required: true,
					description: "Application directory name",
				},
			],
			options: [
				{
					name: "root",
					alias: "r",
					value: "string",
					description: "Directory where the app should be created",
				},
				{
					name: "preset",
					value: "string",
					default: "api",
					description: "Application preset: api, web, or full",
				},
				{
					name: "database",
					value: "string",
					default: "none",
					description: "Database driver: none, sqlite, postgres, or mysql",
				},
				{
					name: "auth",
					value: "string",
					default: "none",
					description: "Auth setup: none, session, or jwt",
				},
				{
					name: "cache",
					value: "string",
					default: "memory",
					description: "Cache driver: memory, file, or redis",
				},
				{
					name: "queue",
					value: "string",
					default: "none",
					description: "Queue driver: none, memory, sqlite, or redis",
				},
				{
					name: "module",
					value: "string",
					description:
						"Optional module to enable: mail, storage, i18n, websockets",
				},
				{
					name: "yes",
					alias: "y",
					description: "Skip prompts and use option defaults",
				},
				{
					name: "interactive",
					description: "Force interactive prompts",
				},
				{
					name: "force",
					alias: "f",
					description: "Allow creating inside an existing directory",
				},
				{
					name: "install",
					description: "Run dependency installation after scaffolding",
				},
			],
		},
		async (context) => {
			const rawName = context.args[0];
			if (!rawName) {
				throw new Error("Command [new] requires an application name");
			}

			const root = resolveRoot(options, context.options);
			const targetPath = resolveTargetPath(root, rawName);
			const interactive = shouldPrompt(context.options, options);
			const choices = interactive
				? await promptChoices(
						context.options,
						options.prompt ?? new TerminalPrompt(),
					)
				: resolveChoices(context.options);
			const packageVersion =
				options.packageVersion ??
				(await resolveDefaultPackageVersion(targetPath));
			const files = makeNewAppFiles({
				appName: basename(targetPath),
				choices,
				packageVersion,
			});

			await writeNewApp(targetPath, files, isEnabled(context.options, "force"));

			context.output.write(`Created ${relative(root, targetPath) || "."}`);
			context.output.write(`Preset: ${choices.preset}`);
			context.output.write(`Database: ${choices.database}`);
			context.output.write(`Auth: ${choices.auth}`);
			context.output.write(`Cache: ${choices.cache}`);
			context.output.write(`Queue: ${choices.queue}`);
			context.output.write(`Framework: ${packageVersion}`);

			if (choices.modules.length > 0) {
				context.output.write(`Modules: ${choices.modules.join(", ")}`);
			}

			if (choices.install) {
				await (options.install ?? installDependencies)({
					cwd: targetPath,
					packageManager: choices.packageManager,
				});
				context.output.write("Installed dependencies");
			}

			context.output.write("Next steps:");
			context.output.write(
				`  cd ${relative(process.cwd(), targetPath) || "."}`,
			);
			context.output.write("  bun install");
			context.output.write("  bun run dev");
		},
	);
}

export function registerNewAppCommand(
	console: ConsoleKernel,
	options: NewAppConsoleOptions = {},
): ConsoleKernel {
	return console.register(createNewAppCommand(options));
}

function resolveChoices(options: ConsoleOptions): NewAppChoices {
	return {
		preset: readChoice(options, "preset", appPresets, "api"),
		database: readChoice(options, "database", databasePresets, "none"),
		auth: readChoice(options, "auth", authPresets, "none"),
		cache: readChoice(options, "cache", cachePresets, "memory"),
		queue: readChoice(options, "queue", queuePresets, "none"),
		modules: readModules(options),
		packageManager: "bun",
		install: isEnabled(options, "install"),
	};
}

async function promptChoices(
	options: ConsoleOptions,
	prompt: NewAppPrompt,
): Promise<NewAppChoices> {
	const defaults = resolveChoices(options);

	return {
		preset: readPreset(
			await prompt.select("Application type", appPresets, defaults.preset),
			appPresets,
			"preset",
		),
		database: readPreset(
			await prompt.select("Database", databasePresets, defaults.database),
			databasePresets,
			"database",
		),
		auth: readPreset(
			await prompt.select("Auth", authPresets, defaults.auth),
			authPresets,
			"auth",
		),
		cache: readPreset(
			await prompt.select("Cache", cachePresets, defaults.cache),
			cachePresets,
			"cache",
		),
		queue: readPreset(
			await prompt.select("Queue", queuePresets, defaults.queue),
			queuePresets,
			"queue",
		),
		modules: readModuleChoices(
			await prompt.multiSelect(
				"Optional modules",
				modulePresets,
				defaults.modules,
			),
		),
		packageManager: "bun",
		install: await prompt.confirm("Install dependencies", defaults.install),
	};
}

function makeNewAppFiles(options: {
	readonly appName: string;
	readonly choices: NewAppChoices;
	readonly packageVersion: string;
}): readonly NewAppFile[] {
	const { appName, choices, packageVersion } = options;

	return [
		{
			path: "package.json",
			content: `${JSON.stringify(makePackageJson(appName, packageVersion), null, "\t")}\n`,
		},
		{
			path: "tsconfig.json",
			content: `{
\t"compilerOptions": {
\t\t"lib": ["ESNext"],
\t\t"target": "ESNext",
\t\t"module": "Preserve",
\t\t"moduleResolution": "bundler",
\t\t"strict": true,
\t\t"skipLibCheck": true,
\t\t"types": ["bun"]
\t}
}
`,
		},
		{
			path: ".gitignore",
			content: `node_modules
dist
.env
*.log
`,
		},
		{
			path: ".env.example",
			content: makeEnvExample(choices),
		},
		{
			path: "config/app.ts",
			content: makeAppConfig(choices),
		},
		{
			path: "src/routes.ts",
			content: makeRoutes(choices),
		},
		{
			path: "src/server.ts",
			content: `import { Server } from "kura";
import { router } from "./routes";

const port = Number(Bun.env.PORT ?? 3000);
const server = new Server({ port });

server.setRouter(router);
server.start();

console.log(\`Kura app listening on http://localhost:\${port}\`);
`,
		},
		{
			path: "README.md",
			content: makeReadme(appName, choices),
		},
	];
}

function makePackageJson(appName: string, packageVersion: string) {
	return {
		name: slugify(appName),
		type: "module",
		private: true,
		scripts: {
			dev: "bun --watch src/server.ts",
			start: "bun src/server.ts",
			typecheck: "tsc --noEmit",
			build:
				"bun build src/server.ts --target=bun --outdir=dist --packages=external",
		},
		dependencies: {
			kura: packageVersion,
		},
		devDependencies: {
			"@types/bun": "^1.3.6",
			typescript: "^5.9.3",
		},
	};
}

async function resolveDefaultPackageVersion(
	targetPath: string,
): Promise<string> {
	const localRoot = await findLocalKuraRoot();

	if (localRoot === undefined) {
		return "latest";
	}

	const dependencyPath = normalizeDependencyPath(
		relative(
			await resolveFutureRealPath(targetPath),
			await resolveFutureRealPath(localRoot),
		),
	);

	return `file:${dependencyPath}`;
}

async function findLocalKuraRoot(): Promise<string | undefined> {
	const sourcePath = fileURLToPath(import.meta.url);
	const candidates = [
		process.cwd(),
		dirname(sourcePath),
		resolve(dirname(sourcePath), ".."),
		resolve(dirname(sourcePath), "../.."),
		resolve(dirname(sourcePath), "../../.."),
	];
	const seen = new Set<string>();

	for (const candidate of candidates) {
		const root = resolve(candidate);

		if (seen.has(root)) {
			continue;
		}

		seen.add(root);

		if (await isKuraPackageRoot(root)) {
			return root;
		}
	}

	return undefined;
}

async function isKuraPackageRoot(path: string): Promise<boolean> {
	try {
		const packageJson = JSON.parse(
			await readFile(join(path, "package.json"), "utf8"),
		) as { readonly name?: string; readonly private?: boolean };

		if (packageJson.name !== "kura" || packageJson.private !== true) {
			return false;
		}

		return (
			(await pathExists(join(path, "index.ts"))) &&
			(await pathExists(join(path, "packages/core/Container.ts")))
		);
	} catch {
		return false;
	}
}

function normalizeDependencyPath(path: string): string {
	const normalized = (path || ".").replaceAll("\\", "/");

	if (normalized === "." || normalized.startsWith(".")) {
		return normalized;
	}

	return `./${normalized}`;
}

async function resolveFutureRealPath(path: string): Promise<string> {
	const segments: string[] = [];
	let current = resolve(path);

	while (!(await pathExists(current))) {
		const parent = dirname(current);

		if (parent === current) {
			break;
		}

		segments.unshift(basename(current));
		current = parent;
	}

	return resolve(await realpath(current), ...segments);
}

function makeEnvExample(choices: NewAppChoices): string {
	const lines = ["PORT=3000"];

	if (choices.database !== "none") {
		lines.push("DATABASE_URL=");
	}

	if (choices.auth !== "none") {
		lines.push("APP_KEY=");
	}

	if (choices.cache === "redis" || choices.queue === "redis") {
		lines.push("REDIS_URL=");
	}

	return `${lines.join("\n")}\n`;
}

function makeAppConfig(choices: NewAppChoices): string {
	return `import { defineConfig } from "kura";

export default defineConfig({
\tpreset: "${choices.preset}",
\tdatabase: "${choices.database}",
\tauth: "${choices.auth}",
\tcache: "${choices.cache}",
\tqueue: "${choices.queue}",
\tmodules: ${JSON.stringify(choices.modules)},
});
`;
}

function makeRoutes(choices: NewAppChoices): string {
	return `import { Router } from "kura";

export const router = new Router();

router.get("/", () =>
\tResponse.json({
\t\tframework: "kura",
\t\tpreset: "${choices.preset}",
\t\tok: true,
\t}),
);

router.get("/health", () => Response.json({ status: "up" }));
`;
}

function makeReadme(appName: string, choices: NewAppChoices): string {
	return `# ${appName}

Generated with Kura.

## Stack

- Preset: ${choices.preset}
- Database: ${choices.database}
- Auth: ${choices.auth}
- Cache: ${choices.cache}
- Queue: ${choices.queue}
- Modules: ${choices.modules.length > 0 ? choices.modules.join(", ") : "none"}

## Development

\`\`\`sh
bun install
bun run dev
\`\`\`

Open http://localhost:3000.
`;
}

async function writeNewApp(
	targetPath: string,
	files: readonly NewAppFile[],
	force: boolean,
): Promise<void> {
	const exists = await pathExists(targetPath);

	if (exists && !force) {
		throw new Error(
			`Directory [${targetPath}] already exists. Use --force to write into it.`,
		);
	}

	await mkdir(targetPath, { recursive: true });

	for (const file of files) {
		const path = join(targetPath, file.path);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, file.content, { flag: force ? "w" : "wx" });
	}
}

async function installDependencies(options: {
	readonly cwd: string;
	readonly packageManager: PackageManager;
}): Promise<void> {
	const result = Bun.spawnSync({
		cmd: [options.packageManager, "install"],
		cwd: options.cwd,
		stderr: "inherit",
		stdout: "inherit",
	});

	if (result.exitCode !== 0) {
		throw new Error("Dependency installation failed");
	}
}

class TerminalPrompt implements NewAppPrompt {
	select(
		message: string,
		choices: readonly string[],
		defaultValue: string,
	): string {
		const answer = promptLine(
			`${message} (${choices.join("/")})`,
			defaultValue,
		);

		return answer || defaultValue;
	}

	multiSelect(
		message: string,
		choices: readonly string[],
		defaultValues: readonly string[],
	): readonly string[] {
		const answer = promptLine(
			`${message} (${choices.join(", ")}; comma separated)`,
			defaultValues.join(","),
		);

		return answer
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
	}

	confirm(message: string, defaultValue: boolean): boolean {
		const answer = promptLine(message, defaultValue ? "yes" : "no")
			.trim()
			.toLowerCase();

		return ["y", "yes", "true", "1"].includes(answer);
	}
}

function promptLine(message: string, defaultValue: string): string {
	const prompt = (
		globalThis as {
			prompt?: (message: string, defaultValue?: string) => string | null;
		}
	).prompt;

	if (typeof prompt !== "function") {
		return defaultValue;
	}

	return prompt(`${message} [${defaultValue}]`, defaultValue) ?? defaultValue;
}

function resolveRoot(
	options: NewAppConsoleOptions,
	consoleOptions: ConsoleOptions,
): string {
	const root =
		readStringOption(consoleOptions, "root") ?? options.root ?? process.cwd();

	return isAbsolute(root) ? root : resolve(root);
}

function resolveTargetPath(root: string, rawName: string): string {
	const segments = rawName
		.replaceAll("\\", "/")
		.split("/")
		.map((segment) => segment.trim())
		.filter(Boolean);

	if (segments.length === 0) {
		throw new Error("Application name cannot be empty");
	}

	for (const segment of segments) {
		if (
			segment === "." ||
			segment === ".." ||
			!/^[A-Za-z0-9_.-]+$/.test(segment)
		) {
			throw new Error(`Application name segment [${segment}] is invalid`);
		}
	}

	return resolve(root, ...segments);
}

function readStringOption(
	options: ConsoleOptions,
	name: string,
): string | undefined {
	const value = options[name];

	if (Array.isArray(value)) {
		return value.at(-1);
	}

	return typeof value === "string" ? value : undefined;
}

function readChoice<TChoice extends string>(
	options: ConsoleOptions,
	name: string,
	choices: readonly TChoice[],
	defaultValue: TChoice,
): TChoice {
	const value = readStringOption(options, name) ?? defaultValue;

	return readPreset(value, choices, name);
}

function readPreset<TChoice extends string>(
	value: string,
	choices: readonly TChoice[],
	name: string,
): TChoice {
	if (choices.includes(value as TChoice)) {
		return value as TChoice;
	}

	throw new Error(
		`Invalid ${name} [${value}]. Expected one of: ${choices.join(", ")}`,
	);
}

function readModules(options: ConsoleOptions): readonly ModulePreset[] {
	const value = options.module;

	if (value === undefined || value === false) {
		return [];
	}

	const rawValues = Array.isArray(value) ? value : [String(value)];
	const modules = rawValues.flatMap((item) =>
		item
			.split(",")
			.map((moduleName) => moduleName.trim())
			.filter(Boolean),
	);

	return readModuleChoices(modules);
}

function readModuleChoices(values: readonly string[]): readonly ModulePreset[] {
	return [
		...new Set(
			values.map((value) => readPreset(value, modulePresets, "module")),
		),
	];
}

function shouldPrompt(
	options: ConsoleOptions,
	commandOptions: NewAppConsoleOptions,
): boolean {
	if (isEnabled(options, "yes")) {
		return false;
	}

	if (
		isEnabled(options, "interactive") ||
		commandOptions.prompt !== undefined
	) {
		return true;
	}

	const stdin = process.stdin as { isTTY?: boolean };

	return stdin.isTTY === true;
}

function isEnabled(options: ConsoleOptions, name: string): boolean {
	return options[name] === true;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function slugify(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_.-]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return slug || "kura-app";
}

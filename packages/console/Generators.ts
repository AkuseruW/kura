import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
	type Command,
	type ConsoleKernel,
	type ConsoleOptions,
	defineCommand,
} from "./Console";
import type { ArchitecturePreset } from "./new-app/Types";

export interface GeneratorConsoleOptions {
	readonly root?: string;
	readonly architecture?: ArchitecturePreset;
	readonly now?: () => Date;
}

type GeneratedFileAction = "created" | "overwritten";

type GeneratorDefinition = {
	readonly commandName: string;
	readonly description: string;
	readonly suffix?: string;
	readonly directory: string;
	readonly modular?: boolean;
	readonly makeFileName?: (input: GeneratorInput) => string;
	readonly makeContent: (input: GeneratorInput) => string;
};

type GeneratorInput = {
	readonly architecture: ArchitecturePreset;
	readonly rawName: string;
	readonly className: string;
	readonly baseName: string;
	readonly fileName: string;
	readonly directory: string;
	readonly segments: readonly string[];
	readonly root: string;
	readonly timestamp: string;
};

export function createGeneratorCommands(
	options: GeneratorConsoleOptions = {},
): readonly Command[] {
	return generatorDefinitions.map((definition) =>
		makeGeneratorCommand(definition, options),
	);
}

export function registerGeneratorCommands(
	console: ConsoleKernel,
	options: GeneratorConsoleOptions = {},
): ConsoleKernel {
	for (const command of createGeneratorCommands(options)) {
		console.register(command);
	}

	return console;
}

function makeGeneratorCommand(
	definition: GeneratorDefinition,
	options: GeneratorConsoleOptions,
): Command {
	return defineCommand(
		{
			name: definition.commandName,
			description: definition.description,
			arguments: [
				{
					name: "name",
					required: true,
					description: "Name to generate",
				},
			],
			options: generatorCommandOptions(),
		},
		async (context) => {
			const rawName = context.args[0];

			if (!rawName) {
				throw new Error(`Command [${definition.commandName}] requires a name`);
			}

			const root = resolveRoot(options, context.options);
			const input = makeGeneratorInput(definition, rawName, root, options);
			const targetPath = join(input.root, input.directory, input.fileName);
			const action = await writeGeneratedFile({
				path: targetPath,
				content: definition.makeContent(input),
				force: isEnabled(context.options, "force"),
			});

			context.output.write(
				`${capitalize(action)} ${relative(input.root, targetPath)}`,
			);
		},
	);
}

function generatorCommandOptions() {
	return [
		{
			name: "root",
			alias: "r",
			value: "string" as const,
			description: "Project root directory",
		},
		{
			name: "force",
			alias: "f",
			description: "Overwrite an existing file",
		},
	];
}

async function writeGeneratedFile(options: {
	readonly path: string;
	readonly content: string;
	readonly force: boolean;
}): Promise<GeneratedFileAction> {
	await mkdir(dirname(options.path), { recursive: true });
	const existed = await fileExists(options.path);

	try {
		await writeFile(options.path, options.content, {
			flag: options.force ? "w" : "wx",
		});
		return existed ? "overwritten" : "created";
	} catch (error) {
		if (isFileExistsError(error)) {
			throw new Error(
				`File [${options.path}] already exists. Use --force to overwrite it.`,
			);
		}

		throw error;
	}
}

function makeGeneratorInput(
	definition: GeneratorDefinition,
	rawName: string,
	root: string,
	options: GeneratorConsoleOptions,
): GeneratorInput {
	const architecture = options.architecture ?? "standard";
	const timestamp = formatTimestamp((options.now ?? (() => new Date()))());
	const rawSegments = parseNameSegments(rawName);
	const baseName = withSuffix(
		pascalCase(rawSegments.at(-1) ?? rawName),
		definition.suffix,
	);
	const segments = [...rawSegments.slice(0, -1).map(pascalCase), baseName];
	const directorySegments = rawSegments.slice(0, -1).map(snakeCase);
	const moduleSegments =
		rawSegments.length > 1
			? rawSegments.slice(0, -1).map(snakeCase)
			: [snakeCase(rawSegments.at(-1) ?? rawName)];
	const className =
		(architecture === "domain" || architecture === "modular") &&
		definition.modular
			? baseName
			: segments.join("");
	const directory = resolveGeneratorDirectory({
		architecture,
		definition,
		directorySegments,
		moduleSegments,
		segments,
	});
	const inputWithoutFileName = {
		architecture,
		rawName,
		className,
		baseName,
		fileName: `${snakeCase(baseName)}.ts`,
		directory,
		segments,
		root,
		timestamp,
	};

	return {
		...inputWithoutFileName,
		fileName:
			definition.makeFileName?.(inputWithoutFileName) ??
			inputWithoutFileName.fileName,
	};
}

function resolveGeneratorDirectory(input: {
	readonly architecture: ArchitecturePreset;
	readonly definition: GeneratorDefinition;
	readonly directorySegments: readonly string[];
	readonly moduleSegments: readonly string[];
	readonly segments: readonly string[];
}): string {
	if (input.architecture === "domain" && input.definition.modular) {
		return join(
			"app/domains",
			...input.moduleSegments,
			domainLayerForCommand(input.definition.commandName),
		);
	}

	if (input.architecture === "modular" && input.definition.modular) {
		return join("app/modules", ...input.moduleSegments);
	}

	return join(input.definition.directory, ...input.directorySegments);
}

function domainLayerForCommand(commandName: string): string {
	if (commandName === "make:controller") {
		return "http";
	}

	if (commandName === "make:validator") {
		return "application";
	}

	return "domain";
}

function resolveRoot(
	options: GeneratorConsoleOptions,
	consoleOptions: ConsoleOptions,
): string {
	const root =
		readStringOption(consoleOptions, "root") ?? options.root ?? process.cwd();

	return isAbsolute(root) ? root : resolve(root);
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

function parseNameSegments(name: string): readonly string[] {
	const segments = name
		.replaceAll("\\", "/")
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);

	if (segments.length === 0) {
		throw new Error("Generator name cannot be empty");
	}

	for (const segment of segments) {
		if (
			segment === "." ||
			segment === ".." ||
			!/^[A-Za-z0-9_.-]+$/.test(segment)
		) {
			throw new Error(`Generator name segment [${segment}] is invalid`);
		}
	}

	return segments;
}

function withSuffix(value: string, suffix: string | undefined): string {
	if (!suffix || value.endsWith(suffix)) {
		return value;
	}

	return `${value}${suffix}`;
}

function pascalCase(value: string): string {
	const words = value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^A-Za-z0-9]+/)
		.filter((word) => word.length > 0);

	const result = words.map(capitalize).join("");

	if (result.length === 0 || /^[0-9]/.test(result)) {
		throw new Error(`Generator name segment [${value}] is invalid`);
	}

	return result;
}

function camelCase(value: string): string {
	const pascal = pascalCase(value);

	return `${pascal[0]?.toLowerCase() ?? ""}${pascal.slice(1)}`;
}

function snakeCase(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.split(/[^A-Za-z0-9]+/)
		.filter((word) => word.length > 0)
		.map((word) => word.toLowerCase())
		.join("_");
}

function eventName(value: string): string {
	return snakeCase(value).replaceAll("_", ".");
}

function tableNameFromModel(value: string): string {
	const snake = snakeCase(value);

	return snake.endsWith("s") ? snake : `${snake}s`;
}

function migrationName(input: GeneratorInput): string {
	return snakeCase(input.rawName.replaceAll("/", "_"));
}

function migrationTableName(input: GeneratorInput): string {
	const name = migrationName(input);

	if (name.startsWith("create_")) {
		return name.replace(/^create_/, "").replace(/_table$/, "");
	}

	const toMatch = name.match(/_to_([a-z0-9_]+)$/);
	if (toMatch?.[1]) {
		return toMatch[1].replace(/_table$/, "");
	}

	return "table_name";
}

function modelImportPath(input: GeneratorInput, modelName: string): string {
	const modelFileName = snakeCase(modelName);

	if (input.architecture === "domain") {
		const rawSegments = parseNameSegments(input.rawName);
		const moduleSegments =
			rawSegments.length > 1
				? rawSegments.slice(0, -1).map(snakeCase)
				: [snakeCase(modelName)];

		return `../../app/domains/${moduleSegments.join("/")}/infrastructure/persistence/${modelFileName}_record`;
	}

	if (input.architecture !== "modular") {
		return `../../app/models/${modelFileName}`;
	}

	const rawSegments = parseNameSegments(input.rawName);
	const moduleSegments =
		rawSegments.length > 1
			? rawSegments.slice(0, -1).map(snakeCase)
			: [snakeCase(modelName)];

	return `../../app/modules/${moduleSegments.join("/")}/${modelFileName}`;
}

function formatTimestamp(date: Date): string {
	const year = date.getUTCFullYear().toString().padStart(4, "0");
	const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
	const day = date.getUTCDate().toString().padStart(2, "0");
	const hour = date.getUTCHours().toString().padStart(2, "0");
	const minute = date.getUTCMinutes().toString().padStart(2, "0");
	const second = date.getUTCSeconds().toString().padStart(2, "0");

	return `${year}${month}${day}${hour}${minute}${second}`;
}

function capitalize(value: string): string {
	return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function isFileExistsError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "EEXIST"
	);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

const generatorDefinitions: readonly GeneratorDefinition[] = [
	{
		commandName: "make:model",
		description: "Create a model class",
		directory: "app/models",
		modular: true,
		makeContent: (input) => {
			if (input.architecture === "domain") {
				return `export type ${input.className}Properties = {
\treadonly id?: string;
};

export class ${input.className} {
\tprivate constructor(private readonly properties: ${input.className}Properties) {}

\tstatic create(properties: ${input.className}Properties = {}): ${input.className} {
\t\treturn new ${input.className}(properties);
\t}

\tstatic hydrate(properties: ${input.className}Properties): ${input.className} {
\t\treturn new ${input.className}(properties);
\t}

\ttoJSON(): ${input.className}Properties {
\t\treturn this.properties;
\t}
}
`;
			}

			const tableName = tableNameFromModel(input.baseName);

			return `import { BaseModel, column } from "kura/database";

export type ${input.className}Attributes = Record<string, unknown> & {
\tid?: number;
};

export class ${input.className} extends BaseModel<${input.className}Attributes> {
\tstatic override table = "${tableName}";

\t@column()
\tdeclare id?: number;
}
`;
		},
	},
	{
		commandName: "make:controller",
		description: "Create an HTTP controller",
		suffix: "Controller",
		directory: "app/controllers",
		modular: true,
		makeContent: (
			input,
		) => `import { BaseController, type Context } from "kura/http";

export class ${input.className} extends BaseController {
\tasync index(_ctx: Context): Promise<Response> {
\t\treturn Response.json([]);
\t}
}
`,
	},
	{
		commandName: "make:middleware",
		description: "Create HTTP middleware",
		suffix: "Middleware",
		directory: "app/middleware",
		makeContent: (input) => `import type { Middleware } from "kura/http";

export const ${input.className}: Middleware = async (_ctx, next) => {
\treturn next();
};
`,
	},
	{
		commandName: "make:validator",
		description: "Create a validator schema",
		suffix: "Validator",
		directory: "app/validators",
		modular: true,
		makeContent: (input) => `import { v } from "kura/validation";

export const ${camelCase(input.className)} = v.object({});
`,
	},
	{
		commandName: "make:migration",
		description: "Create a database migration",
		directory: "database/migrations",
		makeFileName: (input) => `${input.timestamp}_${migrationName(input)}.ts`,
		makeContent: (input) => {
			const tableName = migrationTableName(input);

			return `import { Migration, type SchemaBuilder } from "kura/database";

export default class ${input.className} extends Migration {
\toverride up(schema: SchemaBuilder): void {
\t\tschema.createTable("${tableName}", (table) => {
\t\t\ttable.id();
\t\t\ttable.timestamps();
\t\t});
\t}

\toverride down(schema: SchemaBuilder): void {
\t\tschema.dropTable("${tableName}");
\t}
}
`;
		},
	},
	{
		commandName: "make:seeder",
		description: "Create a database seeder",
		suffix: "Seeder",
		directory: "database/seeders",
		makeContent: (
			input,
		) => `import { Seeder, type SeederContext } from "kura/database";

export default class ${input.className} extends Seeder {
\toverride async run(_ctx: SeederContext): Promise<void> {}
}
`,
	},
	{
		commandName: "make:factory",
		description: "Create a model factory",
		suffix: "Factory",
		directory: "database/factories",
		makeContent: (input) => {
			const modelName = input.baseName.replace(/Factory$/, "");
			const factoryModelName =
				input.architecture === "domain" ? `${modelName}Record` : modelName;

			return `import { defineFactory } from "kura/database";
import { ${factoryModelName} } from "${modelImportPath(input, modelName)}";

export const ${camelCase(input.className)} = defineFactory(${factoryModelName}, ({ sequence }) => ({
\tname: \`${modelName} \${sequence}\`,
}));
`;
		},
	},
	{
		commandName: "make:event",
		description: "Create an event class",
		suffix: "Event",
		directory: "app/events",
		makeContent: (input) => `import { Event } from "kura/events";

export type ${input.className}Payload = Record<string, unknown>;

export class ${input.className} extends Event<${input.className}Payload> {
\tconstructor(payload: ${input.className}Payload) {
\t\tsuper("${eventName(input.baseName.replace(/Event$/, ""))}", payload);
\t}
}
`,
	},
	{
		commandName: "make:listener",
		description: "Create an event listener",
		suffix: "Listener",
		directory: "app/listeners",
		makeContent: (input) => `import type { Event } from "kura/events";

export class ${input.className} {
\tasync handle(_event: Event<Record<string, unknown>>): Promise<void> {}
}
`,
	},
	{
		commandName: "make:job",
		description: "Create a queue job",
		suffix: "Job",
		directory: "app/jobs",
		makeContent: (input) => `import { Job, type JobContext } from "kura/queue";

export type ${input.className}Payload = Record<string, unknown>;

export class ${input.className} extends Job<${input.className}Payload> {
\toverride async handle(_ctx: JobContext<${input.className}Payload>): Promise<void> {}
}
`,
	},
	{
		commandName: "make:mail",
		description: "Create a mail class",
		suffix: "Mail",
		directory: "app/mails",
		makeContent: (
			input,
		) => `export type ${input.className}Data = Record<string, unknown>;

export class ${input.className} {
\tconstructor(public readonly data: ${input.className}Data = {}) {}

\tsubject(): string {
\t\treturn "${input.baseName.replace(/Mail$/, "")}";
\t}

\thtml(): string {
\t\treturn "";
\t}
}
`,
	},
	{
		commandName: "make:policy",
		description: "Create an authorization policy",
		suffix: "Policy",
		directory: "app/policies",
		makeContent: (input) => `import { BasePolicy } from "kura/auth";
import type { Context } from "kura/http";

export class ${input.className} extends BasePolicy {
\toverride view(_user: unknown, _resource?: unknown, _ctx?: Context): boolean {
\t\treturn false;
\t}

\toverride create(_user: unknown, _resource?: unknown, _ctx?: Context): boolean {
\t\treturn false;
\t}

\toverride update(_user: unknown, _resource?: unknown, _ctx?: Context): boolean {
\t\treturn false;
\t}

\toverride delete(_user: unknown, _resource?: unknown, _ctx?: Context): boolean {
\t\treturn false;
\t}
}
`,
	},
];

import { BaseException } from "../core/BaseException";

export type ConsoleOptionValue = string | boolean | string[];
export type ConsoleOptions = Record<string, ConsoleOptionValue>;
export type EmptyCommandResult = ReturnType<() => void>;
export type CommandResult =
	| EmptyCommandResult
	| number
	| Promise<EmptyCommandResult | number>;

export interface ConsoleOutput {
	write(message: string): void;
	error(message: string): void;
}

export class TerminalConsoleOutput implements ConsoleOutput {
	write(message: string): void {
		console.log(message);
	}

	error(message: string): void {
		console.error(message);
	}
}

export class MemoryConsoleOutput implements ConsoleOutput {
	public readonly lines: string[] = [];
	public readonly errorLines: string[] = [];

	write(message: string): void {
		this.lines.push(message);
	}

	error(message: string): void {
		this.errorLines.push(message);
	}

	text(): string {
		return this.lines.join("\n");
	}

	errorText(): string {
		return this.errorLines.join("\n");
	}
}

export interface CommandArgumentDefinition {
	name: string;
	description?: string;
	required?: boolean;
	variadic?: boolean;
}

export interface CommandOptionDefinition {
	name: string;
	description?: string;
	alias?: string;
	value?: "boolean" | "string";
	default?: ConsoleOptionValue;
}

export interface ParsedArgv {
	commandName?: string;
	args: string[];
	options: ConsoleOptions;
	raw: string[];
}

export interface CommandContext {
	args: string[];
	argv: string[];
	options: ConsoleOptions;
	output: ConsoleOutput;
	kernel: ConsoleKernel;
	parsed: ParsedArgv;
}

export abstract class Command {
	abstract readonly name: string;
	readonly description: string = "";
	readonly aliases: readonly string[] = [];
	readonly argumentDefinitions: readonly CommandArgumentDefinition[] = [];
	readonly optionDefinitions: readonly CommandOptionDefinition[] = [];

	abstract handle(context: CommandContext): CommandResult;
}

export interface DefineCommandOptions {
	name: string;
	description?: string;
	aliases?: readonly string[];
	arguments?: readonly CommandArgumentDefinition[];
	options?: readonly CommandOptionDefinition[];
}

export type CommandHandler = (context: CommandContext) => CommandResult;

export function defineCommand(
	definition: DefineCommandOptions,
	handler: CommandHandler,
): Command {
	return new DefinedCommand(definition, handler);
}

class DefinedCommand extends Command {
	override readonly name: string;
	override readonly description: string;
	override readonly aliases: readonly string[];
	override readonly argumentDefinitions: readonly CommandArgumentDefinition[];
	override readonly optionDefinitions: readonly CommandOptionDefinition[];

	constructor(
		definition: DefineCommandOptions,
		private readonly commandHandler: CommandHandler,
	) {
		super();
		this.name = definition.name;
		this.description = definition.description ?? "";
		this.aliases = definition.aliases ?? [];
		this.argumentDefinitions = definition.arguments ?? [];
		this.optionDefinitions = definition.options ?? [];
	}

	override handle(context: CommandContext): CommandResult {
		return this.commandHandler(context);
	}
}

export class ConsoleException extends BaseException {
	static duplicateCommand(name: string): ConsoleException {
		return new ConsoleException(
			`Command [${name}] is already registered`,
			"CONSOLE_DUPLICATE_COMMAND",
			500,
		);
	}

	static invalidCommandName(name: string): ConsoleException {
		return new ConsoleException(
			`Command name [${name}] is invalid`,
			"CONSOLE_INVALID_COMMAND_NAME",
			500,
		);
	}

	static missingCommand(name: string): ConsoleException {
		return new ConsoleException(
			`Command [${name}] was not found`,
			"CONSOLE_COMMAND_NOT_FOUND",
			404,
		);
	}
}

export interface ConsoleRunOptions {
	output?: ConsoleOutput;
	throwOnError?: boolean;
}

export class ConsoleKernel {
	private readonly commands = new Map<string, Command>();
	private readonly aliases = new Map<string, string>();

	constructor(
		private readonly defaultOutput: ConsoleOutput = new TerminalConsoleOutput(),
	) {}

	register(command: Command): this {
		assertCommandName(command.name);

		if (this.commands.has(command.name) || this.aliases.has(command.name)) {
			throw ConsoleException.duplicateCommand(command.name);
		}

		this.commands.set(command.name, command);

		for (const alias of command.aliases) {
			assertCommandName(alias);

			if (this.commands.has(alias) || this.aliases.has(alias)) {
				throw ConsoleException.duplicateCommand(alias);
			}

			this.aliases.set(alias, command.name);
		}

		return this;
	}

	list(): Command[] {
		return [...this.commands.values()].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
	}

	find(name: string): Command | undefined {
		const commandName = this.aliases.get(name) ?? name;

		return this.commands.get(commandName);
	}

	async run(
		argv: readonly string[],
		options: ConsoleRunOptions = {},
	): Promise<number> {
		const output = options.output ?? this.defaultOutput;
		const commandName = readCommandName(argv);

		if (!commandName) {
			output.write(this.help());
			return 0;
		}

		if (commandName === "help") {
			output.write(this.help(readHelpTarget(argv)));
			return 0;
		}

		const command = this.find(commandName);

		if (!command) {
			return this.fail(
				ConsoleException.missingCommand(commandName),
				output,
				options,
			);
		}

		const parsed = parseArgv(argv, command);

		if (parsed.options.help === true || parsed.options.h === true) {
			output.write(this.commandHelp(command));
			return 0;
		}

		try {
			const result = await command.handle({
				args: parsed.args,
				argv: [...argv],
				options: parsed.options,
				output,
				kernel: this,
				parsed,
			});

			return typeof result === "number" ? result : 0;
		} catch (error) {
			if (error instanceof Error) {
				return this.fail(error, output, options);
			}

			return this.fail(new Error("Command failed"), output, options);
		}
	}

	help(commandName?: string): string {
		if (commandName) {
			const command = this.find(commandName);

			if (command) {
				return this.commandHelp(command);
			}

			return `Command [${commandName}] was not found`;
		}

		const lines = [
			"Kura Console",
			"",
			"Usage:",
			"  kura <command> [arguments] [options]",
			"",
		];
		const commands = this.list();

		if (commands.length === 0) {
			lines.push("No commands registered.");
			return lines.join("\n");
		}

		lines.push("Commands:");

		for (const command of commands) {
			lines.push(`  ${pad(command.name, 18)} ${command.description}`.trimEnd());
		}

		return lines.join("\n");
	}

	commandHelp(command: Command): string {
		const lines = [
			command.description
				? `${command.name} - ${command.description}`
				: command.name,
			"",
			"Usage:",
			`  kura ${command.name}${formatArguments(command.argumentDefinitions)}${formatOptions(
				command.optionDefinitions,
			)}`,
		];

		if (command.aliases.length > 0) {
			lines.push("", "Aliases:");
			lines.push(`  ${command.aliases.join(", ")}`);
		}

		if (command.argumentDefinitions.length > 0) {
			lines.push("", "Arguments:");

			for (const argument of command.argumentDefinitions) {
				lines.push(
					`  ${pad(formatArgument(argument), 18)} ${argument.description ?? ""}`.trimEnd(),
				);
			}
		}

		if (command.optionDefinitions.length > 0) {
			lines.push("", "Options:");

			for (const option of command.optionDefinitions) {
				lines.push(
					`  ${pad(formatOption(option), 18)} ${option.description ?? ""}`.trimEnd(),
				);
			}
		}

		return lines.join("\n");
	}

	private fail(
		error: Error,
		output: ConsoleOutput,
		options: ConsoleRunOptions,
	): number {
		if (options.throwOnError) {
			throw error;
		}

		output.error(error.message);
		return 1;
	}
}

export function createConsole(
	commands: readonly Command[] = [],
): ConsoleKernel {
	const kernel = new ConsoleKernel();

	for (const command of commands) {
		kernel.register(command);
	}

	return kernel;
}

export function parseArgv(
	argv: readonly string[],
	command?: Command,
): ParsedArgv {
	const raw = [...argv];
	const commandName = readCommandName(argv);
	const tokens = commandName ? argv.slice(1) : argv;
	const args: string[] = [];
	const optionDefinitions = command?.optionDefinitions ?? [];
	const options: ConsoleOptions = {};
	let parsingOptions = true;

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];

		if (token === undefined) {
			continue;
		}

		if (parsingOptions && token === "--") {
			parsingOptions = false;
			continue;
		}

		if (parsingOptions && token.startsWith("--")) {
			const consumed = parseLongOption(tokens, index, command, options);
			index += consumed;
			continue;
		}

		if (parsingOptions && isShortOption(token)) {
			const consumed = parseShortOption(tokens, index, command, options);
			index += consumed;
			continue;
		}

		args.push(token);
	}

	return {
		commandName,
		args,
		options: applyOptionDefaults(optionDefinitions, options),
		raw,
	};
}

function readCommandName(argv: readonly string[]): string | undefined {
	const first = argv[0];

	if (!first || first === "--" || first.startsWith("-")) {
		return undefined;
	}

	return first;
}

function readHelpTarget(argv: readonly string[]): string | undefined {
	return argv
		.slice(1)
		.find((token) => token !== "--" && !token.startsWith("-"));
}

function parseLongOption(
	tokens: readonly string[],
	index: number,
	command: Command | undefined,
	options: ConsoleOptions,
): number {
	const token = tokens[index] ?? "";
	const optionToken = token.slice(2);
	const [rawName, inlineValue] = splitOptionToken(optionToken);
	const negative = rawName.startsWith("no-");
	const name = negative ? rawName.slice(3) : rawName;
	const definition = findOptionDefinition(command, name);
	const optionName = definition?.name ?? name;

	if (negative) {
		setOption(options, optionName, false);
		return 0;
	}

	if (inlineValue !== undefined) {
		setOption(options, optionName, inlineValue);
		return 0;
	}

	if (optionAcceptsValue(definition)) {
		const next = tokens[index + 1];

		if (next !== undefined && next !== "--") {
			setOption(options, optionName, next);
			return 1;
		}

		setOption(options, optionName, "");
		return 0;
	}

	setOption(options, optionName, true);
	return 0;
}

function parseShortOption(
	tokens: readonly string[],
	index: number,
	command: Command | undefined,
	options: ConsoleOptions,
): number {
	const token = tokens[index] ?? "";
	const alias = token.slice(1);
	const definition = findOptionDefinition(command, alias);
	const optionName = definition?.name ?? alias;

	if (optionAcceptsValue(definition)) {
		const next = tokens[index + 1];

		if (next !== undefined && next !== "--") {
			setOption(options, optionName, next);
			return 1;
		}

		setOption(options, optionName, "");
		return 0;
	}

	for (const flag of alias.split("")) {
		const flagDefinition = findOptionDefinition(command, flag);
		setOption(options, flagDefinition?.name ?? flag, true);
	}

	return 0;
}

function splitOptionToken(token: string): [string, string | undefined] {
	const separator = token.indexOf("=");

	if (separator === -1) {
		return [token, undefined];
	}

	return [token.slice(0, separator), token.slice(separator + 1)];
}

function findOptionDefinition(
	command: Command | undefined,
	name: string,
): CommandOptionDefinition | undefined {
	return command?.optionDefinitions.find(
		(definition) => definition.name === name || definition.alias === name,
	);
}

function optionAcceptsValue(
	definition: CommandOptionDefinition | undefined,
): boolean {
	return definition?.value === "string";
}

function applyOptionDefaults(
	definitions: readonly CommandOptionDefinition[],
	options: ConsoleOptions,
): ConsoleOptions {
	const optionsWithDefaults = { ...options };

	for (const definition of definitions) {
		if (
			definition.default !== undefined &&
			optionsWithDefaults[definition.name] === undefined
		) {
			optionsWithDefaults[definition.name] = definition.default;
		}
	}

	return optionsWithDefaults;
}

function setOption(
	options: ConsoleOptions,
	name: string,
	value: ConsoleOptionValue,
): void {
	const current = options[name];

	if (current === undefined) {
		options[name] = value;
		return;
	}

	if (Array.isArray(current)) {
		options[name] = [...current, String(value)];
		return;
	}

	options[name] = [String(current), String(value)];
}

function isShortOption(token: string): boolean {
	return token.startsWith("-") && !token.startsWith("--") && token.length > 1;
}

function assertCommandName(name: string): void {
	if (!/^[a-z][a-z0-9:_-]*$/i.test(name)) {
		throw ConsoleException.invalidCommandName(name);
	}
}

function formatArguments(
	definitions: readonly CommandArgumentDefinition[],
): string {
	if (definitions.length === 0) {
		return "";
	}

	return ` ${definitions.map(formatArgument).join(" ")}`;
}

function formatArgument(definition: CommandArgumentDefinition): string {
	const suffix = definition.variadic ? "..." : "";

	return definition.required
		? `<${definition.name}${suffix}>`
		: `[${definition.name}${suffix}]`;
}

function formatOptions(
	definitions: readonly CommandOptionDefinition[],
): string {
	return definitions.length > 0 ? " [options]" : "";
}

function formatOption(definition: CommandOptionDefinition): string {
	const name = `--${definition.name}`;
	const value = definition.value === "string" ? "=<value>" : "";

	if (!definition.alias) {
		return `${name}${value}`;
	}

	return `-${definition.alias}, ${name}${value}`;
}

function pad(value: string, length: number): string {
	return value.padEnd(length, " ");
}

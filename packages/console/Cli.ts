import {
	registerServeCommand,
	type ServeConsoleOptions,
} from "../http/ServeConsole";
import { type ConsoleKernel, createConsole } from "./Console";
import {
	type DevToolConsoleOptions,
	registerDevToolCommands,
} from "./DevTools";
import {
	type GeneratorConsoleOptions,
	registerGeneratorCommands,
} from "./Generators";
import { type NewAppConsoleOptions, registerNewAppCommand } from "./NewApp";

export interface KuraCliOptions {
	readonly newApp?: NewAppConsoleOptions;
	readonly generators?: GeneratorConsoleOptions;
	readonly serve?: ServeConsoleOptions;
	readonly devTools?: DevToolConsoleOptions;
}

export function createKuraConsole(options: KuraCliOptions = {}): ConsoleKernel {
	const console = createConsole();

	registerNewAppCommand(console, options.newApp);
	registerGeneratorCommands(console, options.generators);
	registerServeCommand(console, options.serve);
	registerDevToolCommands(console, options.devTools);

	return console;
}

export async function runKuraCli(
	argv: readonly string[] = Bun.argv.slice(2),
	options: KuraCliOptions = {},
): Promise<number> {
	return createKuraConsole(options).run(argv);
}

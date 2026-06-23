import {
	type PreviewConsoleOptions,
	registerPreviewCommand,
	registerServeCommand,
	type ServeConsoleOptions,
} from "../http/ServeConsole";
import { type ConsoleKernel, createConsole } from "./Console";
import {
	type DevToolConsoleOptions,
	registerDevToolCommands,
} from "./DevTools";
import {
	type FeatureConsoleOptions,
	registerFeatureCommands,
} from "./FeatureInstaller";
import {
	type GeneratorConsoleOptions,
	registerGeneratorCommands,
} from "./Generators";
import { type NewAppConsoleOptions, registerNewAppCommand } from "./NewApp";
import { registerUpgradeCommands, type UpgradeConsoleOptions } from "./Upgrade";

export interface KuraCliOptions {
	readonly newApp?: NewAppConsoleOptions;
	readonly generators?: GeneratorConsoleOptions;
	readonly serve?: ServeConsoleOptions;
	readonly preview?: PreviewConsoleOptions;
	readonly devTools?: DevToolConsoleOptions;
	readonly features?: FeatureConsoleOptions;
	readonly upgrade?: UpgradeConsoleOptions;
}

export function createKuraConsole(options: KuraCliOptions = {}): ConsoleKernel {
	const console = createConsole();

	registerNewAppCommand(console, options.newApp);
	registerFeatureCommands(console, options.features);
	registerGeneratorCommands(console, options.generators);
	registerUpgradeCommands(console, options.upgrade);
	registerServeCommand(console, options.serve);
	registerPreviewCommand(console, options.preview);
	registerDevToolCommands(console, options.devTools);

	return console;
}

export async function runKuraCli(
	argv: readonly string[] = Bun.argv.slice(2),
	options: KuraCliOptions = {},
): Promise<number> {
	return createKuraConsole(options).run(argv);
}

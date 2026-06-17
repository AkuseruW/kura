#!/usr/bin/env bun
import {
	createConsole,
	registerDevToolCommands,
	registerGeneratorCommands,
	registerNewAppCommand,
	registerServeCommand,
} from "../index";

const appConsole = createConsole();
registerNewAppCommand(appConsole);
registerGeneratorCommands(appConsole);
registerServeCommand(appConsole);
registerDevToolCommands(appConsole);
const exitCode = await appConsole.run(Bun.argv.slice(2));

process.exit(exitCode);

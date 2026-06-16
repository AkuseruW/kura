#!/usr/bin/env bun
import {
	createConsole,
	registerGeneratorCommands,
	registerServeCommand,
} from "../index";

const appConsole = createConsole();
registerGeneratorCommands(appConsole);
registerServeCommand(appConsole);
const exitCode = await appConsole.run(Bun.argv.slice(2));

process.exit(exitCode);

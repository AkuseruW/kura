#!/usr/bin/env bun
import { createConsole } from "../console/Console";
import { registerNewAppCommand } from "../console/NewApp";

const appConsole = createConsole();

registerNewAppCommand(appConsole);

const exitCode = await appConsole.run(["new", ...Bun.argv.slice(2)]);
process.exit(exitCode);

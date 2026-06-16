#!/usr/bin/env bun
import { createConsole } from "../index";

const appConsole = createConsole();
const exitCode = await appConsole.run(Bun.argv.slice(2));

process.exit(exitCode);

#!/usr/bin/env bun
import { createConsole } from "../console/Console";
import { registerNewAppCommand } from "../console/NewApp";
import { resolveBundledRuntimePackageVersion } from "./PackageVersion";

const appConsole = createConsole();

registerNewAppCommand(appConsole, {
	packageVersion: await resolveBundledRuntimePackageVersion(),
});

const exitCode = await appConsole.run(["new", ...Bun.argv.slice(2)]);
process.exit(exitCode);

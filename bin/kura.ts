#!/usr/bin/env bun
import { runKuraCli } from "../console";
import { runLocalAppConsole } from "../packages/console/LocalAppConsole";

const argv = Bun.argv.slice(2);
const exitCode = (await runLocalAppConsole(argv)) ?? (await runKuraCli(argv));

process.exit(exitCode);

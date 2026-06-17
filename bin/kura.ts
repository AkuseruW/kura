#!/usr/bin/env bun
import { runKuraCli } from "../index";

const exitCode = await runKuraCli(Bun.argv.slice(2));

process.exit(exitCode);

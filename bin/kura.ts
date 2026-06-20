#!/usr/bin/env bun
import { runKuraCli } from "../console";

const exitCode = await runKuraCli(Bun.argv.slice(2));

process.exit(exitCode);

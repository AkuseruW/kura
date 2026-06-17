#!/usr/bin/env bun
import { access } from "node:fs/promises";

type KuraRuntime = {
	readonly runKuraCli: (argv?: readonly string[]) => Promise<number>;
};

const runtimePackageName = "kurajs";

const { runKuraCli } = await loadKuraRuntime();
const exitCode = await runKuraCli(["new", ...Bun.argv.slice(2)]);

process.exit(exitCode);

async function loadKuraRuntime(): Promise<KuraRuntime> {
	const localRuntimeUrl = new URL("../../../dist/index.js", import.meta.url);

	if (await exists(localRuntimeUrl)) {
		return asKuraRuntime(await import(localRuntimeUrl.href));
	}

	return asKuraRuntime(await import(runtimePackageName));
}

function asKuraRuntime(module: unknown): KuraRuntime {
	if (!isRecord(module) || typeof module.runKuraCli !== "function") {
		throw new Error("Unable to load the Kura runtime");
	}

	return {
		runKuraCli: module.runKuraCli as KuraRuntime["runKuraCli"],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function exists(path: URL): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

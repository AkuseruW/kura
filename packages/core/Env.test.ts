import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Env } from "./Env";

const roots: string[] = [];
const previousEnv = new Map<string, string | undefined>();

afterEach(async () => {
	for (const [key, value] of previousEnv) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	previousEnv.clear();

	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("Env", () => {
	test("loads dotenv values without overriding existing process values", async () => {
		const root = await makeRoot();
		const envFile = join(root, ".env");
		await writeFile(
			envFile,
			["NODE_ENV=development", "APP_NAME=Kura"].join("\n"),
		);
		setEnv("NODE_ENV", "production");
		const env = new Env();

		await env.load(envFile, { override: false });

		expect(process.env.NODE_ENV).toBe("production");
		expect(process.env.APP_NAME).toBe("Kura");
	});
});

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-env-"));
	roots.push(root);
	return root;
}

function setEnv(key: string, value: string): void {
	if (!previousEnv.has(key)) {
		previousEnv.set(key, process.env[key]);
	}
	process.env[key] = value;
}

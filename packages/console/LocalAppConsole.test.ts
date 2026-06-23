import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findLocalAppConsole, runLocalAppConsole } from "./LocalAppConsole";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true })),
	);
});

describe("local app console", () => {
	test("finds a generated app console from nested directories", async () => {
		const root = await createAppRoot();
		const nested = join(root, "app", "domains", "posts");

		await mkdir(nested, { recursive: true });

		expect(findLocalAppConsole(nested)).toEqual({
			root,
			entry: join(root, "bin", "console.ts"),
		});
	});

	test("ignores directories that do not look like Kura apps", async () => {
		const root = await mkdtemp(join(tmpdir(), "kura-local-console-"));
		tempRoots.push(root);
		await mkdir(join(root, "bin"), { recursive: true });
		await writeFile(join(root, "bin", "console.ts"), "console.log('nope');\n");
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ name: "not-kura" }),
		);

		expect(findLocalAppConsole(root)).toBeUndefined();
	});

	test("runs the app console instead of the global framework command", async () => {
		const root = await createAppRoot();
		await writeFile(
			join(root, "bin", "console.ts"),
			[
				"import { writeFile } from 'node:fs/promises';",
				"import { join } from 'node:path';",
				"await writeFile(join(process.cwd(), 'called.json'), JSON.stringify({ cwd: process.cwd(), argv: Bun.argv.slice(2) }));",
			].join("\n"),
		);

		const exitCode = await runLocalAppConsole(["serve", "--port", "3440"], {
			cwd: root,
			bunPath: process.execPath,
		});

		expect(exitCode).toBe(0);
		expect(
			JSON.parse(await readFile(join(root, "called.json"), "utf8")),
		).toEqual({
			cwd: await realpath(root),
			argv: ["serve", "--port", "3440"],
		});
	});

	test("keeps app creation on the global framework command", async () => {
		const root = await createAppRoot();

		expect(
			await runLocalAppConsole(["new", "demo"], { cwd: root }),
		).toBeUndefined();
		expect(
			await runLocalAppConsole(["help", "new"], { cwd: root }),
		).toBeUndefined();
	});
});

async function createAppRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-local-console-"));
	tempRoots.push(root);
	await mkdir(join(root, "bin"), { recursive: true });
	await writeFile(join(root, "bin", "console.ts"), "process.exit(0);\n");
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "demo",
			scripts: {
				kura: "bun bin/console.ts",
			},
			dependencies: {
				kura: "npm:@akuseru_w/kura@0.1.12",
			},
		}),
	);

	return root;
}

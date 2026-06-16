import { describe, expect, test } from "bun:test";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

describe("production build", () => {
	test("emits optimized runtime bundles, source maps, and declarations", async () => {
		await rm(join(root, "dist"), { force: true, recursive: true });

		try {
			const build = Bun.spawnSync({
				cmd: [process.execPath, "run", "build"],
				cwd: root,
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(build.exitCode).toBe(0);
			await expectFile("dist/index.js");
			await expectFile("dist/index.js.map");
			await expectFile("dist/index.d.ts");
			await expectFile("dist/index.d.ts.map");
			await expectFile("dist/bin/kura.js");
			await expectFile("dist/bin/kura.js.map");

			const moduleExports = (await import(
				`${pathToFileURL(join(root, "dist/index.js")).href}?t=${Date.now()}`
			)) as Record<string, unknown>;
			expect(typeof moduleExports.createConsole).toBe("function");
			expect(typeof moduleExports.createTestClient).toBe("function");

			const cli = Bun.spawnSync({
				cmd: [process.execPath, "dist/bin/kura.js", "help", "serve"],
				cwd: root,
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(cli.exitCode).toBe(0);
			expect(cli.stdout.toString()).toContain(
				"serve - Start the development HTTP server",
			);
		} finally {
			await rm(join(root, "dist"), { force: true, recursive: true });
		}
	});
});

async function expectFile(path: string): Promise<void> {
	await expect(access(join(root, path))).resolves.toBeNull();
}

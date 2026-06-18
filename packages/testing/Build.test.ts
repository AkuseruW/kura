import { describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

describe("production build", () => {
	test("emits optimized runtime bundles, source maps, and declarations", async () => {
		const appRoot = await mkdtemp(join(tmpdir(), "kura-built-app-"));

		await rm(join(root, "dist"), { force: true, recursive: true });
		await rm(join(root, "packages/create-kura-app/dist"), {
			force: true,
			recursive: true,
		});

		try {
			const runtimePackage = JSON.parse(
				await readFile(join(root, "package.json"), "utf8"),
			) as {
				readonly name: string;
				readonly bin: Record<string, string>;
				readonly files: readonly string[];
			};
			expect(runtimePackage.name).toBe("@akuseru_w/kura");
			expect(runtimePackage.files).toContain("dist");
			expect(runtimePackage.bin.kura).toBe("./dist/bin/kura.js");

			const createPackageManifest = JSON.parse(
				await readFile(
					join(root, "packages/create-kura-app/package.json"),
					"utf8",
				),
			) as {
				readonly name: string;
				readonly bin: Record<string, string>;
				readonly dependencies: Record<string, string>;
			};
			expect(createPackageManifest.name).toBe("create-kura-app");
			expect(createPackageManifest.bin["create-kura-app"]).toBe(
				"./dist/index.js",
			);
			expect(createPackageManifest.dependencies["@akuseru_w/kura"]).toBe(
				"^0.1.6",
			);

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
			await expectFile("packages/create-kura-app/dist/index.js");
			await expectFile("packages/create-kura-app/dist/index.js.map");

			const moduleExports = (await import(
				`${pathToFileURL(join(root, "dist/index.js")).href}?t=${Date.now()}`
			)) as Record<string, unknown>;
			expect(typeof moduleExports.createConsole).toBe("function");
			expect(typeof moduleExports.runKuraCli).toBe("function");
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

			const newApp = Bun.spawnSync({
				cmd: [
					process.execPath,
					"dist/bin/kura.js",
					"new",
					"demo",
					"--yes",
					"--root",
					appRoot,
				],
				cwd: root,
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(newApp.exitCode).toBe(0);

			const generatedPackage = JSON.parse(
				await readFile(join(appRoot, "demo/package.json"), "utf8"),
			) as { dependencies: { kura: string } };
			expect(generatedPackage.dependencies.kura).toStartWith("file:");
			expect(generatedPackage.dependencies.kura).toEndWith("dist");

			const install = Bun.spawnSync({
				cmd: [process.execPath, "install"],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(install.exitCode).toBe(0);

			const importRuntime = Bun.spawnSync({
				cmd: [
					process.execPath,
					"-e",
					"import { Router, Server } from 'kura'; console.log(typeof Router, typeof Server);",
				],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(importRuntime.exitCode).toBe(0);
			expect(importRuntime.stdout.toString()).toContain("function function");

			const appTypecheck = Bun.spawnSync({
				cmd: [process.execPath, "run", "typecheck"],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(appTypecheck.exitCode).toBe(0);

			const appBuild = Bun.spawnSync({
				cmd: [process.execPath, "run", "build"],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(appBuild.exitCode).toBe(0);
			await expect(
				access(join(appRoot, "demo/build/server.js")),
			).resolves.toBeNull();

			const localRunner = Bun.spawnSync({
				cmd: [process.execPath, "kura"],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(localRunner.exitCode).toBe(0);
			expect(localRunner.stdout.toString()).toContain("Kura Console");
			expect(localRunner.stdout.toString()).toContain("make:controller");

			const createPackage = Bun.spawnSync({
				cmd: [
					process.execPath,
					"packages/create-kura-app/dist/index.js",
					"--help",
				],
				cwd: root,
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(createPackage.exitCode).toBe(0);
			expect(createPackage.stdout.toString()).toContain(
				"new - Create a new Kura application",
			);

			const routes = Bun.spawnSync({
				cmd: [process.execPath, "kura", "routes"],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(routes.exitCode).toBe(0);
			expect(routes.stdout.toString()).toContain("Routes");
			expect(routes.stdout.toString()).toContain("GET");
			expect(routes.stdout.toString()).toContain("/");

			const doctor = Bun.spawnSync({
				cmd: [process.execPath, "kura", "doctor"],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(doctor.exitCode).toBe(0);
			expect(doctor.stdout.toString()).toContain("Kura doctor");
			expect(doctor.stdout.toString()).toContain("routes");

			const env = Bun.spawnSync({
				cmd: [process.execPath, "kura", "env"],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(env.exitCode).toBe(0);
			expect(env.stdout.toString()).toContain("Environment");
			expect(env.stdout.toString()).toContain("APP_KEY");

			const config = Bun.spawnSync({
				cmd: [process.execPath, "kura", "config", "app.starter"],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(config.exitCode).toBe(0);
			expect(config.stdout.toString()).toContain("preset");

			const makeController = Bun.spawnSync({
				cmd: [process.execPath, "kura", "make:controller", "Home"],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(makeController.exitCode).toBe(0);
			await expect(
				access(join(appRoot, "demo/app/controllers/home_controller.ts")),
			).resolves.toBeNull();
		} finally {
			await rm(join(root, "dist"), { force: true, recursive: true });
			await rm(join(root, "packages/create-kura-app/dist"), {
				force: true,
				recursive: true,
			});
			await rm(appRoot, { force: true, recursive: true });
		}
	}, 15000);
});

async function expectFile(path: string): Promise<void> {
	await expect(access(join(root, path))).resolves.toBeNull();
}

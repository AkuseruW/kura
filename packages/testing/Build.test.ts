import { describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
			expect(runtimePackage.bin.kura).toBe("dist/bin/kura.js");

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
				"dist/index.js",
			);
			expect(createPackageManifest.dependencies["@akuseru_w/kura"]).toBe(
				"^0.1.10",
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
			await expectFile("dist/auth.js");
			await expectFile("dist/auth.d.ts");
			await expectFile("dist/cache.js");
			await expectFile("dist/cache.d.ts");
			await expectFile("dist/config.js");
			await expectFile("dist/config.d.ts");
			await expectFile("dist/container.js");
			await expectFile("dist/container.d.ts");
			await expectFile("dist/console.js");
			await expectFile("dist/console.d.ts");
			await expectFile("dist/core.js");
			await expectFile("dist/core.d.ts");
			await expectFile("dist/database.js");
			await expectFile("dist/database.d.ts");
			await expectFile("dist/env.js");
			await expectFile("dist/env.d.ts");
			await expectFile("dist/events.js");
			await expectFile("dist/events.d.ts");
			await expectFile("dist/hash.js");
			await expectFile("dist/hash.d.ts");
			await expectFile("dist/http.js");
			await expectFile("dist/http.d.ts");
			await expectFile("dist/openapi.js");
			await expectFile("dist/openapi.d.ts");
			await expectFile("dist/queue.js");
			await expectFile("dist/queue.d.ts");
			await expectFile("dist/queue/redis.js");
			await expectFile("dist/queue/redis.d.ts");
			await expectFile("dist/queue/sqlite.js");
			await expectFile("dist/queue/sqlite.d.ts");
			await expectFile("dist/testing.js");
			await expectFile("dist/testing.d.ts");
			await expectFile("dist/validation.js");
			await expectFile("dist/validation.d.ts");
			await expectFile("dist/view.js");
			await expectFile("dist/view.d.ts");
			await expectFile("dist/bin/kura.js");
			await expectFile("dist/bin/kura.js.map");
			await expectFile("packages/create-kura-app/dist/index.js");
			await expectFile("packages/create-kura-app/dist/index.js.map");

			const distPackage = JSON.parse(
				await readFile(join(root, "dist/package.json"), "utf8"),
			) as {
				readonly exports: Record<string, unknown>;
			};
			expect(Object.keys(distPackage.exports)).toContain("./http");
			expect(Object.keys(distPackage.exports)).toContain("./database");
			expect(Object.keys(distPackage.exports)).toContain("./openapi");
			expect(Object.keys(distPackage.exports)).toContain("./queue/sqlite");
			expect(Object.keys(distPackage.exports)).toContain("./view");

			const moduleExports = (await import(
				`${pathToFileURL(join(root, "dist/index.js")).href}?t=${Date.now()}`
			)) as Record<string, unknown>;
			expect(typeof moduleExports.createConsole).toBe("function");
			expect(typeof moduleExports.runKuraCli).toBe("function");
			expect(typeof moduleExports.createTestClient).toBe("function");
			expect(moduleExports.SQLiteQueueDriver).toBeUndefined();

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
					"--preset",
					"full",
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

			const importSubpaths = Bun.spawnSync({
				cmd: [
					process.execPath,
					"-e",
					[
						"import { AccessTokenManager } from 'kura/auth';",
						"import { defineConfig } from 'kura/config';",
						"import { Application } from 'kura/core';",
						"import { BaseModel, SQLiteDatabaseDriver } from 'kura/database';",
						"import { Env } from 'kura/env';",
						"import { Event } from 'kura/events';",
						"import { Hash } from 'kura/hash';",
						"import { Router } from 'kura/http';",
						"import { registerOpenApiRoutes } from 'kura/openapi';",
						"import { QueueManager } from 'kura/queue';",
						"import { RedisQueueDriver } from 'kura/queue/redis';",
						"import { SQLiteQueueDriver } from 'kura/queue/sqlite';",
						"import { FakeQueueDriver } from 'kura/testing';",
						"import { k } from 'kura/validation';",
						"import { view } from 'kura/view';",
						"console.log(typeof AccessTokenManager, typeof defineConfig, typeof Application, typeof BaseModel, typeof SQLiteDatabaseDriver, typeof Env, typeof Event, typeof Hash, typeof Router, typeof registerOpenApiRoutes, typeof QueueManager, typeof RedisQueueDriver, typeof SQLiteQueueDriver, typeof FakeQueueDriver, typeof k.object, typeof view);",
					].join(" "),
				],
				cwd: join(appRoot, "demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(importSubpaths.exitCode).toBe(0);
			expect(importSubpaths.stdout.toString()).toContain(
				"function function function function function function function function function function function function function function function function",
			);

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
				access(join(appRoot, "demo/build/bin/server.js")),
			).resolves.toBeNull();
			await expect(
				access(join(appRoot, "demo/build/resources/pages/home.html")),
			).resolves.toBeNull();
			expect(
				await readFile(join(appRoot, "demo/resources/pages/home.html"), "utf8"),
			).toContain("../client/app.ts");

			const port = reservePort();
			await writeFile(
				join(appRoot, "demo/.env"),
				[
					"APP_NAME=Kura",
					"TZ=UTC",
					`PORT=${port}`,
					"HOST=localhost",
					"NODE_ENV=production",
					"LOG_LEVEL=silent",
					"APP_KEY=local-development-key",
					`APP_URL=http://localhost:${port}`,
					"",
				].join("\n"),
			);
			const server = Bun.spawn({
				cmd: [process.execPath, "bin/server.ts"],
				cwd: join(appRoot, "demo"),
				env: childEnv({ NODE_ENV: "production" }),
				stderr: "pipe",
				stdout: "pipe",
			});

			try {
				await waitForHttp(`http://localhost:${port}/api/health`);

				const home = await fetch(`http://localhost:${port}/`);
				expect(home.status).toBe(200);
				expect(home.headers.get("content-type")).toContain("text/html");
				const homeHtml = await home.text();
				expect(homeHtml).toContain("<h1>Kura</h1>");
				expect(homeHtml).not.toContain("Build Failed");

				const health = await fetch(`http://localhost:${port}/api/health`);
				expect(health.status).toBe(200);
				expect(await health.json()).toEqual({ status: "up" });
			} finally {
				server.kill();
				await server.exited.catch(() => undefined);
			}

			const preview = Bun.spawn({
				cmd: [process.execPath, "kura", "preview", "--no-build"],
				cwd: join(appRoot, "demo"),
				env: childEnv({ NODE_ENV: "production" }),
				stderr: "pipe",
				stdout: "pipe",
			});

			try {
				await waitForHttp(`http://localhost:${port}/api/health`);

				const health = await fetch(`http://localhost:${port}/api/health`);
				expect(health.status).toBe(200);
				expect(await health.json()).toEqual({ status: "up" });
			} finally {
				preview.kill();
				await preview.exited.catch(() => undefined);
			}

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

			const newSqliteApp = Bun.spawnSync({
				cmd: [
					process.execPath,
					"dist/bin/kura.js",
					"new",
					"sqlite-demo",
					"--yes",
					"--preset",
					"api",
					"--database",
					"sqlite",
					"--auth",
					"access-token",
					"--root",
					appRoot,
				],
				cwd: root,
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(newSqliteApp.exitCode).toBe(0);

			const sqliteInstall = Bun.spawnSync({
				cmd: [process.execPath, "install"],
				cwd: join(appRoot, "sqlite-demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(sqliteInstall.exitCode).toBe(0);

			const sqliteMigrate = Bun.spawnSync({
				cmd: [process.execPath, "kura", "migration:run"],
				cwd: join(appRoot, "sqlite-demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(sqliteMigrate.exitCode).toBe(0);
			expect(sqliteMigrate.stdout.toString()).toContain(
				"Migrated 2 migrations",
			);
			await expect(
				access(join(appRoot, "sqlite-demo/database/database.sqlite")),
			).resolves.toBeNull();

			const sqliteTypecheck = Bun.spawnSync({
				cmd: [process.execPath, "run", "typecheck"],
				cwd: join(appRoot, "sqlite-demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(sqliteTypecheck.exitCode).toBe(0);

			const sqliteBuild = Bun.spawnSync({
				cmd: [process.execPath, "run", "build"],
				cwd: join(appRoot, "sqlite-demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(sqliteBuild.exitCode).toBe(0);

			const sqliteDeployDoctor = Bun.spawnSync({
				cmd: [process.execPath, "kura", "deploy:doctor"],
				cwd: join(appRoot, "sqlite-demo"),
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(sqliteDeployDoctor.exitCode).toBe(1);
			expect(sqliteDeployDoctor.stdout.toString()).toContain(
				"runtime dependencies use local paths: kura",
			);
			expect(sqliteDeployDoctor.stdout.toString()).toContain(
				"SQLite persistence uses /app/database",
			);

			const sqlitePort = reservePort();
			await writeFile(
				join(appRoot, "sqlite-demo/.env"),
				[
					"APP_NAME=Kura API",
					"TZ=UTC",
					`PORT=${sqlitePort}`,
					"HOST=localhost",
					"NODE_ENV=production",
					"LOG_LEVEL=silent",
					"APP_KEY=local-development-key",
					`APP_URL=http://localhost:${sqlitePort}`,
					"HASH_DRIVER=bcrypt",
					"AUTH_GUARD=api",
					"DB_CONNECTION=sqlite",
					"",
				].join("\n"),
			);

			const sqlitePreview = Bun.spawn({
				cmd: [process.execPath, "kura", "preview", "--no-build"],
				cwd: join(appRoot, "sqlite-demo"),
				env: childEnv({ NODE_ENV: "production" }),
				stderr: "pipe",
				stdout: "pipe",
			});

			try {
				await waitForHttp(`http://localhost:${sqlitePort}/health`);

				const health = await fetch(`http://localhost:${sqlitePort}/health`);
				expect(health.status).toBe(200);
				expect(await health.json()).toEqual({ status: "up" });

				const register = await fetch(
					`http://localhost:${sqlitePort}/auth/register`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							email: "ada@example.com",
							password: "secret",
						}),
					},
				);
				expect(register.status).toBe(201);
				const payload = (await register.json()) as {
					readonly tokenType?: string;
					readonly user?: { readonly email?: string };
				};
				expect(payload.tokenType).toBe("Bearer");
				expect(payload.user?.email).toBe("ada@example.com");
			} finally {
				sqlitePreview.kill();
				await sqlitePreview.exited.catch(() => undefined);
			}
		} finally {
			await rm(join(root, "dist"), { force: true, recursive: true });
			await rm(join(root, "packages/create-kura-app/dist"), {
				force: true,
				recursive: true,
			});
			await rm(appRoot, { force: true, recursive: true });
		}
	}, 45000);
});

async function expectFile(path: string): Promise<void> {
	await expect(access(join(root, path))).resolves.toBeNull();
}

function reservePort(): number {
	const server = Bun.serve({
		port: 0,
		fetch: () => new Response("ok"),
	});
	const port = server.port;
	server.stop();

	if (port === undefined) {
		throw new Error("Unable to reserve a test port");
	}

	return port;
}

function childEnv(overrides: Record<string, string>): Record<string, string> {
	const env: Record<string, string> = {};

	for (const [key, value] of Object.entries(Bun.env)) {
		if (value !== undefined) {
			env[key] = value;
		}
	}

	return {
		...env,
		...overrides,
	};
}

async function waitForHttp(url: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			await response.arrayBuffer();
			if (response.ok) {
				return;
			}
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}

		await Bun.sleep(25);
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`Timed out waiting for ${url}`);
}

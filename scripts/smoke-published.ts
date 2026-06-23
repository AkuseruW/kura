import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type SpawnResult = {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
};

const runtimePackageName = "@akuseru_w/kura";
const createPackageName = "create-kura-app";
const appName = "kura-smoke";
const repoRoot = process.cwd();
const expectedVersion =
	Bun.env.KURA_SMOKE_VERSION ?? (await readPackageVersion(repoRoot));
const root = await mkdtemp(join(tmpdir(), "kura-published-smoke-"));
const appRoot = join(root, appName);
const port = reservePort();

try {
	await assertLatestVersion(runtimePackageName, expectedVersion);
	await assertLatestVersion(createPackageName, expectedVersion);

	if (Bun.env.KURA_SMOKE_CLEAR_CACHE !== "false") {
		run([process.execPath, "pm", "cache", "rm"], { cwd: repoRoot });
	}

	run(
		[
			process.execPath,
			"create",
			`kura-app@${expectedVersion}`,
			appName,
			"--yes",
			"--preset",
			"api",
			"--architecture",
			"domain",
			"--database",
			"sqlite",
			"--auth",
			"access-token",
			"--install",
		],
		{ cwd: root },
	);

	await assertGeneratedRuntimeDependency(appRoot, expectedVersion);

	run(
		[
			process.execPath,
			"install",
			"-g",
			`${runtimePackageName}@${expectedVersion}`,
		],
		{
			cwd: appRoot,
		},
	);
	run(["kura", "help", "serve"], {
		cwd: appRoot,
		mustContain: ["Start the development HTTP server"],
	});
	run([process.execPath, "bin/console.ts", "routes"], {
		cwd: appRoot,
		mustContain: ["/health", "/docs"],
	});
	run([process.execPath, "run", "typecheck"], { cwd: appRoot });
	run([process.execPath, "run", "build"], { cwd: appRoot });

	const server = Bun.spawn({
		cmd: [process.execPath, "bin/console.ts", "serve", "--port", String(port)],
		cwd: appRoot,
		env: Bun.env,
		stderr: "pipe",
		stdout: "pipe",
	});

	try {
		await waitForHttp(`http://127.0.0.1:${port}/health`);
		await assertHttp(`http://127.0.0.1:${port}/health`, 200);
		await assertHttp(`http://127.0.0.1:${port}/docs`, 200);
		await assertHttp(`http://127.0.0.1:${port}/openapi.json`, 200);
	} finally {
		server.kill();
		await server.exited.catch(() => undefined);
	}

	console.log(`Published package smoke passed for ${expectedVersion}.`);
	console.log(`Generated app: ${appRoot}`);
} finally {
	if (Bun.env.KURA_SMOKE_KEEP !== "true") {
		await rm(root, { force: true, recursive: true });
	}
}

async function readPackageVersion(path: string): Promise<string> {
	const packageJson = JSON.parse(
		await readFile(join(path, "package.json"), "utf8"),
	) as {
		readonly version?: string;
	};

	if (typeof packageJson.version !== "string") {
		throw new Error("package.json does not define a version.");
	}

	return packageJson.version;
}

async function assertLatestVersion(
	packageName: string,
	version: string,
): Promise<void> {
	const result = run(["npm", "view", packageName, "version"], {
		cwd: process.cwd(),
	});
	const latestVersion = result.stdout.trim();

	if (latestVersion !== version) {
		throw new Error(
			`${packageName} latest version is ${latestVersion}, expected ${version}. Publish the release first or set KURA_SMOKE_VERSION.`,
		);
	}
}

async function assertGeneratedRuntimeDependency(
	path: string,
	version: string,
): Promise<void> {
	const packageJson = JSON.parse(
		await readFile(join(path, "package.json"), "utf8"),
	) as { readonly dependencies?: { readonly kura?: string } };
	const actual = packageJson.dependencies?.kura;
	const expected = `npm:${runtimePackageName}@${version}`;

	if (actual !== expected) {
		throw new Error(
			`Generated app dependency is ${actual}, expected ${expected}.`,
		);
	}
}

function run(
	cmd: readonly string[],
	options: {
		readonly cwd: string;
		readonly mustContain?: readonly string[];
	},
): SpawnResult {
	const result = Bun.spawnSync({
		cmd: [...cmd],
		cwd: options.cwd,
		env: Bun.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();

	if (result.exitCode !== 0) {
		throw new Error(
			[
				`Command failed: ${cmd.join(" ")}`,
				`cwd: ${options.cwd}`,
				stdout,
				stderr,
			].join("\n"),
		);
	}

	for (const expectedOutput of options.mustContain ?? []) {
		if (!stdout.includes(expectedOutput)) {
			throw new Error(
				`Command output for [${cmd.join(" ")}] did not contain [${expectedOutput}].`,
			);
		}
	}

	return {
		exitCode: result.exitCode,
		stderr,
		stdout,
	};
}

async function waitForHttp(url: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);

			if (response.ok) {
				return;
			}
		} catch (error) {
			lastError = error;
		}

		await Bun.sleep(250);
	}

	throw new Error(
		`Timed out waiting for ${url}${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
	);
}

async function assertHttp(url: string, expectedStatus: number): Promise<void> {
	const response = await fetch(url);

	if (response.status !== expectedStatus) {
		throw new Error(
			`${url} returned ${response.status}, expected ${expectedStatus}.`,
		);
	}
}

function reservePort(): number {
	const server = Bun.serve({
		port: 0,
		fetch: () => new Response("ok"),
	});
	const resolvedPort = server.port;
	server.stop();

	if (resolvedPort === undefined) {
		throw new Error("Unable to reserve a smoke test port.");
	}

	return resolvedPort;
}

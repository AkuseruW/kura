import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleKernel, MemoryConsoleOutput } from "./Console";
import { registerGeneratorCommands } from "./Generators";

const roots: string[] = [];
const fixedNow = () => new Date("2026-06-16T17:10:11.000Z");

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-generators-"));
	roots.push(root);
	return root;
}

async function readGenerated(root: string, path: string): Promise<string> {
	return readFile(join(root, path), "utf8");
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("generator console commands", () => {
	test("registers every make command", () => {
		const console = new ConsoleKernel(new MemoryConsoleOutput());

		registerGeneratorCommands(console, { now: fixedNow });

		expect(console.list().map((command) => command.name)).toEqual(
			[
				"make:controller",
				"make:event",
				"make:factory",
				"make:job",
				"make:mail",
				"make:middleware",
				"make:migration",
				"make:model",
				"make:policy",
				"make:seeder",
				"make:validator",
				"make:listener",
			].sort(),
		);
	});

	test("generates a model", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, { root, now: fixedNow });

		const exitCode = await console.run(["make:model", "User"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe("Created app/Models/User.ts");
		expect(await readGenerated(root, "app/Models/User.ts")).toContain(
			"export class User extends BaseModel<UserAttributes>",
		);
		expect(await readGenerated(root, "app/Models/User.ts")).toContain(
			'static override table = "users";',
		);
	});

	test("generates nested controllers without duplicating suffixes", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, { root, now: fixedNow });

		const exitCode = await console.run([
			"make:controller",
			"Admin/UserController",
		]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe(
			"Created app/Controllers/Admin/UserController.ts",
		);
		expect(
			await readGenerated(root, "app/Controllers/Admin/UserController.ts"),
		).toContain("export class AdminUserController extends BaseController");
	});

	test("generates timestamped migrations", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, { root, now: fixedNow });

		const exitCode = await console.run(["make:migration", "create_users"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe(
			"Created database/Migrations/20260616171011_create_users.ts",
		);
		expect(
			await readGenerated(
				root,
				"database/Migrations/20260616171011_create_users.ts",
			),
		).toContain('schema.createTable("users"');
	});

	test("generates the remaining templates", async () => {
		const root = await makeRoot();
		const console = new ConsoleKernel(new MemoryConsoleOutput());
		registerGeneratorCommands(console, { root, now: fixedNow });

		const cases = [
			["make:middleware", "Auth", "app/Middleware/AuthMiddleware.ts"],
			["make:validator", "CreateUser", "app/Validators/CreateUserValidator.ts"],
			["make:seeder", "User", "database/Seeders/UserSeeder.ts"],
			["make:factory", "User", "database/Factories/UserFactory.ts"],
			["make:event", "UserCreated", "app/Events/UserCreatedEvent.ts"],
			["make:listener", "SendWelcome", "app/Listeners/SendWelcomeListener.ts"],
			["make:job", "SendEmail", "app/Jobs/SendEmailJob.ts"],
			["make:mail", "Welcome", "app/Mail/WelcomeMail.ts"],
			["make:policy", "User", "app/Policies/UserPolicy.ts"],
		] as const;

		for (const [command, name, path] of cases) {
			expect(await console.run([command, name])).toBe(0);
			expect(await readGenerated(root, path)).toContain("export");
		}
	});

	test("refuses overwrite unless force is enabled", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, { root, now: fixedNow });

		expect(await console.run(["make:model", "User"])).toBe(0);
		expect(await console.run(["make:model", "User"])).toBe(1);
		expect(output.errorText()).toContain("already exists");

		const forceOutput = new MemoryConsoleOutput();
		expect(
			await console.run(["make:model", "User", "--force"], {
				output: forceOutput,
			}),
		).toBe(0);
		expect(forceOutput.text()).toBe("Overwritten app/Models/User.ts");
	});

	test("supports root option and validates names", async () => {
		const defaultRoot = await makeRoot();
		const overrideRoot = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, { root: defaultRoot, now: fixedNow });

		expect(
			await console.run(["make:job", "SyncUser", "--root", overrideRoot]),
		).toBe(0);
		expect(
			await readGenerated(overrideRoot, "app/Jobs/SyncUserJob.ts"),
		).toContain("export class SyncUserJob");

		expect(await console.run(["make:job", "../Bad"])).toBe(1);
		expect(output.errorText()).toContain(
			"Generator name segment [..] is invalid",
		);
	});
});

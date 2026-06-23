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
				"make:resource",
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
		expect(output.text()).toBe("Created app/models/user.ts");
		expect(await readGenerated(root, "app/models/user.ts")).toContain(
			"export class User extends BaseModel<UserAttributes>",
		);
		expect(await readGenerated(root, "app/models/user.ts")).toContain(
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
			"Created app/controllers/admin/user_controller.ts",
		);
		expect(
			await readGenerated(root, "app/controllers/admin/user_controller.ts"),
		).toContain("export class AdminUserController extends BaseController");
	});

	test("prints generator command help when the name is missing", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, { root, now: fixedNow });

		const exitCode = await console.run(["make:controller"]);

		expect(exitCode).toBe(1);
		expect(output.errorText()).toContain(
			"Command [make:controller] requires <name>.",
		);
		expect(output.errorText()).toContain("Usage:");
		expect(output.errorText()).toContain(
			"kura make:controller <name> [options]",
		);
		expect(output.errorText()).toContain("Example:");
		expect(output.errorText()).toContain("kura make:controller User");
	});

	test("generates module-aware files for modular architecture", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, {
			root,
			now: fixedNow,
			architecture: "modular",
		});

		expect(await console.run(["make:controller", "users/User"])).toBe(0);
		expect(output.text()).toBe("Created app/modules/users/user_controller.ts");
		expect(
			await readGenerated(root, "app/modules/users/user_controller.ts"),
		).toContain("export class UserController extends BaseController");

		expect(await console.run(["make:model", "users/User"])).toBe(0);
		expect(await readGenerated(root, "app/modules/users/user.ts")).toContain(
			"export class User extends BaseModel<UserAttributes>",
		);

		expect(await console.run(["make:validator", "users/CreateUser"])).toBe(0);
		expect(
			await readGenerated(root, "app/modules/users/create_user_validator.ts"),
		).toContain("export const createUserValidator");

		expect(await console.run(["make:factory", "User"])).toBe(0);
		expect(
			await readGenerated(root, "database/factories/user_factory.ts"),
		).toContain('from "../../app/modules/user/user"');
	});

	test("generates domain-aware files for domain architecture", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, {
			root,
			now: fixedNow,
			architecture: "domain",
		});

		expect(await console.run(["make:controller", "users/User"])).toBe(0);
		expect(output.text()).toBe(
			"Created app/domains/users/http/user_controller.ts",
		);
		expect(
			await readGenerated(root, "app/domains/users/http/user_controller.ts"),
		).toContain("export class UserController extends BaseController");

		expect(await console.run(["make:model", "users/User"])).toBe(0);
		const domainModel = await readGenerated(
			root,
			"app/domains/users/domain/user.ts",
		);
		expect(domainModel).toContain("export class User");
		expect(domainModel).not.toContain("BaseModel");

		expect(await console.run(["make:validator", "users/CreateUser"])).toBe(0);
		expect(
			await readGenerated(
				root,
				"app/domains/users/application/create_user_validator.ts",
			),
		).toContain("export const createUserValidator");

		expect(await console.run(["make:factory", "User"])).toBe(0);
		const factory = await readGenerated(
			root,
			"database/factories/user_factory.ts",
		);
		expect(factory).toContain(
			'from "../../app/domains/user/infrastructure/persistence/user_record"',
		);
		expect(factory).toContain("defineFactory(UserRecord");
	});

	test("generates timestamped migrations", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, { root, now: fixedNow });

		const exitCode = await console.run(["make:migration", "create_users"]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe(
			"Created database/migrations/20260616171011_create_users.ts",
		);
		expect(
			await readGenerated(
				root,
				"database/migrations/20260616171011_create_users.ts",
			),
		).toContain('schema.createTable("users"');
	});

	test("generates a standard REST resource workflow", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, { root, now: fixedNow });

		expect(await console.run(["make:resource", "Post"])).toBe(0);

		expect(output.text()).toContain(
			"Created app/controllers/post_controller.ts",
		);
		expect(output.text()).toContain("Created app/validators/post_validator.ts");
		expect(output.text()).toContain("Created routes/post.ts");
		expect(output.text()).toContain(
			"Register routes with registerPostResourceRoutes(router)",
		);
		expect(await readGenerated(root, "routes/post.ts")).toContain(
			"registerPostResourceRoutes",
		);
		expect(await readGenerated(root, "routes/post.ts")).toContain(
			'.as("posts.store")',
		);
		expect(
			await readGenerated(root, "tests/functional/post_resource.test.ts"),
		).toContain('client.post("/posts"');
	});

	test("generates a domain REST resource workflow", async () => {
		const root = await makeRoot();
		const output = new MemoryConsoleOutput();
		const console = new ConsoleKernel(output);
		registerGeneratorCommands(console, {
			root,
			now: fixedNow,
			architecture: "domain",
		});

		expect(await console.run(["make:resource", "posts/Post"])).toBe(0);

		expect(output.text()).toContain(
			"Created app/domains/posts/http/post_controller.ts",
		);
		expect(output.text()).toContain(
			"Created app/domains/posts/application/post_validator.ts",
		);
		expect(output.text()).toContain("Created app/domains/posts/http/routes.ts");
		expect(
			await readGenerated(root, "app/domains/posts/http/routes.ts"),
		).toContain('from "#domains/posts/application/post_validator"');
	});

	test("generates the remaining templates", async () => {
		const root = await makeRoot();
		const console = new ConsoleKernel(new MemoryConsoleOutput());
		registerGeneratorCommands(console, { root, now: fixedNow });

		const cases = [
			["make:middleware", "Auth", "app/middleware/auth_middleware.ts"],
			[
				"make:validator",
				"CreateUser",
				"app/validators/create_user_validator.ts",
			],
			["make:seeder", "User", "database/seeders/user_seeder.ts"],
			["make:factory", "User", "database/factories/user_factory.ts"],
			["make:event", "UserCreated", "app/events/user_created_event.ts"],
			[
				"make:listener",
				"SendWelcome",
				"app/listeners/send_welcome_listener.ts",
			],
			["make:job", "SendEmail", "app/jobs/send_email_job.ts"],
			["make:mail", "Welcome", "app/mails/welcome_mail.ts"],
			["make:policy", "User", "app/policies/user_policy.ts"],
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
		expect(forceOutput.text()).toBe("Overwritten app/models/user.ts");
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
			await readGenerated(overrideRoot, "app/jobs/sync_user_job.ts"),
		).toContain("export class SyncUserJob");

		expect(await console.run(["make:job", "../Bad"])).toBe(1);
		expect(output.errorText()).toContain(
			"Generator name segment [..] is invalid",
		);
	});
});

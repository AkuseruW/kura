import { describe, expect, test } from "bun:test";
import {
	ConsoleException,
	ConsoleKernel,
	defineCommand,
	MemoryConsoleOutput,
	parseArgv,
} from "./Console";

describe("ConsoleKernel", () => {
	test("registers and runs commands with args and options", async () => {
		const output = new MemoryConsoleOutput();
		const kernel = new ConsoleKernel(output);

		kernel.register(
			defineCommand(
				{
					name: "make:user",
					description: "Create a user",
					arguments: [{ name: "name", required: true }],
					options: [
						{ name: "role", alias: "r", value: "string" },
						{ name: "force", alias: "f", value: "boolean" },
					],
				},
				(ctx) => {
					output.write(
						`${ctx.args[0]}:${ctx.options.role}:${ctx.options.force}`,
					);
				},
			),
		);

		const exitCode = await kernel.run([
			"make:user",
			"Axel",
			"--role",
			"admin",
			"-f",
		]);

		expect(exitCode).toBe(0);
		expect(output.text()).toBe("Axel:admin:true");
	});

	test("supports aliases and duplicate protection", async () => {
		const output = new MemoryConsoleOutput();
		const kernel = new ConsoleKernel(output);

		kernel.register(
			defineCommand({ name: "queue:work", aliases: ["q:w"] }, (ctx) =>
				ctx.output.write("working"),
			),
		);

		expect(() =>
			kernel.register(defineCommand({ name: "q:w" }, () => undefined)),
		).toThrow("Command [q:w] is already registered");

		expect(await kernel.run(["q:w"])).toBe(0);
		expect(output.text()).toBe("working");
	});

	test("returns an error code for missing commands", async () => {
		const output = new MemoryConsoleOutput();
		const kernel = new ConsoleKernel(output);

		const exitCode = await kernel.run(["missing"]);

		expect(exitCode).toBe(1);
		expect(output.errorText()).toContain("Command [missing] was not found");
		expect(output.errorText()).toContain("Run `kura` to list commands.");
	});

	test("lists namespaced commands for unknown names", async () => {
		const output = new MemoryConsoleOutput();
		const kernel = new ConsoleKernel(output);

		kernel.register(
			defineCommand({ name: "make:controller" }, () => undefined),
		);
		kernel.register(defineCommand({ name: "make:model" }, () => undefined));
		kernel.register(defineCommand({ name: "route:list" }, () => undefined));

		const exitCode = await kernel.run(["make:dev"]);

		expect(exitCode).toBe(1);
		expect(output.errorText()).toContain("Command [make:dev] was not found");
		expect(output.errorText()).toContain("Available make commands:");
		expect(output.errorText()).toContain("make:controller");
		expect(output.errorText()).toContain("make:model");
		expect(output.errorText()).not.toContain("route:list");
	});

	test("prints command help when a required argument is missing", async () => {
		const output = new MemoryConsoleOutput();
		const kernel = new ConsoleKernel(output);
		let handled = false;

		kernel.register(
			defineCommand(
				{
					name: "make:user",
					description: "Create a user",
					arguments: [{ name: "name", required: true }],
				},
				() => {
					handled = true;
				},
			),
		);

		const exitCode = await kernel.run(["make:user"]);

		expect(exitCode).toBe(1);
		expect(handled).toBe(false);
		expect(output.errorText()).toContain(
			"Command [make:user] requires <name>.",
		);
		expect(output.errorText()).toContain("Usage:");
		expect(output.errorText()).toContain("kura make:user <name>");
		expect(output.errorText()).toContain("Example:");
		expect(output.errorText()).toContain("kura make:user User");
	});

	test("can rethrow command errors for embedding", async () => {
		const kernel = new ConsoleKernel(new MemoryConsoleOutput());

		kernel.register(
			defineCommand({ name: "fail" }, () => {
				throw new Error("Nope");
			}),
		);

		await expect(kernel.run(["fail"], { throwOnError: true })).rejects.toThrow(
			"Nope",
		);
	});

	test("generates command lists and command help", async () => {
		const output = new MemoryConsoleOutput();
		const kernel = new ConsoleKernel(output);

		kernel.register(
			defineCommand(
				{
					name: "route:list",
					description: "List routes",
					options: [{ name: "json", alias: "j" }],
				},
				() => undefined,
			),
		);

		expect(await kernel.run([])).toBe(0);
		expect(output.text()).toContain("route:list");

		const helpOutput = new MemoryConsoleOutput();
		expect(
			await kernel.run(["route:list", "--help"], { output: helpOutput }),
		).toBe(0);
		expect(helpOutput.text()).toContain("Usage:");
		expect(helpOutput.text()).toContain("-j, --json");

		const namedHelpOutput = new MemoryConsoleOutput();
		expect(
			await kernel.run(["help", "route:list"], { output: namedHelpOutput }),
		).toBe(0);
		expect(namedHelpOutput.text()).toContain("route:list - List routes");
	});

	test("validates command names", () => {
		const kernel = new ConsoleKernel(new MemoryConsoleOutput());

		expect(() =>
			kernel.register(defineCommand({ name: "bad name" }, () => undefined)),
		).toThrow(ConsoleException);
	});
});

describe("parseArgv", () => {
	test("parses long flags, short flags, defaults, and terminator args", () => {
		const command = defineCommand(
			{
				name: "mail:send",
				options: [
					{ name: "to", alias: "t", value: "string" },
					{ name: "queue", alias: "q", default: false },
					{ name: "color", default: true },
				],
			},
			() => undefined,
		);

		const parsed = parseArgv(
			[
				"mail:send",
				"-t",
				"root@example.test",
				"--queue",
				"--no-color",
				"--",
				"--literal",
			],
			command,
		);

		expect(parsed.commandName).toBe("mail:send");
		expect(parsed.args).toEqual(["--literal"]);
		expect(parsed.options).toEqual({
			to: "root@example.test",
			queue: true,
			color: false,
		});
	});

	test("keeps repeated option values", () => {
		const command = defineCommand(
			{
				name: "tag",
				options: [{ name: "tag", value: "string" }],
			},
			() => undefined,
		);

		const parsed = parseArgv(["tag", "--tag=api", "--tag=http"], command);

		expect(parsed.options.tag).toEqual(["api", "http"]);
	});

	test("does not consume positional args for boolean flags", () => {
		const command = defineCommand(
			{
				name: "make:user",
				options: [{ name: "force", value: "boolean" }],
			},
			() => undefined,
		);

		const parsed = parseArgv(["make:user", "--force", "Axel"], command);

		expect(parsed.args).toEqual(["Axel"]);
		expect(parsed.options.force).toBe(true);
	});
});

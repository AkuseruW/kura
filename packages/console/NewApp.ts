import { basename } from "node:path";
import { type Command, type ConsoleKernel, defineCommand } from "./Console";
import {
	isEnabled,
	promptChoices,
	resolveChoices,
	shouldPrompt,
} from "./new-app/Choices";
import { formatNewAppCreated, formatNewAppPlan } from "./new-app/Output";
import { resolveDefaultPackageVersion } from "./new-app/PackageVersion";
import { resolveRoot, resolveTargetPath } from "./new-app/Paths";
import { TerminalPrompt } from "./new-app/Prompt";
import { makeNewAppFiles } from "./new-app/Templates";
import type { NewAppConsoleOptions } from "./new-app/Types";
import { installDependencies, writeNewApp } from "./new-app/Writer";

export type {
	NewAppConsoleOptions,
	NewAppInstaller,
	NewAppPrompt,
} from "./new-app/Types";

export function createNewAppCommand(
	options: NewAppConsoleOptions = {},
): Command {
	return defineCommand(
		{
			name: "new",
			description: "Create a new Kura application",
			arguments: [
				{
					name: "name",
					required: true,
					description: "Application directory name",
				},
			],
			options: [
				{
					name: "root",
					alias: "r",
					value: "string",
					description: "Directory where the app should be created",
				},
				{
					name: "preset",
					value: "string",
					default: "api",
					description: "Application preset: api, web, or full",
				},
				{
					name: "database",
					value: "string",
					default: "none",
					description: "Database driver: none, sqlite, postgres, or mysql",
				},
				{
					name: "auth",
					value: "string",
					default: "none",
					description: "Auth setup: none, session, or jwt",
				},
				{
					name: "cache",
					value: "string",
					default: "memory",
					description: "Cache driver: memory, file, or redis",
				},
				{
					name: "queue",
					value: "string",
					default: "none",
					description: "Queue driver: none, memory, sqlite, or redis",
				},
				{
					name: "module",
					value: "string",
					description:
						"Optional module to enable: mail, storage, i18n, websockets",
				},
				{
					name: "yes",
					alias: "y",
					description: "Skip prompts and use option defaults",
				},
				{
					name: "interactive",
					description: "Force interactive prompts",
				},
				{
					name: "force",
					alias: "f",
					description: "Allow creating inside an existing directory",
				},
				{
					name: "install",
					description: "Run dependency installation after scaffolding",
				},
			],
		},
		async (context) => {
			const rawName = context.args[0];
			if (!rawName) {
				throw new Error("Command [new] requires an application name");
			}

			const root = resolveRoot(options, context.options);
			const targetPath = resolveTargetPath(root, rawName);
			const interactive = shouldPrompt(context.options, options);
			const prompt = options.prompt ?? new TerminalPrompt();
			const choices = interactive
				? await promptChoices(context.options, prompt)
				: resolveChoices(context.options);
			const packageVersion =
				options.packageVersion ??
				(await resolveDefaultPackageVersion(targetPath));
			const files = makeNewAppFiles({
				appName: basename(targetPath),
				choices,
				packageVersion,
			});

			if (interactive) {
				context.output.write(
					formatNewAppPlan({
						appName: basename(targetPath),
						choices,
						files,
						root,
						targetPath,
					}),
				);

				const shouldCreate = await prompt.confirm("Create project", true, {
					yes: "Write files and create the application",
					no: "Cancel without writing files",
				});

				if (!shouldCreate) {
					context.output.write("Cancelled");
					return 0;
				}
			}

			const startedAt = options.clock?.() ?? Date.now();

			await writeNewApp(targetPath, files, isEnabled(context.options, "force"));
			const duration = (options.clock?.() ?? Date.now()) - startedAt;
			let installed = false;

			if (choices.install) {
				await (options.install ?? installDependencies)({
					cwd: targetPath,
					packageManager: choices.packageManager,
				});
				installed = true;
			}

			context.output.write(
				formatNewAppCreated({
					appName: basename(targetPath),
					choices,
					currentDirectory: process.cwd(),
					duration,
					installed,
					root,
					targetPath,
				}),
			);
		},
	);
}

export function registerNewAppCommand(
	console: ConsoleKernel,
	options: NewAppConsoleOptions = {},
): ConsoleKernel {
	return console.register(createNewAppCommand(options));
}

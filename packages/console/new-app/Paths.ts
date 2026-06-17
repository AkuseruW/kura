import { isAbsolute, resolve } from "node:path";
import type { ConsoleOptions } from "../Console";
import { readStringOption } from "./Choices";
import type { NewAppConsoleOptions } from "./Types";

export function resolveRoot(
	options: NewAppConsoleOptions,
	consoleOptions: ConsoleOptions,
): string {
	const root =
		readStringOption(consoleOptions, "root") ?? options.root ?? process.cwd();

	return isAbsolute(root) ? root : resolve(root);
}

export function resolveTargetPath(root: string, rawName: string): string {
	const segments = rawName
		.replaceAll("\\", "/")
		.split("/")
		.map((segment) => segment.trim())
		.filter(Boolean);

	if (segments.length === 0) {
		throw new Error("Application name cannot be empty");
	}

	for (const segment of segments) {
		if (
			segment === "." ||
			segment === ".." ||
			!/^[A-Za-z0-9_.-]+$/.test(segment)
		) {
			throw new Error(`Application name segment [${segment}] is invalid`);
		}
	}

	return resolve(root, ...segments);
}

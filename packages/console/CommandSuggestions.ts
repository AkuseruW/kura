import type { Command } from "./Console";

export function formatMissingCommandHelp(
	commandName: string,
	commands: readonly Command[],
): string {
	const lines = [`Command [${commandName}] was not found`];
	const namespace = commandNamespace(normalizeCommandName(commandName));
	const namespaceCommands =
		namespace === undefined
			? []
			: commands
					.map((command) => command.name)
					.filter(
						(name) =>
							commandNamespace(normalizeCommandName(name)) === namespace,
					);

	if (namespaceCommands.length > 0) {
		lines.push("", `Available ${namespace} commands:`);

		for (const name of namespaceCommands) {
			lines.push(`  ${name}`);
		}

		lines.push("", "Run `kura` to list all commands.");

		return lines.join("\n");
	}

	const suggestions = suggestCommandNames(commandName, commands);

	if (suggestions.length > 0) {
		lines.push("", "Similar commands:");

		for (const suggestion of suggestions) {
			lines.push(`  ${suggestion}`);
		}
	}

	lines.push("", "Run `kura` to list commands.");

	return lines.join("\n");
}

function suggestCommandNames(
	input: string,
	commands: readonly Command[],
	limit = 5,
): string[] {
	const normalizedInput = normalizeCommandName(input);
	const scored = commands
		.map((command) => ({
			name: command.name,
			score: scoreCommandSuggestion(normalizedInput, command.name),
		}))
		.filter(
			(entry): entry is { name: string; score: number } =>
				entry.score !== undefined,
		)
		.sort(
			(left, right) =>
				left.score - right.score || left.name.localeCompare(right.name),
		);

	return scored.slice(0, limit).map((entry) => entry.name);
}

function scoreCommandSuggestion(
	input: string,
	candidateName: string,
): number | undefined {
	const candidate = normalizeCommandName(candidateName);

	if (candidate === input) {
		return 0;
	}

	if (candidate.startsWith(input) || input.startsWith(candidate)) {
		return 1 + Math.abs(candidate.length - input.length);
	}

	const inputNamespace = commandNamespace(input);
	const candidateNamespace = commandNamespace(candidate);

	if (inputNamespace !== undefined && inputNamespace === candidateNamespace) {
		return 10 + levenshteinDistance(commandLeaf(input), commandLeaf(candidate));
	}

	if (candidate.includes(input) || input.includes(candidate)) {
		return 30 + Math.abs(candidate.length - input.length);
	}

	const distance = levenshteinDistance(input, candidate);
	const threshold = Math.max(
		2,
		Math.floor(Math.max(input.length, candidate.length) * 0.35),
	);

	return distance <= threshold ? 50 + distance : undefined;
}

function normalizeCommandName(name: string): string {
	return name.trim().toLowerCase();
}

function commandNamespace(name: string): string | undefined {
	const separator = name.indexOf(":");

	return separator === -1 ? undefined : name.slice(0, separator);
}

function commandLeaf(name: string): string {
	const separator = name.indexOf(":");

	return separator === -1 ? name : name.slice(separator + 1);
}

function levenshteinDistance(left: string, right: string): number {
	if (left === right) {
		return 0;
	}

	if (left.length === 0) {
		return right.length;
	}

	if (right.length === 0) {
		return left.length;
	}

	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

	for (let leftIndex = 0; leftIndex < left.length; leftIndex++) {
		const current = [leftIndex + 1];

		for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
			const substitutionCost =
				left.charAt(leftIndex) === right.charAt(rightIndex) ? 0 : 1;
			const insertion = (current[rightIndex] ?? Number.POSITIVE_INFINITY) + 1;
			const deletion =
				(previous[rightIndex + 1] ?? Number.POSITIVE_INFINITY) + 1;
			const substitution =
				(previous[rightIndex] ?? Number.POSITIVE_INFINITY) + substitutionCost;

			current.push(Math.min(insertion, deletion, substitution));
		}

		previous = current;
	}

	return previous[right.length] ?? 0;
}

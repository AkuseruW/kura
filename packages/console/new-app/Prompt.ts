import type { NewAppPrompt } from "./Types";

export class TerminalPrompt implements NewAppPrompt {
	select(
		message: string,
		choices: readonly string[],
		defaultValue: string,
	): string {
		const answer = promptLine(
			`${message} (${choices.join("/")})`,
			defaultValue,
		);

		return answer || defaultValue;
	}

	multiSelect(
		message: string,
		choices: readonly string[],
		defaultValues: readonly string[],
	): readonly string[] {
		const answer = promptLine(
			`${message} (${choices.join(", ")}; comma separated)`,
			defaultValues.join(","),
		);

		return answer
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
	}

	confirm(message: string, defaultValue: boolean): boolean {
		const answer = promptLine(message, defaultValue ? "yes" : "no")
			.trim()
			.toLowerCase();

		return ["y", "yes", "true", "1"].includes(answer);
	}
}

function promptLine(message: string, defaultValue: string): string {
	const prompt = (
		globalThis as {
			prompt?: (message: string, defaultValue?: string) => string | null;
		}
	).prompt;

	if (typeof prompt !== "function") {
		return defaultValue;
	}

	return prompt(`${message} [${defaultValue}]`, defaultValue) ?? defaultValue;
}

import type { NewAppPrompt, NewAppPromptChoice } from "./Types";

type PromptOption = {
	readonly value: string;
	readonly label: string;
	readonly description: string;
};

export class TerminalPrompt implements NewAppPrompt {
	select(
		message: string,
		choices: readonly string[],
		defaultValue: string,
		choiceDetails: readonly NewAppPromptChoice[] = [],
	): string {
		return promptForSingleChoice({
			message,
			options: makePromptOptions(choices, choiceDetails),
			defaultValue,
		});
	}

	multiSelect(
		message: string,
		choices: readonly string[],
		defaultValues: readonly string[],
		choiceDetails: readonly NewAppPromptChoice[] = [],
	): readonly string[] {
		return promptForMultipleChoices({
			message,
			options: makePromptOptions(choices, choiceDetails),
			defaultValues,
		});
	}

	confirm(message: string, defaultValue: boolean): boolean {
		const value = promptForSingleChoice({
			message,
			options: [
				{
					value: "yes",
					label: "Yes",
					description: "Run dependency installation after scaffolding",
				},
				{
					value: "no",
					label: "No",
					description: "Skip dependency installation",
				},
			],
			defaultValue: defaultValue ? "yes" : "no",
		});

		return value === "yes";
	}
}

function promptForSingleChoice(options: {
	readonly message: string;
	readonly options: readonly PromptOption[];
	readonly defaultValue: string;
}): string {
	const prompt = readPromptFunction();

	if (prompt === undefined) {
		return options.defaultValue;
	}

	for (;;) {
		const answer = prompt(
			formatSingleChoicePrompt(
				options.message,
				options.options,
				options.defaultValue,
			),
		);

		const value = parseSingleChoice(
			answer ?? "",
			options.options,
			options.defaultValue,
		);

		if (value !== undefined) {
			return value;
		}

		writeInvalidSelection(answer ?? "", options.options);
	}
}

function promptForMultipleChoices(options: {
	readonly message: string;
	readonly options: readonly PromptOption[];
	readonly defaultValues: readonly string[];
}): readonly string[] {
	const prompt = readPromptFunction();

	if (prompt === undefined) {
		return options.defaultValues;
	}

	for (;;) {
		const answer = prompt(
			formatMultipleChoicePrompt(
				options.message,
				options.options,
				options.defaultValues,
			),
		);

		const values = parseMultipleChoices(
			answer ?? "",
			options.options,
			options.defaultValues,
		);

		if (values !== undefined) {
			return values;
		}

		writeInvalidSelection(answer ?? "", options.options);
	}
}

function formatSingleChoicePrompt(
	message: string,
	options: readonly PromptOption[],
	defaultValue: string,
): string {
	const defaultIndex = options.findIndex(
		(option) => option.value === defaultValue,
	);

	return [
		message,
		"",
		...formatOptions(options),
		"",
		`Select [${defaultIndex >= 0 ? defaultIndex + 1 : defaultValue}]`,
	].join("\n");
}

function formatMultipleChoicePrompt(
	message: string,
	options: readonly PromptOption[],
	defaultValues: readonly string[],
): string {
	return [
		message,
		"",
		...formatOptions(options),
		"",
		`Select names or numbers, comma separated [${formatDefaultValues(
			defaultValues,
		)}]`,
	].join("\n");
}

function formatOptions(options: readonly PromptOption[]): string[] {
	const indexWidth = String(options.length).length;
	const labelWidth = Math.max(...options.map((option) => option.label.length));

	return options.map(
		(option, index) =>
			`  ${String(index + 1).padStart(indexWidth)}. ${option.label.padEnd(
				labelWidth,
			)}  ${option.description}`,
	);
}

function parseSingleChoice(
	answer: string,
	options: readonly PromptOption[],
	defaultValue: string,
): string | undefined {
	const value = answer.trim();

	if (value === "") {
		return defaultValue;
	}

	return resolveChoiceToken(value, options);
}

function parseMultipleChoices(
	answer: string,
	options: readonly PromptOption[],
	defaultValues: readonly string[],
): readonly string[] | undefined {
	const value = answer.trim();

	if (value === "") {
		return defaultValues;
	}

	if (["none", "no", "-"].includes(value.toLowerCase())) {
		return [];
	}

	const selected = new Set<string>();

	for (const token of value.split(",")) {
		const choice = resolveChoiceToken(token.trim(), options);

		if (choice === undefined) {
			return undefined;
		}

		selected.add(choice);
	}

	return [...selected];
}

function resolveChoiceToken(
	token: string,
	options: readonly PromptOption[],
): string | undefined {
	const index = Number(token);

	if (Number.isInteger(index) && index >= 1 && index <= options.length) {
		return options[index - 1]?.value;
	}

	const normalized = token.toLowerCase();
	const option = options.find(
		(candidate) =>
			candidate.value.toLowerCase() === normalized ||
			candidate.label.toLowerCase() === normalized,
	);

	return option?.value;
}

function makePromptOptions(
	choices: readonly string[],
	details: readonly NewAppPromptChoice[],
): readonly PromptOption[] {
	return choices.map((choice) => {
		const detail = details.find((candidate) => candidate.value === choice);

		return {
			value: choice,
			label: detail?.label ?? choice,
			description: detail?.description ?? "",
		};
	});
}

function formatDefaultValues(values: readonly string[]): string {
	return values.length === 0 ? "none" : values.join(", ");
}

function writeInvalidSelection(
	answer: string,
	options: readonly PromptOption[],
): void {
	console.error(
		`Invalid selection [${answer}]. Expected one of: ${options
			.map((option, index) => `${index + 1}/${option.value}`)
			.join(", ")}`,
	);
}

function readPromptFunction():
	| ((message: string, defaultValue?: string) => string | null)
	| undefined {
	const prompt = (
		globalThis as {
			prompt?: (message: string, defaultValue?: string) => string | null;
		}
	).prompt;

	return typeof prompt === "function" ? prompt : undefined;
}

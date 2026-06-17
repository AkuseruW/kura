import type { NewAppPrompt, NewAppPromptChoice } from "./Types";

type PromptOption = {
	readonly value: string;
	readonly label: string;
	readonly description: string;
};

type PromptInput = {
	readonly isTTY?: boolean;
	setRawMode?(enabled: boolean): void;
	resume(): void;
	pause(): void;
	on(event: "data", listener: (chunk: Uint8Array | string) => void): void;
	off(event: "data", listener: (chunk: Uint8Array | string) => void): void;
};

type PromptOutput = {
	readonly isTTY?: boolean;
	write(chunk: string): void;
};

type TerminalPromptOptions = {
	readonly banner?: boolean;
	readonly color?: boolean;
	readonly input?: PromptInput;
	readonly output?: PromptOutput;
};

type ConsoleTheme = {
	readonly accent: (value: string) => string;
	readonly heading: (value: string) => string;
	readonly muted: (value: string) => string;
	readonly selected: (value: string) => string;
};

type InteractiveSessionOptions<TResult> = {
	readonly initialIndex: number;
	readonly initialSelected?: ReadonlySet<string>;
	readonly message: string;
	readonly options: readonly PromptOption[];
	readonly render: (state: InteractiveState) => string;
	readonly resolve: (state: InteractiveState) => TResult | undefined;
	readonly update: (
		state: InteractiveState,
		key: PromptKey,
	) => InteractiveState;
};

type InteractiveState = {
	readonly index: number;
	readonly selected: ReadonlySet<string>;
};

type PromptKey =
	| "down"
	| "enter"
	| "space"
	| "up"
	| {
			readonly digit: number;
	  };

const kuraBanner = String.raw`
 _  __
| |/ /  _   _  _ __   __ _
| ' /  | | | || '__| / _' |
| . \  | |_| || |   | (_| |
|_|\_\  \__,_||_|    \__,_|
`.trim();

export class TerminalPrompt implements NewAppPrompt {
	private readonly banner: boolean;
	private readonly color: boolean;
	private readonly input: PromptInput;
	private readonly output: PromptOutput;
	private bannerRendered = false;

	constructor(options: TerminalPromptOptions = {}) {
		this.banner = options.banner ?? true;
		this.input = options.input ?? (process.stdin as unknown as PromptInput);
		this.output = options.output ?? (process.stdout as unknown as PromptOutput);
		this.color = options.color ?? shouldUseColor(this.output);
	}

	select(
		message: string,
		choices: readonly string[],
		defaultValue: string,
		choiceDetails: readonly NewAppPromptChoice[] = [],
	): string | Promise<string> {
		const options = makePromptOptions(choices, choiceDetails);

		if (this.canUseInteractivePrompt()) {
			return this.promptForInteractiveSingleChoice({
				message,
				options,
				defaultValue,
			});
		}

		return promptForFallbackSingleChoice({
			message,
			options,
			defaultValue,
		});
	}

	multiSelect(
		message: string,
		choices: readonly string[],
		defaultValues: readonly string[],
		choiceDetails: readonly NewAppPromptChoice[] = [],
	): readonly string[] | Promise<readonly string[]> {
		const options = makePromptOptions(choices, choiceDetails);

		if (this.canUseInteractivePrompt()) {
			return this.promptForInteractiveMultipleChoices({
				message,
				options,
				defaultValues,
			});
		}

		return promptForFallbackMultipleChoices({
			message,
			options,
			defaultValues,
		});
	}

	confirm(message: string, defaultValue: boolean): boolean | Promise<boolean> {
		const options = [
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
		];

		if (this.canUseInteractivePrompt()) {
			return this.promptForInteractiveSingleChoice({
				message,
				options,
				defaultValue: defaultValue ? "yes" : "no",
			}).then((value) => value === "yes");
		}

		return (
			promptForFallbackSingleChoice({
				message,
				options,
				defaultValue: defaultValue ? "yes" : "no",
			}) === "yes"
		);
	}

	private canUseInteractivePrompt(): boolean {
		return (
			this.input.isTTY === true &&
			this.output.isTTY === true &&
			typeof this.input.setRawMode === "function"
		);
	}

	private async promptForInteractiveSingleChoice(options: {
		readonly message: string;
		readonly options: readonly PromptOption[];
		readonly defaultValue: string;
	}): Promise<string> {
		const defaultIndex = findDefaultIndex(
			options.options,
			options.defaultValue,
		);

		return this.runInteractiveSession({
			initialIndex: defaultIndex,
			message: options.message,
			options: options.options,
			render: (state) =>
				formatInteractiveSingleChoice(
					options.message,
					options.options,
					state,
					this.theme(),
				),
			resolve: (state) => options.options[state.index]?.value,
			update: (state, key) =>
				updateSingleChoiceState(state, key, options.options),
		});
	}

	private async promptForInteractiveMultipleChoices(options: {
		readonly message: string;
		readonly options: readonly PromptOption[];
		readonly defaultValues: readonly string[];
	}): Promise<readonly string[]> {
		const defaultSelected = new Set(options.defaultValues);

		return this.runInteractiveSession({
			initialIndex: 0,
			initialSelected: defaultSelected,
			message: options.message,
			options: options.options,
			render: (state) =>
				formatInteractiveMultipleChoices(
					options.message,
					options.options,
					state,
					this.theme(),
				),
			resolve: (state) => [...state.selected],
			update: (state, key) =>
				updateMultipleChoiceState(state, key, options.options),
		}).then((values) => (values.length === 0 ? options.defaultValues : values));
	}

	private runInteractiveSession<TResult>(
		options: InteractiveSessionOptions<TResult>,
	): Promise<TResult> {
		this.writeBannerOnce();

		return new Promise((resolve, reject) => {
			let state: InteractiveState = {
				index: options.initialIndex,
				selected: options.initialSelected ?? new Set<string>(),
			};
			let renderedLines = 0;
			const render = () => {
				const output = options.render(state);

				if (renderedLines > 0) {
					this.output.write("\r");
					if (renderedLines > 1) {
						this.output.write(`\u001b[${renderedLines - 1}A`);
					}
					this.output.write("\u001b[J");
				}

				this.output.write(output);
				renderedLines = output.split("\n").length;
			};
			const cleanup = () => {
				this.input.off("data", onData);
				this.input.setRawMode?.(false);
				this.input.pause();
				this.output.write("\u001b[?25h");
			};
			const onData = (chunk: Uint8Array | string) => {
				let key: PromptKey | undefined;

				try {
					key = parsePromptKey(chunk);
				} catch (error) {
					cleanup();
					reject(error);
					return;
				}

				if (key === undefined) {
					return;
				}

				if (key === "enter") {
					const value = options.resolve(state);

					if (value !== undefined) {
						cleanup();
						this.output.write("\n");
						resolve(value);
					}
					return;
				}

				state = options.update(state, key);
				render();
			};

			try {
				this.output.write("\u001b[?25l");
				this.input.setRawMode?.(true);
				this.input.resume();
				this.input.on("data", onData);
				render();
			} catch (error) {
				cleanup();
				reject(error);
			}
		});
	}

	private theme(): ConsoleTheme {
		return makeTheme(this.color);
	}

	private writeBannerOnce(): void {
		if (!this.banner || this.bannerRendered) {
			return;
		}

		this.output.write(`${this.theme().accent(kuraBanner)}\n\n`);
		this.bannerRendered = true;
	}
}

function promptForFallbackSingleChoice(options: {
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
			formatFallbackSingleChoicePrompt(
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

function promptForFallbackMultipleChoices(options: {
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
			formatFallbackMultipleChoicePrompt(
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

function formatFallbackSingleChoicePrompt(
	message: string,
	options: readonly PromptOption[],
	defaultValue: string,
): string {
	const defaultIndex = findDefaultIndex(options, defaultValue);

	return [
		message,
		"",
		...formatFallbackOptions(options),
		"",
		`Select [${defaultIndex + 1}]`,
	].join("\n");
}

function formatFallbackMultipleChoicePrompt(
	message: string,
	options: readonly PromptOption[],
	defaultValues: readonly string[],
): string {
	return [
		message,
		"",
		...formatFallbackOptions(options),
		"",
		`Select names or numbers, comma separated [${formatDefaultValues(
			defaultValues,
		)}]`,
	].join("\n");
}

function formatFallbackOptions(options: readonly PromptOption[]): string[] {
	const indexWidth = String(options.length).length;
	const labelWidth = Math.max(...options.map((option) => option.label.length));

	return options.map(
		(option, index) =>
			`  ${String(index + 1).padStart(indexWidth)}. ${option.label.padEnd(
				labelWidth,
			)}  ${option.description}`,
	);
}

function formatInteractiveSingleChoice(
	message: string,
	options: readonly PromptOption[],
	state: InteractiveState,
	theme: ConsoleTheme,
): string {
	return [
		`${theme.heading(`❯ ${message}?`)} ${theme.muted("Press <ENTER> to select")}`,
		...options.map((option, index) =>
			formatInteractiveOption({
				active: index === state.index,
				checked: false,
				option,
				theme,
			}),
		),
	].join("\n");
}

function formatInteractiveMultipleChoices(
	message: string,
	options: readonly PromptOption[],
	state: InteractiveState,
	theme: ConsoleTheme,
): string {
	return [
		`${theme.heading(`❯ ${message}?`)} ${theme.muted("Press <SPACE> to toggle, <ENTER> to continue")}`,
		...options.map((option, index) =>
			formatInteractiveOption({
				active: index === state.index,
				checked: state.selected.has(option.value),
				option,
				theme,
			}),
		),
	].join("\n");
}

function formatInteractiveOption(options: {
	readonly active: boolean;
	readonly checked: boolean;
	readonly option: PromptOption;
	readonly theme: ConsoleTheme;
}): string {
	const pointer = options.active ? "❯" : " ";
	const marker = options.checked ? "[x]" : "   ";
	const label = options.active
		? options.theme.selected(options.option.label)
		: options.option.label;

	return `${pointer} ${marker} ${label} ${options.theme.muted(
		options.option.description,
	)}`;
}

function updateSingleChoiceState(
	state: InteractiveState,
	key: PromptKey,
	options: readonly PromptOption[],
): InteractiveState {
	if (key === "up") {
		return { ...state, index: Math.max(0, state.index - 1) };
	}

	if (key === "down") {
		return { ...state, index: Math.min(options.length - 1, state.index + 1) };
	}

	if (typeof key === "object") {
		return {
			...state,
			index: Math.min(options.length - 1, Math.max(0, key.digit - 1)),
		};
	}

	return state;
}

function updateMultipleChoiceState(
	state: InteractiveState,
	key: PromptKey,
	options: readonly PromptOption[],
): InteractiveState {
	if (key === "up") {
		return { ...state, index: Math.max(0, state.index - 1) };
	}

	if (key === "down") {
		return { ...state, index: Math.min(options.length - 1, state.index + 1) };
	}

	if (typeof key === "object") {
		return {
			...state,
			index: Math.min(options.length - 1, Math.max(0, key.digit - 1)),
		};
	}

	if (key !== "space") {
		return state;
	}

	const option = options[state.index];

	if (option === undefined) {
		return state;
	}

	const selected = new Set(state.selected);

	if (selected.has(option.value)) {
		selected.delete(option.value);
	} else {
		selected.add(option.value);
	}

	return { ...state, selected };
}

function parsePromptKey(chunk: Uint8Array | string): PromptKey | undefined {
	const value =
		typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);

	if (value === "\u0003") {
		throw new Error("Prompt aborted");
	}

	if (value === "\r" || value === "\n" || value === "\r\n") {
		return "enter";
	}

	if (value === " ") {
		return "space";
	}

	if (value === "\u001b[A" || value === "k") {
		return "up";
	}

	if (value === "\u001b[B" || value === "j") {
		return "down";
	}

	const digit = Number(value);

	if (Number.isInteger(digit) && digit > 0) {
		return { digit };
	}

	return undefined;
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

function findDefaultIndex(
	options: readonly PromptOption[],
	defaultValue: string,
): number {
	const index = options.findIndex((option) => option.value === defaultValue);

	return Math.max(0, index);
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

function shouldUseColor(output: PromptOutput): boolean {
	if (Bun.env.NO_COLOR !== undefined || Bun.env.CI === "true") {
		return false;
	}

	return output.isTTY === true;
}

function makeTheme(color: boolean): ConsoleTheme {
	if (!color) {
		return {
			accent: identity,
			heading: identity,
			muted: identity,
			selected: identity,
		};
	}

	return {
		accent: (value) => `\u001b[36m${value}\u001b[39m`,
		heading: (value) => `\u001b[1m${value}\u001b[22m`,
		muted: (value) => `\u001b[2m${value}\u001b[22m`,
		selected: (value) => `\u001b[36m${value}\u001b[39m`,
	};
}

function identity(value: string): string {
	return value;
}

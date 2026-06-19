export type AppPreset = "api" | "web" | "full";
export type ArchitecturePreset = "standard" | "modular" | "domain";
export type DatabasePreset = "none" | "sqlite" | "postgres" | "mysql";
export type AuthPreset = "none" | "session" | "access-token";
export type CachePreset = "memory" | "file" | "redis";
export type QueuePreset = "none" | "memory" | "sqlite" | "redis";
export type PackageManager = "bun";
export type ModulePreset = "mail" | "storage" | "i18n" | "websockets";

export type NewAppPromptChoice<TValue extends string = string> = {
	readonly value: TValue;
	readonly label: string;
	readonly description: string;
};

export type NewAppPrompt = {
	select(
		message: string,
		choices: readonly string[],
		defaultValue: string,
		choiceDetails?: readonly NewAppPromptChoice[],
	): string | Promise<string>;
	multiSelect(
		message: string,
		choices: readonly string[],
		defaultValues: readonly string[],
		choiceDetails?: readonly NewAppPromptChoice[],
	): readonly string[] | Promise<readonly string[]>;
	confirm(
		message: string,
		defaultValue: boolean,
		choiceDetails?: {
			readonly yes: string;
			readonly no: string;
		},
	): boolean | Promise<boolean>;
};

export type NewAppConsoleOptions = {
	readonly root?: string;
	readonly prompt?: NewAppPrompt;
	readonly install?: NewAppInstaller;
	readonly packageVersion?: string;
	readonly clock?: () => number;
};

export type NewAppInstaller = (options: {
	readonly cwd: string;
	readonly packageManager: PackageManager;
}) => Promise<void> | void;

export type NewAppChoices = {
	readonly preset: AppPreset;
	readonly architecture: ArchitecturePreset;
	readonly database: DatabasePreset;
	readonly auth: AuthPreset;
	readonly cache: CachePreset;
	readonly queue: QueuePreset;
	readonly modules: readonly ModulePreset[];
	readonly packageManager: PackageManager;
	readonly install: boolean;
};

export type NewAppFile = NewAppRegularFile | NewAppDirectory;

export type NewAppRegularFile = {
	readonly kind?: "file";
	readonly path: string;
	readonly content: string;
	readonly mode?: number;
};

export type NewAppDirectory = {
	readonly kind: "directory";
	readonly path: string;
};

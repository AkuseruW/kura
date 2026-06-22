import { BaseException } from "./BaseException";

export type EnvSource = Record<string, string | undefined>;

export type EnvVariableKind = "boolean" | "enum" | "number" | "string" | "url";

export type EnvVariableDescription = {
	readonly defaulted: boolean;
	readonly kind: EnvVariableKind;
	readonly optional: boolean;
	readonly secret: boolean;
	readonly values?: readonly string[];
};

export type EnvValidationIssue = {
	readonly key: string;
	readonly message: string;
	readonly reason: "invalid" | "missing";
	readonly secret: boolean;
};

export type ValidEnvValidationResult<TValues> = {
	readonly valid: true;
	readonly values: TValues;
	readonly issues: readonly [];
};

export type InvalidEnvValidationResult<TValues> = {
	readonly valid: false;
	readonly values: Partial<TValues>;
	readonly issues: readonly EnvValidationIssue[];
};

export type EnvValidationResult<TValues> =
	| ValidEnvValidationResult<TValues>
	| InvalidEnvValidationResult<TValues>;

export type EnvShape = Record<string, EnvVariable<unknown>>;

export type InferEnvVariable<TVariable> =
	TVariable extends EnvVariable<infer TValue> ? TValue : never;

export type InferEnvShape<TShape extends EnvShape> = {
	readonly [K in keyof TShape]: InferEnvVariable<TShape[K]>;
};

export type InferEnv<TSchemaOrShape> =
	TSchemaOrShape extends EnvSchema<infer TShape>
		? InferEnvShape<TShape>
		: TSchemaOrShape extends EnvShape
			? InferEnvShape<TSchemaOrShape>
			: never;

type EnvParser<TValue> = (value: string) => TValue;

type EnvVariableOptions<TValue> = {
	readonly defaulted: boolean;
	readonly defaultValue?: TValue;
	readonly kind: EnvVariableKind;
	readonly optional: boolean;
	readonly parse: EnvParser<TValue>;
	readonly secret: boolean;
	readonly values?: readonly string[];
};

type EnvVariableParseResult<TValue> =
	| {
			readonly ok: true;
			readonly value: TValue;
	  }
	| {
			readonly ok: false;
			readonly issue: EnvValidationIssue;
	  };

export class EnvValidationException extends BaseException {
	constructor(readonly issues: readonly EnvValidationIssue[]) {
		super(
			formatEnvValidationIssues(issues),
			"ENV_VALIDATION_FAILED",
			500,
			"Update the environment variables listed above and restart the process.",
		);
	}
}

export class EnvVariable<TValue> {
	constructor(private readonly options: EnvVariableOptions<TValue>) {}

	default(
		value: Exclude<TValue, undefined>,
	): EnvVariable<Exclude<TValue, undefined>> {
		return new EnvVariable<Exclude<TValue, undefined>>({
			...this.options,
			defaulted: true,
			defaultValue: value,
			optional: false,
			parse: this.options.parse as EnvParser<Exclude<TValue, undefined>>,
		});
	}

	optional(): EnvVariable<TValue | undefined> {
		return new EnvVariable<TValue | undefined>({
			...this.options,
			optional: true,
			parse: this.options.parse as EnvParser<TValue | undefined>,
		});
	}

	secret(): EnvVariable<TValue> {
		return new EnvVariable<TValue>({
			...this.options,
			secret: true,
		});
	}

	describe(): EnvVariableDescription {
		return {
			defaulted: this.options.defaulted,
			kind: this.options.kind,
			optional: this.options.optional,
			secret: this.options.secret,
			values: this.options.values,
		};
	}

	parse(key: string, source: EnvSource): EnvVariableParseResult<TValue> {
		const rawValue = source[key];

		if (rawValue === undefined || rawValue.length === 0) {
			if (this.options.defaulted) {
				return {
					ok: true,
					value: this.options.defaultValue as TValue,
				};
			}

			if (this.options.optional) {
				return {
					ok: true,
					value: undefined as TValue,
				};
			}

			return {
				ok: false,
				issue: {
					key,
					message: `${key} is required`,
					reason: "missing",
					secret: this.options.secret,
				},
			};
		}

		try {
			return {
				ok: true,
				value: this.options.parse(rawValue),
			};
		} catch (error) {
			return {
				ok: false,
				issue: {
					key,
					message: error instanceof Error ? error.message : `${key} is invalid`,
					reason: "invalid",
					secret: this.options.secret,
				},
			};
		}
	}
}

export class EnvSchema<TShape extends EnvShape> {
	constructor(private readonly shape: TShape) {}

	describe(): { readonly [K in keyof TShape]: EnvVariableDescription } {
		const description = {} as { [K in keyof TShape]: EnvVariableDescription };

		for (const key of this.keys()) {
			const variable = this.shape[key];

			if (variable) {
				description[key] = variable.describe();
			}
		}

		return description;
	}

	keys(): readonly (keyof TShape & string)[] {
		return Object.keys(this.shape) as (keyof TShape & string)[];
	}

	parse(source: EnvSource = process.env): InferEnvShape<TShape> {
		const result = this.validate(source);

		if (!result.valid) {
			throw new EnvValidationException(result.issues);
		}

		return result.values;
	}

	validate(
		source: EnvSource = process.env,
	): EnvValidationResult<InferEnvShape<TShape>> {
		const values: Partial<InferEnvShape<TShape>> = {};
		const issues: EnvValidationIssue[] = [];

		for (const key of this.keys()) {
			const variable = this.shape[key];
			if (!variable) {
				continue;
			}

			const result = variable.parse(key, source);

			if (result.ok) {
				values[key] = result.value as InferEnvShape<TShape>[typeof key];
			} else {
				issues.push(result.issue);
			}
		}

		if (issues.length > 0) {
			return {
				valid: false,
				values,
				issues,
			};
		}

		return {
			valid: true,
			values: values as InferEnvShape<TShape>,
			issues: [],
		};
	}
}

export const envVar = {
	boolean(): EnvVariable<boolean> {
		return new EnvVariable<boolean>({
			defaulted: false,
			kind: "boolean",
			optional: false,
			parse: parseBoolean,
			secret: false,
		});
	},

	enum<const TValue extends string>(
		values: readonly TValue[],
	): EnvVariable<TValue> {
		return new EnvVariable<TValue>({
			defaulted: false,
			kind: "enum",
			optional: false,
			parse: (value) => parseEnum(value, values),
			secret: false,
			values,
		});
	},

	number(): EnvVariable<number> {
		return new EnvVariable<number>({
			defaulted: false,
			kind: "number",
			optional: false,
			parse: parseNumber,
			secret: false,
		});
	},

	secret(): EnvVariable<string> {
		return envVar.string().secret();
	},

	string(): EnvVariable<string> {
		return new EnvVariable<string>({
			defaulted: false,
			kind: "string",
			optional: false,
			parse: (value) => value,
			secret: false,
		});
	},

	url(): EnvVariable<string> {
		return new EnvVariable<string>({
			defaulted: false,
			kind: "url",
			optional: false,
			parse: parseUrl,
			secret: false,
		});
	},
} as const;

export function defineEnv<const TShape extends EnvShape>(
	shape: TShape,
): EnvSchema<TShape> {
	return new EnvSchema(shape);
}

export function formatEnvValidationIssues(
	issues: readonly EnvValidationIssue[],
): string {
	if (issues.length === 0) {
		return "Environment validation failed";
	}

	return [
		"Environment validation failed:",
		...issues.map((issue) => `- ${issue.key}: ${issue.message}`),
	].join("\n");
}

function parseBoolean(value: string): boolean {
	const normalized = value.trim().toLowerCase();

	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}

	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}

	throw new Error("expected a boolean");
}

function parseEnum<const TValue extends string>(
	value: string,
	values: readonly TValue[],
): TValue {
	const match = values.find((candidate) => candidate === value);

	if (match) {
		return match;
	}

	throw new Error(`expected one of ${values.join(", ")}`);
}

function parseNumber(value: string): number {
	const parsed = Number(value);

	if (!Number.isFinite(parsed)) {
		throw new Error("expected a number");
	}

	return parsed;
}

function parseUrl(value: string): string {
	try {
		new URL(value);
		return value;
	} catch {
		throw new Error("expected a URL");
	}
}

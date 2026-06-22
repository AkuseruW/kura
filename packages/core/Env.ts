import type {
	EnvSchema,
	EnvShape,
	EnvSource,
	EnvValidationResult,
	InferEnvShape,
} from "./EnvSchema";

export type EnvLoadOptions = {
	readonly override?: boolean;
};

export class Env<TEnvShape extends EnvShape = EnvShape> {
	constructor(private readonly schema?: EnvSchema<TEnvShape>) {}

	get<T>(key: string, defaultValue: T): T {
		return (process.env[key] as unknown as T) ?? defaultValue;
	}

	number(key: string, defaultValue?: number): number | undefined {
		const value = process.env[key];
		return value ? Number(value) : defaultValue;
	}

	boolean(key: string, defaultValue?: boolean): boolean | undefined {
		const value = process.env[key];
		return value ? value === "true" : defaultValue;
	}

	required(key: string): string {
		const value = process.env[key];
		if (!value) {
			throw new Error(`Missing environment variable: ${key}`);
		}
		return value;
	}

	validate<TShape extends EnvShape = TEnvShape>(
		schema = this.schema as EnvSchema<TShape> | undefined,
		source: EnvSource = process.env,
	): EnvValidationResult<InferEnvShape<TShape>> {
		if (!schema) {
			return {
				valid: true,
				values: {} as InferEnvShape<TShape>,
				issues: [],
			};
		}

		return schema.validate(source);
	}

	validated<TShape extends EnvShape = TEnvShape>(
		schema = this.schema as EnvSchema<TShape> | undefined,
		source: EnvSource = process.env,
	): InferEnvShape<TShape> {
		if (!schema) {
			return {} as InferEnvShape<TShape>;
		}

		return schema.parse(source);
	}

	async load(path: string, options: EnvLoadOptions = {}): Promise<void> {
		const file = Bun.file(path);
		const content = await file.text();
		const override = options.override ?? true;

		for (const line of content.split("\n")) {
			const [key, ...values] = line.split("=");
			const name = key?.trim();

			if (!name || values.length === 0) {
				continue;
			}

			if (override || process.env[name] === undefined) {
				process.env[name] = values.join("=").trim();
			}
		}
	}
}

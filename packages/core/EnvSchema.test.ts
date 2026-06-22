import { describe, expect, test } from "bun:test";
import {
	defineEnv,
	EnvValidationException,
	envVar,
	type InferEnv,
} from "./EnvSchema";

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
	? [TRight] extends [TLeft]
		? true
		: false
	: false;
type Expect<T extends true> = T;

const envSchema = defineEnv({
	APP_KEY: envVar.secret(),
	APP_URL: envVar.url().default("http://localhost:3333"),
	CACHE_STORE: envVar.enum(["memory", "redis"]).default("memory"),
	DEBUG: envVar.boolean().default(false),
	DATABASE_URL: envVar.url().secret().optional(),
	PORT: envVar.number().default(3333),
});

type InferredEnv = InferEnv<typeof envSchema>;
type ExpectedEnv = {
	readonly APP_KEY: string;
	readonly APP_URL: string;
	readonly CACHE_STORE: "memory" | "redis";
	readonly DEBUG: boolean;
	readonly DATABASE_URL: string | undefined;
	readonly PORT: number;
};
type _InferredEnvMatches = Expect<Equal<InferredEnv, ExpectedEnv>>;

describe("EnvSchema", () => {
	test("parses environment values with defaults and coercion", () => {
		const values = envSchema.parse({
			APP_KEY: "local-development-key",
			CACHE_STORE: "redis",
			DEBUG: "true",
			PORT: "3334",
		});

		expect(values).toEqual({
			APP_KEY: "local-development-key",
			APP_URL: "http://localhost:3333",
			CACHE_STORE: "redis",
			DEBUG: true,
			DATABASE_URL: undefined,
			PORT: 3334,
		});
	});

	test("returns actionable validation issues without leaking secret values", () => {
		const result = envSchema.validate({
			APP_KEY: "super-secret-value",
			APP_URL: "not-a-url",
			CACHE_STORE: "file",
			DEBUG: "sometimes",
			PORT: "three",
		});

		expect(result.valid).toBe(false);

		if (result.valid) {
			throw new Error("expected invalid env result");
		}

		expect(result.issues.map((issue) => issue.key)).toEqual([
			"APP_URL",
			"CACHE_STORE",
			"DEBUG",
			"PORT",
		]);
		expect(
			result.issues.every((issue) => !issue.message.includes("secret")),
		).toBe(true);
	});

	test("throws a formatted exception for invalid environment values", () => {
		expect(() =>
			envSchema.parse({
				APP_KEY: "",
				APP_URL: "http://localhost:3333",
			}),
		).toThrow(EnvValidationException);

		try {
			envSchema.parse({
				APP_KEY: "",
				APP_URL: "http://localhost:3333",
			});
		} catch (error) {
			expect(error).toBeInstanceOf(EnvValidationException);
			expect((error as Error).message).toContain("APP_KEY is required");
			expect((error as Error).message).not.toContain("local-development-key");
		}
	});
});

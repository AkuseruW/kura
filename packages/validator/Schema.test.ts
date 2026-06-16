import { describe, expect, test } from "bun:test";
import { v } from "./Schema";

describe("Schema", () => {
	test("validates primitive values", () => {
		expect(v.string().parse("kura")).toBe("kura");
		expect(v.number().parse(1)).toBe(1);
		expect(v.boolean().parse(true)).toBe(true);
	});

	test("validates arrays and objects", () => {
		const schema = v.object({
			ids: v.array(v.number()),
			name: v.string(),
		});

		expect(schema.parse({ ids: [1, 2], name: "kura" })).toEqual({
			ids: [1, 2],
			name: "kura",
		});
	});

	test("validates enum values", () => {
		const schema = v.enum(["draft", "published"]);

		expect(schema.parse("draft")).toBe("draft");
		expect(() => schema.parse("archived")).toThrow(
			"Validation failed for enum",
		);
	});

	test("parses date strings into Date instances", () => {
		const date = v.date().parse("2026-01-01");

		expect(date).toBeInstanceOf(Date);
		expect(date.toISOString()).toBe("2026-01-01T00:00:00.000Z");
	});

	test("throws for invalid values", () => {
		expect(() => v.string().parse(1)).toThrow("Validation failed for string");
		expect(() => v.array(v.number()).parse([1, "2"])).toThrow(
			"Validation failed for array",
		);
	});
});

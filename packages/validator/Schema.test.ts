import { describe, expect, test } from "bun:test";
import { v } from "./Schema";

describe("Schema", () => {
	test("validates primitive values", () => {
		expect(v.string().parse("kura")).toBe("kura");
		expect(v.number().parse(1)).toBe(1);
		expect(v.boolean().parse(true)).toBe(true);
	});

	test("validates string rules", () => {
		expect(v.string().email().parse("dev@kura.dev")).toBe("dev@kura.dev");
		expect(v.string().min(3).max(5).parse("kura")).toBe("kura");
		expect(v.string().regex(/^ku/).parse("kura")).toBe("kura");
		expect(v.string().url().parse("https://kura.dev/docs")).toBe(
			"https://kura.dev/docs",
		);

		expect(() => v.string().email().parse("invalid")).toThrow(
			"Validation failed for string",
		);
		expect(() => v.string().min(3).parse("ku")).toThrow(
			"Validation failed for string",
		);
		expect(() => v.string().max(3).parse("kura")).toThrow(
			"Validation failed for string",
		);
		expect(() => v.string().regex(/^ku$/).parse("kura")).toThrow(
			"Validation failed for string",
		);
		expect(() => v.string().url().parse("kura")).toThrow(
			"Validation failed for string",
		);
	});

	test("validates number rules", () => {
		expect(v.number().min(1).max(10).parse(5)).toBe(5);
		expect(v.number().integer().parse(5)).toBe(5);
		expect(v.number().positive().parse(1)).toBe(1);

		expect(() => v.number().min(3).parse(2)).toThrow(
			"Validation failed for number",
		);
		expect(() => v.number().max(3).parse(4)).toThrow(
			"Validation failed for number",
		);
		expect(() => v.number().integer().parse(1.5)).toThrow(
			"Validation failed for number",
		);
		expect(() => v.number().positive().parse(0)).toThrow(
			"Validation failed for number",
		);
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

	test("validates array rules", () => {
		expect(v.array(v.number()).min(2).max(3).parse([1, 2])).toEqual([1, 2]);
		expect(v.array(v.string()).distinct().parse(["api", "http"])).toEqual([
			"api",
			"http",
		]);

		expect(() => v.array(v.number()).min(2).parse([1])).toThrow(
			"Validation failed for array",
		);
		expect(() => v.array(v.number()).max(2).parse([1, 2, 3])).toThrow(
			"Validation failed for array",
		);
		expect(() => v.array(v.string()).distinct().parse(["api", "api"])).toThrow(
			"Validation failed for array",
		);
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

	test("validates date rules", () => {
		const date = v
			.date()
			.after("2026-01-01")
			.before(new Date("2026-12-31"))
			.parse("2026-06-01");

		expect(date).toBeInstanceOf(Date);
		expect(date.toISOString()).toBe("2026-06-01T00:00:00.000Z");

		expect(() => v.date().after("2026-01-01").parse("2026-01-01")).toThrow(
			"Validation failed for date",
		);
		expect(() => v.date().before("2026-01-01").parse("2026-01-01")).toThrow(
			"Validation failed for date",
		);
		expect(() => v.date().after("invalid")).toThrow(
			"Invalid date for after rule",
		);
		expect(() => v.date().parse(new Date("invalid"))).toThrow(
			"Validation failed for date",
		);
	});

	test("validates file rules", () => {
		const file = new File(["kura"], "avatar.PNG", { type: "image/png" });

		expect(
			v
				.file()
				.maxSize(4)
				.mimeTypes(["image/png"])
				.extensions([".png"])
				.parse(file),
		).toBe(file);
		expect(v.file().extensions(["png"]).parse(file)).toBe(file);

		expect(() => v.file().maxSize(3).parse(file)).toThrow(
			"Validation failed for file",
		);
		expect(() => v.file().mimeTypes(["image/jpeg"]).parse(file)).toThrow(
			"Validation failed for file",
		);
		expect(() => v.file().extensions(["jpg"]).parse(file)).toThrow(
			"Validation failed for file",
		);
		expect(() => v.file().maxSize(-1)).toThrow(
			"Invalid number for maxSize rule",
		);
	});

	test("throws for invalid values", () => {
		expect(() => v.string().parse(1)).toThrow("Validation failed for string");
		expect(() => v.array(v.number()).parse([1, "2"])).toThrow(
			"Validation failed for array",
		);
	});
});

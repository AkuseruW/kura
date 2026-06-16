import { describe, expect, test } from "bun:test";
import { Container } from "./Container";

describe("Container", () => {
	test("resolves a new value from a binding each time", () => {
		const container = new Container();
		let count = 0;

		container.bind("counter", () => ({ count: ++count }));

		expect(container.resolve<{ count: number }>("counter")).toEqual({
			count: 1,
		});
		expect(container.resolve<{ count: number }>("counter")).toEqual({
			count: 2,
		});
	});

	test("resolves a singleton once", () => {
		const container = new Container();
		let count = 0;

		container.singleton("counter", () => ({ count: ++count }));

		expect(container.resolve<{ count: number }>("counter")).toEqual({
			count: 1,
		});
		expect(container.resolve<{ count: number }>("counter")).toEqual({
			count: 1,
		});
	});

	test("resolves aliases through make and resolve", () => {
		const container = new Container();

		container.bind("logger", () => "resolved");
		container.alias("log", "logger");

		expect(container.resolve<string>("log")).toBe("resolved");
		expect(container.make<string>("log")).toBe("resolved");
	});

	test("throws for missing bindings", () => {
		const container = new Container();

		expect(() => container.resolve("missing")).toThrow(
			"No binding found for missing",
		);
	});
});

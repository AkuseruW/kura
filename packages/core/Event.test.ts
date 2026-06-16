import { describe, expect, test } from "bun:test";
import { Emitter, Event, type Listener } from "./Event";

describe("Emitter", () => {
	test("emits events to registered listeners in order", async () => {
		const emitter = new Emitter<{ id: number }>();
		const calls: string[] = [];

		emitter.on("user.created", async (event) => {
			await Promise.resolve();
			calls.push(`first:${event.payload.id}`);
		});
		emitter.on("user.created", (event) => {
			calls.push(`second:${event.payload.id}`);
		});

		await emitter.emit(new Event("user.created", { id: 1 }));

		expect(calls).toEqual(["first:1", "second:1"]);
	});

	test("removes listeners through unsubscribe and off", async () => {
		const emitter = new Emitter<string>();
		const calls: string[] = [];
		const listener: Listener<string> = (event) => {
			calls.push(event.payload);
		};

		const unsubscribe = emitter.on("message", listener);
		await emitter.emit(new Event("message", "before-unsubscribe"));
		unsubscribe();
		await emitter.emit(new Event("message", "after-unsubscribe"));

		emitter.on("message", listener);
		emitter.off("message", listener);
		await emitter.emit(new Event("message", "after-off"));

		expect(calls).toEqual(["before-unsubscribe"]);
	});

	test("ignores events without listeners", async () => {
		const emitter = new Emitter<string>();
		const calls: string[] = [];

		emitter.on("handled", (event) => {
			calls.push(event.payload);
		});

		await emitter.emit(new Event("missing", "ignored"));

		expect(calls).toEqual([]);
	});
});

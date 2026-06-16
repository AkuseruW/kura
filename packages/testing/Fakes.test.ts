import { describe, expect, test } from "bun:test";
import { Event } from "../core/Event";
import { Job, type JobContext, QueueManager } from "../queue/Queue";
import { FakeEventDispatcher, FakeMailDriver, FakeQueueDriver } from "./Fakes";

describe("FakeMailDriver", () => {
	test("records sent mail and exposes assertions", async () => {
		const mail = new FakeMailDriver();

		await mail.send({
			to: ["dev@kura.dev", "ops@kura.dev"],
			subject: "Welcome",
			text: "Hello",
			headers: { "X-Mailer": "kura" },
		});

		expect(mail.all()).toHaveLength(1);
		expect(mail.sent({ subject: "Welcome" })).toHaveLength(1);
		mail
			.assertSent({ to: ["dev@kura.dev", "ops@kura.dev"] })
			.assertSentTimes(1, { subject: "Welcome" })
			.assertNotSent({ subject: "Reset password" });
		expect(() => mail.assertSent({ subject: "Missing" })).toThrow(
			"Expected mail to be sent",
		);
		expect(() => mail.assertSentTimes(2)).toThrow(
			"Expected mail to be sent 2 times, received 1",
		);
		expect(() => mail.assertNotSent()).toThrow(
			"Expected mail not to be sent, received 1",
		);

		mail.clear();
		expect(mail.all()).toEqual([]);
	});
});

describe("FakeQueueDriver", () => {
	test("records pushed jobs and works as a QueueDriver", async () => {
		const driver = new FakeQueueDriver();
		const manager = new QueueManager(driver);
		const calls: string[] = [];

		await manager
			.dispatch(new FakeEmailJob({ userId: 1, calls }))
			.onQueue("mail")
			.now();
		const result = await manager.work({ queue: "mail" });

		expect(result.completed).toBe(1);
		expect(calls).toEqual(["email:1:1"]);
		expect(driver.pushed("FakeEmailJob")).toHaveLength(1);
		driver
			.assertPushed("FakeEmailJob")
			.assertPushedTimes(1, (job) => job.queue === "mail")
			.assertNotPushed("MissingJob");
		expect(() => driver.assertPushed("MissingJob")).toThrow(
			"Expected queue job to be pushed",
		);
		expect(() => driver.assertPushedTimes(2, "FakeEmailJob")).toThrow(
			"Expected queue job to be pushed 2 times, received 1",
		);
		expect(() => driver.assertNotPushed()).toThrow(
			"Expected queue job not to be pushed, received 1",
		);

		driver.clear();
		expect(driver.all()).toEqual([]);
	});
});

describe("FakeEventDispatcher", () => {
	test("records dispatched events and still notifies listeners", async () => {
		const events = new FakeEventDispatcher<{ id: number }>();
		const calls: number[] = [];

		events.on("user.created", (event) => {
			calls.push(event.payload.id);
		});
		await events.dispatch(new Event("user.created", { id: 1 }));

		expect(calls).toEqual([1]);
		expect(events.all()).toHaveLength(1);
		expect(events.dispatched("user.created")).toHaveLength(1);
		events
			.assertDispatched("user.created")
			.assertDispatchedTimes(1, (record) => record.payload.id === 1)
			.assertNotDispatched("user.deleted");
		expect(() => events.assertDispatched("user.deleted")).toThrow(
			"Expected event to be dispatched",
		);
		expect(() => events.assertDispatchedTimes(2)).toThrow(
			"Expected event to be dispatched 2 times, received 1",
		);
		expect(() => events.assertNotDispatched()).toThrow(
			"Expected event not to be dispatched, received 1",
		);

		events.clear();
		expect(events.all()).toEqual([]);
	});
});

type FakeEmailPayload = {
	readonly userId: number;
	readonly calls: string[];
};

class FakeEmailJob extends Job<FakeEmailPayload> {
	override handle(ctx: JobContext<FakeEmailPayload>): void {
		ctx.payload?.calls.push(`email:${ctx.payload.userId}:${ctx.attempt}`);
	}
}

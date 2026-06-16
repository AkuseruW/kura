import { describe, expect, test } from "bun:test";
import {
	dispatch,
	Job,
	type JobContext,
	MemoryQueueDriver,
	type QueuedJob,
	QueueManager,
} from "./Queue";

describe("QueueManager", () => {
	test("dispatches jobs and processes them through the memory driver", async () => {
		const driver = new MemoryQueueDriver();
		const manager = new QueueManager(driver);
		const calls: string[] = [];

		await manager.dispatch(new RecordingJob("welcome", calls)).now();
		const result = await manager.work();

		expect(result).toEqual({
			processed: 1,
			completed: 1,
			released: 0,
			failed: 0,
		});
		expect(calls).toEqual(["welcome:1"]);
		expect(readSingleJob(driver).status).toBe("completed");
	});

	test("supports the public dispatch helper with delayed jobs", async () => {
		const driver = new MemoryQueueDriver();
		const manager = new QueueManager(driver);
		const calls: string[] = [];
		const availableAt = new Date("2026-01-01T00:00:01.000Z");

		await dispatch(new RecordingJob("later", calls), manager).delay(
			availableAt,
		);
		const beforeDelay = await manager.work({
			now: new Date("2026-01-01T00:00:00.000Z"),
		});
		const afterDelay = await manager.work({ now: availableAt });

		expect(beforeDelay.processed).toBe(0);
		expect(afterDelay.completed).toBe(1);
		expect(calls).toEqual(["later:1"]);
	});

	test("processes only jobs from the selected queue", async () => {
		const driver = new MemoryQueueDriver();
		const manager = new QueueManager(driver);
		const calls: string[] = [];

		await manager
			.dispatch(new RecordingJob("email", calls))
			.onQueue("emails")
			.now();
		const defaultResult = await manager.work();
		const emailsResult = await manager.work({ queue: "emails" });

		expect(defaultResult.processed).toBe(0);
		expect(emailsResult.completed).toBe(1);
		expect(calls).toEqual(["email:1"]);
		expect(readSingleJob(driver).queue).toBe("emails");
	});

	test("releases failed jobs with backoff before retrying", async () => {
		const driver = new MemoryQueueDriver();
		const manager = new QueueManager(driver);
		const calls: string[] = [];
		const start = new Date("2026-01-01T00:00:00.000Z");
		const job = new RetryJob(calls);

		await manager.push(job, { now: start });
		const first = await manager.work({ now: start });
		const beforeRetry = await manager.work({
			now: new Date("2026-01-01T00:00:00.099Z"),
		});
		const second = await manager.work({
			now: new Date("2026-01-01T00:00:00.100Z"),
		});
		const third = await manager.work({
			now: new Date("2026-01-01T00:00:00.300Z"),
		});

		expect(first).toEqual({
			processed: 1,
			completed: 0,
			released: 1,
			failed: 0,
		});
		expect(beforeRetry.processed).toBe(0);
		expect(second.released).toBe(1);
		expect(third.completed).toBe(1);
		expect(job.attemptsSeen).toEqual([1, 2, 3]);
		expect(calls).toEqual(["done"]);
		expect(readSingleJob(driver).status).toBe("completed");
	});

	test("marks jobs as failed after the last attempt", async () => {
		const driver = new MemoryQueueDriver();
		const manager = new QueueManager(driver);

		await manager.dispatch(new AlwaysFailJob()).now();
		const result = await manager.work({ limit: 2 });
		const queuedJob = readSingleJob(driver);

		expect(result).toEqual({
			processed: 2,
			completed: 0,
			released: 1,
			failed: 1,
		});
		expect(queuedJob.status).toBe("failed");
		expect(queuedJob.attempts).toBe(2);
		expect(queuedJob.lastError?.message).toBe("boom");
	});
});

class RecordingJob extends Job<string> {
	constructor(
		payload: string,
		private readonly calls: string[],
	) {
		super(payload);
	}

	override handle(ctx: JobContext<string>): void {
		this.calls.push(`${ctx.payload ?? ""}:${ctx.attempt}`);
	}
}

class RetryJob extends Job<string> {
	override maxAttempts = 3;
	override backoff = [100, 200];
	readonly attemptsSeen: number[] = [];

	constructor(private readonly calls: string[]) {
		super("retry");
	}

	override handle(ctx: JobContext<string>): void {
		this.attemptsSeen.push(ctx.attempt);

		if (ctx.attempt < 3) {
			throw new Error("temporary failure");
		}

		this.calls.push("done");
	}
}

class AlwaysFailJob extends Job {
	override maxAttempts = 2;
	override backoff = 0;

	override handle(): void {
		throw new Error("boom");
	}
}

function readSingleJob(driver: MemoryQueueDriver): QueuedJob {
	const [queuedJob] = driver.all();

	if (!queuedJob) {
		throw new Error("Expected one queued job");
	}

	return queuedJob;
}

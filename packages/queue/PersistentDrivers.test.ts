import { describe, expect, test } from "bun:test";
import { Job, type JobContext, type QueuedJob, QueueManager } from "./Queue";
import { type RedisQueueClient, RedisQueueDriver } from "./RedisQueueDriver";
import { SQLiteQueueDriver } from "./SQLiteQueueDriver";

describe("SQLiteQueueDriver", () => {
	test("persists and rehydrates jobs through the registry", async () => {
		const driver = new SQLiteQueueDriver({ path: ":memory:" });
		const calls: string[] = [];
		const producer = new QueueManager(driver);
		const worker = new QueueManager(driver).registerJob<string, PersistentJob>(
			"PersistentJob",
			(payload) => new PersistentJob(payload ?? "", calls),
		);

		try {
			await producer.dispatch(new PersistentJob("sqlite", [])).now();
			const result = await worker.work();
			const storedJob = readSingleJob(driver.all(worker.registry));

			expect(result.completed).toBe(1);
			expect(calls).toEqual(["sqlite:1"]);
			expect(storedJob.status).toBe("completed");
		} finally {
			driver.close();
		}
	});

	test("releases delayed retries with persisted attempts", async () => {
		const driver = new SQLiteQueueDriver({ path: ":memory:" });
		const calls: string[] = [];
		const start = new Date("2026-01-01T00:00:00.000Z");
		const manager = new QueueManager(driver).registerJob<string, RetryJob>(
			"RetryJob",
			(payload) => new RetryJob(payload ?? "", calls),
		);

		try {
			await manager.push(new RetryJob("sqlite", []), { now: start });
			const first = await manager.work({ now: start });
			const beforeRetry = await manager.work({
				now: new Date("2026-01-01T00:00:00.049Z"),
			});
			const second = await manager.work({
				now: new Date("2026-01-01T00:00:00.050Z"),
			});
			const storedJob = readSingleJob(driver.all(manager.registry));

			expect(first.released).toBe(1);
			expect(beforeRetry.processed).toBe(0);
			expect(second.completed).toBe(1);
			expect(calls).toEqual(["sqlite:1", "sqlite:2"]);
			expect(storedJob.status).toBe("completed");
		} finally {
			driver.close();
		}
	});

	test("fails clearly when a persisted job is not registered", async () => {
		const driver = new SQLiteQueueDriver({ path: ":memory:" });
		const manager = new QueueManager(driver);

		try {
			await manager.dispatch(new PersistentJob("missing", [])).now();

			await expect(manager.work()).rejects.toMatchObject({
				code: "E_QUEUE_UNREGISTERED_JOB",
			});
		} finally {
			driver.close();
		}
	});
});

describe("RedisQueueDriver", () => {
	test("persists and rehydrates jobs through the registry", async () => {
		const client = new FakeRedisQueueClient();
		const driver = new RedisQueueDriver({ client, prefix: "test:queue" });
		const calls: string[] = [];
		const manager = new QueueManager(driver).registerJob<string, PersistentJob>(
			"PersistentJob",
			(payload) => new PersistentJob(payload ?? "", calls),
		);

		const queuedJob = await manager
			.dispatch(new PersistentJob("redis", []))
			.now();
		const result = await manager.work();
		const storedJob = await driver.find(queuedJob.id, manager.registry);

		expect(result.completed).toBe(1);
		expect(calls).toEqual(["redis:1"]);
		expect(storedJob?.status).toBe("completed");
	});

	test("keeps delayed jobs queued until they are available", async () => {
		const client = new FakeRedisQueueClient();
		const driver = new RedisQueueDriver({ client, prefix: "test:delayed" });
		const calls: string[] = [];
		const availableAt = new Date("2026-01-01T00:00:01.000Z");
		const manager = new QueueManager(driver).registerJob<string, PersistentJob>(
			"PersistentJob",
			(payload) => new PersistentJob(payload ?? "", calls),
		);

		await manager.dispatch(new PersistentJob("later", [])).delay(availableAt);
		const beforeDelay = await manager.work({
			now: new Date("2026-01-01T00:00:00.000Z"),
		});
		const afterDelay = await manager.work({ now: availableAt });

		expect(beforeDelay.processed).toBe(0);
		expect(afterDelay.completed).toBe(1);
		expect(calls).toEqual(["later:1"]);
	});

	test("records terminal failures", async () => {
		const client = new FakeRedisQueueClient();
		const driver = new RedisQueueDriver({ client, prefix: "test:failures" });
		const manager = new QueueManager(driver).registerJob<string, FailingJob>(
			"FailingJob",
			(payload) => new FailingJob(payload ?? ""),
		);

		const queuedJob = await manager.dispatch(new FailingJob("redis")).now();
		const result = await manager.work();
		const storedJob = await driver.find(queuedJob.id, manager.registry);

		expect(result.failed).toBe(1);
		expect(storedJob?.status).toBe("failed");
		expect(storedJob?.lastError?.message).toBe("redis failed");
	});
});

class PersistentJob extends Job<string> {
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
	override maxAttempts = 2;
	override backoff = 50;

	constructor(
		payload: string,
		private readonly calls: string[],
	) {
		super(payload);
	}

	override handle(ctx: JobContext<string>): void {
		this.calls.push(`${ctx.payload ?? ""}:${ctx.attempt}`);

		if (ctx.attempt === 1) {
			throw new Error("retry later");
		}
	}
}

class FailingJob extends Job<string> {
	override handle(ctx: JobContext<string>): void {
		throw new Error(`${ctx.payload ?? ""} failed`);
	}
}

class FakeRedisQueueClient implements RedisQueueClient {
	private readonly values = new Map<string, string>();
	private readonly lists = new Map<string, string[]>();

	get(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	set(key: string, value: string): string {
		this.values.set(key, value);
		return "OK";
	}

	del(key: string): number {
		const deletedValue = this.values.delete(key);
		const deletedList = this.lists.delete(key);

		return Number(deletedValue) + Number(deletedList);
	}

	rpush(key: string, value: string): number {
		const list = this.lists.get(key) ?? [];

		list.push(value);
		this.lists.set(key, list);

		return list.length;
	}

	lrange(key: string, start: number, stop: number): string[] {
		const list = this.lists.get(key) ?? [];
		const end = stop < 0 ? list.length : stop + 1;

		return list.slice(start, end);
	}

	lrem(key: string, count: number, value: string): number {
		const list = this.lists.get(key) ?? [];
		const nextList: string[] = [];
		let removed = 0;

		for (const item of list) {
			if (item === value && removed < count) {
				removed++;
				continue;
			}

			nextList.push(item);
		}

		this.lists.set(key, nextList);

		return removed;
	}
}

function readSingleJob(jobs: QueuedJob[]): QueuedJob {
	const [queuedJob] = jobs;

	if (!queuedJob) {
		throw new Error("Expected one queued job");
	}

	return queuedJob;
}

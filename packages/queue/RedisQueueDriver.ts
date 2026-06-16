import {
	type Job,
	type JobRegistry,
	type QueueDelay,
	type QueueDriver,
	type QueuedJob,
	QueueException,
	type QueueFailure,
	type QueueJobStatus,
} from "./Queue";

type MaybePromise<T> = T | Promise<T>;

export type RedisQueueClient = {
	get(key: string): MaybePromise<string | null>;
	set(key: string, value: string): MaybePromise<unknown>;
	del(key: string): MaybePromise<unknown>;
	rpush(key: string, value: string): MaybePromise<unknown>;
	lrange(key: string, start: number, stop: number): MaybePromise<string[]>;
	lrem(key: string, count: number, value: string): MaybePromise<number>;
};

export type RedisQueueDriverOptions = {
	client: RedisQueueClient;
	prefix?: string;
};

type RedisQueueRecord = {
	id: string;
	queue: string;
	name: string;
	payload: string;
	attempts: number;
	maxAttempts: number;
	status: QueueJobStatus;
	availableAt: number;
	createdAt: number;
	reservedAt: number | null;
	completedAt: number | null;
	failedAt: number | null;
	lastError: QueueFailure | null;
};

export class RedisQueueDriver implements QueueDriver {
	private readonly client: RedisQueueClient;
	private readonly prefix: string;

	constructor(options: RedisQueueDriverOptions) {
		this.client = options.client;
		this.prefix = normalizePrefix(options.prefix ?? "kura:queue");
	}

	async push<TJob extends Job>(
		job: QueuedJob<TJob>,
		registry: JobRegistry,
	): Promise<QueuedJob<TJob>> {
		const serializedJob = registry.serialize(job.job);
		const storedJob: RedisQueueRecord = {
			id: job.id,
			queue: job.queue,
			name: serializedJob.name,
			payload: serializedJob.payload,
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
			status: job.status,
			availableAt: toTimestamp(job.availableAt),
			createdAt: toTimestamp(job.createdAt),
			reservedAt: nullableTimestamp(job.reservedAt),
			completedAt: nullableTimestamp(job.completedAt),
			failedAt: nullableTimestamp(job.failedAt),
			lastError: job.lastError ?? null,
		};

		await this.client.set(this.jobKey(job.id), JSON.stringify(storedJob));
		await this.client.rpush(this.queueKey(job.queue), job.id);

		return copyQueuedJob({
			...job,
			name: serializedJob.name,
		});
	}

	async pop(
		queue: string,
		now: Date,
		registry: JobRegistry,
	): Promise<QueuedJob | null> {
		const queueKey = this.queueKey(queue);
		const ids = await this.client.lrange(queueKey, 0, -1);
		const nowTimestamp = toTimestamp(now);

		for (const id of ids) {
			const record = await this.getRecord(id);

			if (!record) {
				await this.client.lrem(queueKey, 1, id);
				continue;
			}

			if (record.queue !== queue || record.status !== "queued") {
				await this.client.lrem(queueKey, 1, id);
				continue;
			}

			if (record.availableAt > nowTimestamp) {
				continue;
			}

			const reservedRecord: RedisQueueRecord = {
				...record,
				attempts: record.attempts + 1,
				status: "processing",
				reservedAt: nowTimestamp,
				lastError: null,
			};
			const queuedJob = recordToQueuedJob(reservedRecord, registry);
			const removed = await this.client.lrem(queueKey, 1, id);

			if (removed === 0) {
				continue;
			}

			await this.setRecord(reservedRecord);

			return queuedJob;
		}

		return null;
	}

	async complete(id: string, now: Date): Promise<void> {
		const record = await this.requireRecord(id);

		await this.setRecord({
			...record,
			status: "completed",
			completedAt: toTimestamp(now),
			reservedAt: null,
		});
	}

	async release(id: string, delay: QueueDelay, now: Date): Promise<void> {
		const record = await this.requireRecord(id);
		const releasedRecord: RedisQueueRecord = {
			...record,
			status: "queued",
			availableAt: toTimestamp(resolveAvailableAt(delay, now)),
			reservedAt: null,
		};

		await this.setRecord(releasedRecord);
		await this.client.rpush(this.queueKey(releasedRecord.queue), id);
	}

	async fail(id: string, failure: QueueFailure, now: Date): Promise<void> {
		const record = await this.requireRecord(id);

		await this.setRecord({
			...record,
			status: "failed",
			failedAt: toTimestamp(now),
			reservedAt: null,
			lastError: failure,
		});
	}

	async find(id: string, registry: JobRegistry): Promise<QueuedJob | null> {
		const record = await this.getRecord(id);

		return record ? recordToQueuedJob(record, registry) : null;
	}

	async delete(id: string): Promise<void> {
		await this.client.del(this.jobKey(id));
	}

	private async requireRecord(id: string): Promise<RedisQueueRecord> {
		const record = await this.getRecord(id);

		if (!record) {
			throw QueueException.missingJob(id);
		}

		return record;
	}

	private async getRecord(id: string): Promise<RedisQueueRecord | null> {
		const value = await this.client.get(this.jobKey(id));

		if (!value) {
			return null;
		}

		return parseRecord(value);
	}

	private async setRecord(record: RedisQueueRecord): Promise<void> {
		await this.client.set(this.jobKey(record.id), JSON.stringify(record));
	}

	private queueKey(queue: string): string {
		return `${this.prefix}:queues:${queue}`;
	}

	private jobKey(id: string): string {
		return `${this.prefix}:jobs:${id}`;
	}
}

function recordToQueuedJob(
	record: RedisQueueRecord,
	registry: JobRegistry,
): QueuedJob {
	const job = registry.deserialize({
		name: record.name,
		payload: record.payload,
	});

	return {
		id: record.id,
		queue: record.queue,
		name: record.name,
		job,
		attempts: record.attempts,
		maxAttempts: record.maxAttempts,
		status: record.status,
		availableAt: fromTimestamp(record.availableAt),
		createdAt: fromTimestamp(record.createdAt),
		reservedAt: record.reservedAt
			? fromTimestamp(record.reservedAt)
			: undefined,
		completedAt: record.completedAt
			? fromTimestamp(record.completedAt)
			: undefined,
		failedAt: record.failedAt ? fromTimestamp(record.failedAt) : undefined,
		lastError: record.lastError ?? undefined,
	};
}

function parseRecord(value: string): RedisQueueRecord {
	const parsed = JSON.parse(value) as Partial<RedisQueueRecord>;

	if (
		typeof parsed.id === "string" &&
		typeof parsed.queue === "string" &&
		typeof parsed.name === "string" &&
		typeof parsed.payload === "string" &&
		typeof parsed.attempts === "number" &&
		typeof parsed.maxAttempts === "number" &&
		isStatus(parsed.status) &&
		typeof parsed.availableAt === "number" &&
		typeof parsed.createdAt === "number"
	) {
		return {
			id: parsed.id,
			queue: parsed.queue,
			name: parsed.name,
			payload: parsed.payload,
			attempts: parsed.attempts,
			maxAttempts: parsed.maxAttempts,
			status: parsed.status,
			availableAt: parsed.availableAt,
			createdAt: parsed.createdAt,
			reservedAt:
				typeof parsed.reservedAt === "number" ? parsed.reservedAt : null,
			completedAt:
				typeof parsed.completedAt === "number" ? parsed.completedAt : null,
			failedAt: typeof parsed.failedAt === "number" ? parsed.failedAt : null,
			lastError: isFailure(parsed.lastError) ? parsed.lastError : null,
		};
	}

	throw new QueueException(
		"Invalid Redis queue record",
		"E_QUEUE_INVALID_REDIS_RECORD",
	);
}

function isStatus(status: unknown): status is QueueJobStatus {
	return (
		status === "queued" ||
		status === "processing" ||
		status === "completed" ||
		status === "failed"
	);
}

function isFailure(failure: unknown): failure is QueueFailure {
	return (
		typeof failure === "object" &&
		failure !== null &&
		"name" in failure &&
		"message" in failure &&
		typeof failure.name === "string" &&
		typeof failure.message === "string"
	);
}

function normalizePrefix(prefix: string): string {
	const normalized = prefix.trim().replace(/:+$/, "");

	if (!normalized) {
		throw new QueueException(
			"Invalid Redis queue prefix",
			"E_QUEUE_INVALID_REDIS_PREFIX",
			500,
			"Redis queue prefixes must not be empty.",
		);
	}

	return normalized;
}

function resolveAvailableAt(delay: QueueDelay, now: Date): Date {
	if (delay instanceof Date) {
		if (Number.isNaN(delay.getTime())) {
			throw QueueException.invalidDelay(delay);
		}

		return new Date(delay.getTime());
	}

	if (!Number.isFinite(delay) || delay < 0) {
		throw QueueException.invalidDelay(delay);
	}

	return new Date(now.getTime() + delay);
}

function copyQueuedJob<TJob extends Job>(
	job: QueuedJob<TJob>,
): QueuedJob<TJob> {
	return {
		...job,
		availableAt: new Date(job.availableAt.getTime()),
		createdAt: new Date(job.createdAt.getTime()),
		reservedAt: job.reservedAt ? new Date(job.reservedAt.getTime()) : undefined,
		completedAt: job.completedAt
			? new Date(job.completedAt.getTime())
			: undefined,
		failedAt: job.failedAt ? new Date(job.failedAt.getTime()) : undefined,
		lastError: job.lastError ? { ...job.lastError } : undefined,
	};
}

function toTimestamp(date: Date): number {
	return date.getTime();
}

function nullableTimestamp(date: Date | undefined): number | null {
	return date ? toTimestamp(date) : null;
}

function fromTimestamp(timestamp: number): Date {
	return new Date(timestamp);
}

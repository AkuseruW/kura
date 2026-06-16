import { BaseException } from "../core/BaseException";

export type QueueDelay = number | Date;
export type QueueBackoff =
	| number
	| number[]
	| ((attempt: number, error: unknown) => number);
export type JobHandleResult = void | Promise<void>;
export type QueueJobStatus = "queued" | "processing" | "completed" | "failed";

export type QueueFailure = {
	name: string;
	message: string;
	stack?: string;
};

export type QueuedJob<TJob extends Job = Job> = {
	id: string;
	queue: string;
	job: TJob;
	attempts: number;
	maxAttempts: number;
	status: QueueJobStatus;
	availableAt: Date;
	createdAt: Date;
	reservedAt?: Date;
	completedAt?: Date;
	failedAt?: Date;
	lastError?: QueueFailure;
};

export type JobContext<TPayload = unknown> = {
	queuedJob: QueuedJob<Job<TPayload>>;
	payload: TPayload | undefined;
	attempt: number;
	queue: QueueManager;
};

export type QueuePushOptions = {
	queue?: string;
	delay?: QueueDelay;
	now?: Date;
	id?: string;
	maxAttempts?: number;
};

export type QueueWorkOptions = {
	queue?: string;
	limit?: number;
	now?: Date;
};

export type QueueWorkResult = {
	processed: number;
	completed: number;
	released: number;
	failed: number;
};

export interface QueueDriver {
	push<TJob extends Job>(job: QueuedJob<TJob>): Promise<QueuedJob<TJob>>;
	pop(queue: string, now: Date): Promise<QueuedJob | null>;
	complete(id: string, now: Date): Promise<void>;
	release(id: string, delay: QueueDelay, now: Date): Promise<void>;
	fail(id: string, failure: QueueFailure, now: Date): Promise<void>;
}

export class QueueException extends BaseException {
	static invalidQueueName(queue: string): QueueException {
		return new QueueException(
			`Invalid queue name [${queue}]`,
			"E_QUEUE_INVALID_NAME",
			500,
			"Queue names must not be empty.",
		);
	}

	static invalidDelay(delay: unknown): QueueException {
		return new QueueException(
			`Invalid queue delay [${String(delay)}]`,
			"E_QUEUE_INVALID_DELAY",
			500,
			"Queue delays must be positive finite milliseconds or a valid Date.",
		);
	}

	static invalidMaxAttempts(maxAttempts: number): QueueException {
		return new QueueException(
			`Invalid max attempts [${maxAttempts}]`,
			"E_QUEUE_INVALID_ATTEMPTS",
			500,
			"Max attempts must be a positive finite integer.",
		);
	}

	static invalidWorkerLimit(limit: number): QueueException {
		return new QueueException(
			`Invalid worker limit [${limit}]`,
			"E_QUEUE_INVALID_WORKER_LIMIT",
			500,
			"Worker limits must be positive finite integers.",
		);
	}

	static missingJob(id: string): QueueException {
		return new QueueException(
			`Queue job [${id}] was not found`,
			"E_QUEUE_JOB_NOT_FOUND",
		);
	}
}

export abstract class Job<TPayload = unknown> {
	queue = "default";
	maxAttempts = 1;
	backoff: QueueBackoff = 0;

	constructor(public readonly payload?: TPayload) {}

	abstract handle(ctx: JobContext<TPayload>): JobHandleResult;
}

export class PendingDispatch<TJob extends Job = Job> {
	private options: QueuePushOptions = {};

	constructor(
		private readonly manager: QueueManager,
		private readonly job: TJob,
	) {}

	onQueue(queue: string): this {
		this.options.queue = queue;
		return this;
	}

	now(): Promise<QueuedJob<TJob>> {
		return this.manager.push(this.job, {
			...this.options,
			delay: 0,
		});
	}

	enqueue(): Promise<QueuedJob<TJob>> {
		return this.manager.push(this.job, this.options);
	}

	delay(delay: QueueDelay): Promise<QueuedJob<TJob>> {
		return this.manager.push(this.job, {
			...this.options,
			delay,
		});
	}
}

export class QueueManager {
	constructor(public readonly driver: QueueDriver = new MemoryQueueDriver()) {}

	dispatch<TJob extends Job>(job: TJob): PendingDispatch<TJob> {
		return new PendingDispatch(this, job);
	}

	push<TJob extends Job>(
		job: TJob,
		options: QueuePushOptions = {},
	): Promise<QueuedJob<TJob>> {
		const now = options.now ?? new Date();
		const queue = normalizeQueueName(options.queue ?? job.queue);
		const maxAttempts = normalizeMaxAttempts(
			options.maxAttempts ?? job.maxAttempts,
		);

		return this.driver.push({
			id: options.id ?? crypto.randomUUID(),
			queue,
			job,
			attempts: 0,
			maxAttempts,
			status: "queued",
			availableAt: resolveAvailableAt(options.delay, now),
			createdAt: copyDate(now),
		});
	}

	work(options: QueueWorkOptions = {}): Promise<QueueWorkResult> {
		return new QueueWorker(this).work(options);
	}
}

export class QueueWorker {
	constructor(private readonly manager: QueueManager) {}

	async work(options: QueueWorkOptions = {}): Promise<QueueWorkResult> {
		const queue = normalizeQueueName(options.queue ?? "default");
		const limit = normalizeWorkerLimit(options.limit ?? 1);
		const now = options.now ?? new Date();
		const result: QueueWorkResult = {
			processed: 0,
			completed: 0,
			released: 0,
			failed: 0,
		};

		for (let processed = 0; processed < limit; processed++) {
			const queuedJob = await this.manager.driver.pop(queue, now);

			if (!queuedJob) {
				break;
			}

			result.processed++;
			await this.handleJob(queuedJob, now, result);
		}

		return result;
	}

	private async handleJob(
		queuedJob: QueuedJob,
		now: Date,
		result: QueueWorkResult,
	): Promise<void> {
		try {
			await queuedJob.job.handle({
				queuedJob: queuedJob as QueuedJob<Job<unknown>>,
				payload: queuedJob.job.payload,
				attempt: queuedJob.attempts,
				queue: this.manager,
			});
			await this.manager.driver.complete(queuedJob.id, now);
			result.completed++;
		} catch (error) {
			if (queuedJob.attempts < queuedJob.maxAttempts) {
				if (await this.releaseJob(queuedJob, error, now)) {
					result.released++;
					return;
				}
				result.failed++;
				return;
			}

			await this.manager.driver.fail(queuedJob.id, toQueueFailure(error), now);
			result.failed++;
		}
	}

	private async releaseJob(
		queuedJob: QueuedJob,
		error: unknown,
		now: Date,
	): Promise<boolean> {
		try {
			const delay = resolveBackoff(
				queuedJob.job.backoff,
				queuedJob.attempts,
				error,
			);
			await this.manager.driver.release(queuedJob.id, delay, now);
			return true;
		} catch (backoffError) {
			await this.manager.driver.fail(
				queuedJob.id,
				toQueueFailure(backoffError),
				now,
			);
			return false;
		}
	}
}

export class MemoryQueueDriver implements QueueDriver {
	private readonly jobs = new Map<string, QueuedJob>();
	private readonly order: string[] = [];

	async push<TJob extends Job>(job: QueuedJob<TJob>): Promise<QueuedJob<TJob>> {
		const storedJob = copyQueuedJob(job);

		this.jobs.set(storedJob.id, storedJob);
		this.order.push(storedJob.id);

		return copyQueuedJob(storedJob);
	}

	async pop(queue: string, now: Date): Promise<QueuedJob | null> {
		for (const id of this.order) {
			const job = this.jobs.get(id);

			if (!job || job.queue !== queue || job.status !== "queued") {
				continue;
			}

			if (job.availableAt.getTime() > now.getTime()) {
				continue;
			}

			job.status = "processing";
			job.attempts++;
			job.reservedAt = copyDate(now);
			job.lastError = undefined;

			return copyQueuedJob(job);
		}

		return null;
	}

	async complete(id: string, now: Date): Promise<void> {
		const job = this.getJob(id);

		job.status = "completed";
		job.completedAt = copyDate(now);
		job.reservedAt = undefined;
	}

	async release(id: string, delay: QueueDelay, now: Date): Promise<void> {
		const job = this.getJob(id);

		job.status = "queued";
		job.availableAt = resolveAvailableAt(delay, now);
		job.reservedAt = undefined;
	}

	async fail(id: string, failure: QueueFailure, now: Date): Promise<void> {
		const job = this.getJob(id);

		job.status = "failed";
		job.failedAt = copyDate(now);
		job.reservedAt = undefined;
		job.lastError = failure;
	}

	all(): QueuedJob[] {
		return this.order
			.map((id) => this.jobs.get(id))
			.filter((job): job is QueuedJob => Boolean(job))
			.map((job) => copyQueuedJob(job));
	}

	private getJob(id: string): QueuedJob {
		const job = this.jobs.get(id);

		if (!job) {
			throw QueueException.missingJob(id);
		}

		return job;
	}
}

export const queue = new QueueManager();

export function dispatch<TJob extends Job>(
	job: TJob,
	manager: QueueManager = queue,
): PendingDispatch<TJob> {
	return manager.dispatch(job);
}

function normalizeQueueName(queue: string): string {
	const normalized = queue.trim();

	if (!normalized) {
		throw QueueException.invalidQueueName(queue);
	}

	return normalized;
}

function normalizeMaxAttempts(maxAttempts: number): number {
	if (
		!Number.isFinite(maxAttempts) ||
		!Number.isInteger(maxAttempts) ||
		maxAttempts < 1
	) {
		throw QueueException.invalidMaxAttempts(maxAttempts);
	}

	return maxAttempts;
}

function normalizeWorkerLimit(limit: number): number {
	if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
		throw QueueException.invalidWorkerLimit(limit);
	}

	return limit;
}

function resolveAvailableAt(delay: QueueDelay | undefined, now: Date): Date {
	if (delay === undefined) {
		return copyDate(now);
	}

	if (delay instanceof Date) {
		if (Number.isNaN(delay.getTime())) {
			throw QueueException.invalidDelay(delay);
		}

		return copyDate(delay);
	}

	if (!Number.isFinite(delay) || delay < 0) {
		throw QueueException.invalidDelay(delay);
	}

	return new Date(now.getTime() + delay);
}

function resolveBackoff(
	backoff: QueueBackoff,
	attempt: number,
	error: unknown,
): number {
	if (typeof backoff === "function") {
		return normalizeBackoff(backoff(attempt, error));
	}

	if (Array.isArray(backoff)) {
		if (backoff.length === 0) {
			return 0;
		}

		const index = Math.min(attempt - 1, backoff.length - 1);
		const delay = backoff[index] ?? 0;

		return normalizeBackoff(delay);
	}

	return normalizeBackoff(backoff);
}

function normalizeBackoff(delay: number): number {
	if (!Number.isFinite(delay) || delay < 0) {
		throw QueueException.invalidDelay(delay);
	}

	return delay;
}

function toQueueFailure(error: unknown): QueueFailure {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}

	return {
		name: "Error",
		message: typeof error === "string" ? error : "Queue job failed",
	};
}

function copyQueuedJob<TJob extends Job>(
	job: QueuedJob<TJob>,
): QueuedJob<TJob> {
	return {
		...job,
		availableAt: copyDate(job.availableAt),
		createdAt: copyDate(job.createdAt),
		reservedAt: job.reservedAt ? copyDate(job.reservedAt) : undefined,
		completedAt: job.completedAt ? copyDate(job.completedAt) : undefined,
		failedAt: job.failedAt ? copyDate(job.failedAt) : undefined,
		lastError: job.lastError ? { ...job.lastError } : undefined,
	};
}

function copyDate(date: Date): Date {
	return new Date(date.getTime());
}

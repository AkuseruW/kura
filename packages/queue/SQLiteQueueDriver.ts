import { Database } from "bun:sqlite";
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

export type SQLiteQueueDriverOptions = {
	database?: Database;
	path?: string;
	table?: string;
	autoMigrate?: boolean;
};

type SQLiteQueueRow = {
	id: string;
	queue: string;
	name: string;
	payload: string;
	attempts: number;
	max_attempts: number;
	status: string;
	available_at: number;
	created_at: number;
	reserved_at: number | null;
	completed_at: number | null;
	failed_at: number | null;
	last_error: string | null;
};

export class SQLiteQueueDriver implements QueueDriver {
	private readonly database: Database;
	private readonly table: string;

	constructor(options: SQLiteQueueDriverOptions = {}) {
		this.database =
			options.database ?? new Database(options.path ?? "kura_queue.sqlite");
		this.table = normalizeIdentifier(options.table ?? "kura_queue_jobs");

		if (options.autoMigrate !== false) {
			this.migrate();
		}
	}

	async push<TJob extends Job>(
		job: QueuedJob<TJob>,
		registry: JobRegistry,
	): Promise<QueuedJob<TJob>> {
		const serializedJob = registry.serialize(job.job);

		this.database
			.query(
				`INSERT INTO ${this.table} (
					id,
					queue,
					name,
					payload,
					attempts,
					max_attempts,
					status,
					available_at,
					created_at,
					reserved_at,
					completed_at,
					failed_at,
					last_error
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				job.id,
				job.queue,
				serializedJob.name,
				serializedJob.payload,
				job.attempts,
				job.maxAttempts,
				job.status,
				toTimestamp(job.availableAt),
				toTimestamp(job.createdAt),
				nullableTimestamp(job.reservedAt),
				nullableTimestamp(job.completedAt),
				nullableTimestamp(job.failedAt),
				serializeFailure(job.lastError),
			);

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
		const nowTimestamp = toTimestamp(now);

		this.database.exec("BEGIN IMMEDIATE");

		try {
			const row = this.database
				.query(
					`SELECT * FROM ${this.table}
					WHERE queue = ?
						AND status = 'queued'
						AND available_at <= ?
					ORDER BY created_at ASC
					LIMIT 1`,
				)
				.get(queue, nowTimestamp) as SQLiteQueueRow | null;

			if (!row) {
				this.database.exec("COMMIT");
				return null;
			}

			const attempts = row.attempts + 1;
			const reservedRow: SQLiteQueueRow = {
				...row,
				attempts,
				status: "processing",
				reserved_at: nowTimestamp,
				last_error: null,
			};
			const queuedJob = rowToQueuedJob(reservedRow, registry);

			assertChanged(
				this.database
					.query(
						`UPDATE ${this.table}
						SET status = 'processing',
							attempts = ?,
							reserved_at = ?,
							last_error = NULL
						WHERE id = ?
							AND status = 'queued'`,
					)
					.run(attempts, nowTimestamp, row.id),
				row.id,
			);
			this.database.exec("COMMIT");

			return queuedJob;
		} catch (error) {
			this.database.exec("ROLLBACK");
			throw error;
		}
	}

	async complete(id: string, now: Date): Promise<void> {
		assertChanged(
			this.database
				.query(
					`UPDATE ${this.table}
					SET status = 'completed',
						completed_at = ?,
						reserved_at = NULL
					WHERE id = ?`,
				)
				.run(toTimestamp(now), id),
			id,
		);
	}

	async release(id: string, delay: QueueDelay, now: Date): Promise<void> {
		assertChanged(
			this.database
				.query(
					`UPDATE ${this.table}
					SET status = 'queued',
						available_at = ?,
						reserved_at = NULL
					WHERE id = ?`,
				)
				.run(toTimestamp(resolveAvailableAt(delay, now)), id),
			id,
		);
	}

	async fail(id: string, failure: QueueFailure, now: Date): Promise<void> {
		assertChanged(
			this.database
				.query(
					`UPDATE ${this.table}
					SET status = 'failed',
						failed_at = ?,
						reserved_at = NULL,
						last_error = ?
					WHERE id = ?`,
				)
				.run(toTimestamp(now), serializeFailure(failure), id),
			id,
		);
	}

	all(registry: JobRegistry): QueuedJob[] {
		return (
			this.database
				.query(`SELECT * FROM ${this.table} ORDER BY created_at ASC`)
				.all() as SQLiteQueueRow[]
		).map((row) => rowToQueuedJob(row, registry));
	}

	close(): void {
		this.database.close();
	}

	private migrate(): void {
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS ${this.table} (
				id TEXT PRIMARY KEY,
				queue TEXT NOT NULL,
				name TEXT NOT NULL,
				payload TEXT NOT NULL,
				attempts INTEGER NOT NULL,
				max_attempts INTEGER NOT NULL,
				status TEXT NOT NULL,
				available_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				reserved_at INTEGER,
				completed_at INTEGER,
				failed_at INTEGER,
				last_error TEXT
			);
			CREATE INDEX IF NOT EXISTS ${this.table}_ready_idx
				ON ${this.table} (queue, status, available_at, created_at);
		`);
	}
}

function rowToQueuedJob(row: SQLiteQueueRow, registry: JobRegistry): QueuedJob {
	const name = row.name;
	const job = registry.deserialize({ name, payload: row.payload });

	return {
		id: row.id,
		queue: row.queue,
		name,
		job,
		attempts: row.attempts,
		maxAttempts: row.max_attempts,
		status: parseStatus(row.status),
		availableAt: fromTimestamp(row.available_at),
		createdAt: fromTimestamp(row.created_at),
		reservedAt: row.reserved_at ? fromTimestamp(row.reserved_at) : undefined,
		completedAt: row.completed_at ? fromTimestamp(row.completed_at) : undefined,
		failedAt: row.failed_at ? fromTimestamp(row.failed_at) : undefined,
		lastError: parseFailure(row.last_error),
	};
}

function normalizeIdentifier(identifier: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
		throw new QueueException(
			`Invalid SQLite identifier [${identifier}]`,
			"E_QUEUE_INVALID_SQLITE_IDENTIFIER",
			500,
			"SQLite queue table names must use letters, numbers, and underscores.",
		);
	}

	return identifier;
}

function parseStatus(status: string): QueueJobStatus {
	if (
		status === "queued" ||
		status === "processing" ||
		status === "completed" ||
		status === "failed"
	) {
		return status;
	}

	throw new QueueException(
		`Invalid queue job status [${status}]`,
		"E_QUEUE_INVALID_STATUS",
	);
}

function parseFailure(value: string | null): QueueFailure | undefined {
	if (!value) {
		return undefined;
	}

	const parsed = JSON.parse(value) as Partial<QueueFailure>;

	if (typeof parsed.name === "string" && typeof parsed.message === "string") {
		return {
			name: parsed.name,
			message: parsed.message,
			stack: typeof parsed.stack === "string" ? parsed.stack : undefined,
		};
	}

	return undefined;
}

function serializeFailure(failure: QueueFailure | undefined): string | null {
	return failure ? JSON.stringify(failure) : null;
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

function assertChanged(result: { changes: number | bigint }, id: string): void {
	if (Number(result.changes) === 0) {
		throw QueueException.missingJob(id);
	}
}

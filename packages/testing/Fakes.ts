import { AssertionError } from "node:assert";
import { isDeepStrictEqual } from "node:util";
import { Emitter, type Event, type Listener } from "../core/Event";
import { UploadedFile } from "../http/Upload";
import {
	type Job,
	type JobRegistry,
	MemoryQueueDriver,
	type QueueDelay,
	type QueueDriver,
	type QueuedJob,
	type QueueFailure,
} from "../queue/Queue";

export type FakeMailAddress = string | readonly string[];

export interface FakeMailMessage {
	readonly to: FakeMailAddress;
	readonly subject: string;
	readonly from?: FakeMailAddress;
	readonly cc?: FakeMailAddress;
	readonly bcc?: FakeMailAddress;
	readonly text?: string;
	readonly html?: string;
	readonly headers?: Record<string, string>;
	readonly data?: Record<string, unknown>;
}

export interface FakeMailRecord {
	readonly message: FakeMailMessage;
	readonly sentAt: Date;
}

export type FakeMailMessageMatch = Partial<FakeMailMessage>;
export type FakeMailMatcher =
	| FakeMailMessageMatch
	| ((record: FakeMailRecord) => boolean);

export class FakeMailDriver {
	private records: FakeMailRecord[] = [];

	async send(message: FakeMailMessage): Promise<FakeMailRecord> {
		const record: FakeMailRecord = {
			message: copyMailMessage(message),
			sentAt: new Date(),
		};
		this.records.push(record);

		return copyMailRecord(record);
	}

	all(): FakeMailRecord[] {
		return this.records.map(copyMailRecord);
	}

	sent(matcher?: FakeMailMatcher): FakeMailRecord[] {
		return this.all().filter((record) => matchesMailRecord(record, matcher));
	}

	clear(): this {
		this.records = [];

		return this;
	}

	assertSent(matcher?: FakeMailMatcher): this {
		assertAtLeastOne(this.sent(matcher).length, "mail", "sent", matcher);

		return this;
	}

	assertSentTimes(expected: number, matcher?: FakeMailMatcher): this {
		assertCount(this.sent(matcher).length, expected, "mail", "sent");

		return this;
	}

	assertNotSent(matcher?: FakeMailMatcher): this {
		assertNone(this.sent(matcher).length, "mail", "sent", matcher);

		return this;
	}
}

export type FakeUploadedFileContent =
	| string
	| Uint8Array
	| ArrayBuffer
	| Blob
	| readonly (string | Uint8Array | ArrayBuffer | Blob)[];

export type FakeUploadedFileOptions = {
	readonly fieldName?: string;
	readonly name?: string;
	readonly type?: string;
	readonly lastModified?: number;
};

export function fakeUploadedFile(
	content: FakeUploadedFileContent = "",
	options: FakeUploadedFileOptions = {},
): UploadedFile {
	const parts = Array.isArray(content) ? [...content] : [content];
	const file = new File(parts, options.name ?? "upload.txt", {
		lastModified: options.lastModified,
		type: options.type,
	});

	return new UploadedFile(file, { fieldName: options.fieldName ?? "file" });
}

export type FakeStorageValue =
	| string
	| Uint8Array
	| ArrayBuffer
	| Blob
	| File
	| UploadedFile;

export type FakeStorageRecord = {
	readonly key: string;
	readonly bytes: Uint8Array;
	readonly size: number;
	readonly storedAt: Date;
	readonly clientName?: string;
	readonly type?: string;
};

export type FakeStorageMatcher =
	| string
	| Partial<FakeStorageRecord>
	| ((record: FakeStorageRecord) => boolean);

export class FakeStorage {
	private records = new Map<string, FakeStorageRecord>();

	async put(key: string, value: FakeStorageValue): Promise<FakeStorageRecord> {
		const normalizedKey = normalizeStorageKey(key);
		const storedValue = await storageValueToRecordValue(value);
		const record: FakeStorageRecord = {
			key: normalizedKey,
			bytes: storedValue.bytes,
			size: storedValue.bytes.byteLength,
			storedAt: new Date(),
			clientName: storedValue.clientName,
			type: storedValue.type,
		};

		this.records.set(normalizedKey, record);
		return copyStorageRecord(record);
	}

	async putFile(
		key: string,
		file: UploadedFile | File,
	): Promise<FakeStorageRecord> {
		return this.put(key, file);
	}

	get(key: string): FakeStorageRecord | null {
		const record = this.records.get(normalizeStorageKey(key));
		return record ? copyStorageRecord(record) : null;
	}

	exists(key: string): boolean {
		return this.records.has(normalizeStorageKey(key));
	}

	all(): FakeStorageRecord[] {
		return [...this.records.values()].map(copyStorageRecord);
	}

	stored(matcher?: FakeStorageMatcher): FakeStorageRecord[] {
		return this.all().filter((record) => matchesStorageRecord(record, matcher));
	}

	clear(): this {
		this.records.clear();

		return this;
	}

	assertStored(matcher?: FakeStorageMatcher): this {
		assertAtLeastOne(this.stored(matcher).length, "file", "stored", matcher);

		return this;
	}

	assertStoredTimes(expected: number, matcher?: FakeStorageMatcher): this {
		assertCount(this.stored(matcher).length, expected, "file", "stored");

		return this;
	}

	assertNotStored(matcher?: FakeStorageMatcher): this {
		assertNone(this.stored(matcher).length, "file", "stored", matcher);

		return this;
	}

	assertStoredContent(key: string, expected: string | Uint8Array): this {
		const normalizedKey = normalizeStorageKey(key);
		const record = this.records.get(normalizedKey);
		const expectedBytes =
			typeof expected === "string"
				? new TextEncoder().encode(expected)
				: expected;

		if (!record || !isDeepStrictEqual(record.bytes, expectedBytes)) {
			throw new AssertionError({
				message: `Expected stored file [${normalizedKey}] to match content`,
				actual: record?.bytes,
				expected: expectedBytes,
				operator: "deepStrictEqual",
				stackStartFn: this.assertStoredContent,
			});
		}

		return this;
	}
}

export type FakeQueueMatcher = string | ((job: QueuedJob) => boolean);

export class FakeQueueDriver implements QueueDriver {
	private driver = new MemoryQueueDriver();

	push<TJob extends Job>(
		job: QueuedJob<TJob>,
		registry: JobRegistry,
	): Promise<QueuedJob<TJob>> {
		return this.driver.push(job, registry);
	}

	pop(
		queue: string,
		now: Date,
		registry: JobRegistry,
	): Promise<QueuedJob | null> {
		return this.driver.pop(queue, now, registry);
	}

	complete(id: string, now: Date): Promise<void> {
		return this.driver.complete(id, now);
	}

	release(id: string, delay: QueueDelay, now: Date): Promise<void> {
		return this.driver.release(id, delay, now);
	}

	fail(id: string, failure: QueueFailure, now: Date): Promise<void> {
		return this.driver.fail(id, failure, now);
	}

	all(): QueuedJob[] {
		return this.driver.all();
	}

	pushed(matcher?: FakeQueueMatcher): QueuedJob[] {
		return this.all().filter((job) => matchesQueuedJob(job, matcher));
	}

	clear(): this {
		this.driver = new MemoryQueueDriver();

		return this;
	}

	assertPushed(matcher?: FakeQueueMatcher): this {
		assertAtLeastOne(
			this.pushed(matcher).length,
			"queue job",
			"pushed",
			matcher,
		);

		return this;
	}

	assertPushedTimes(expected: number, matcher?: FakeQueueMatcher): this {
		assertCount(this.pushed(matcher).length, expected, "queue job", "pushed");

		return this;
	}

	assertNotPushed(matcher?: FakeQueueMatcher): this {
		assertNone(this.pushed(matcher).length, "queue job", "pushed", matcher);

		return this;
	}
}

export interface FakeEventRecord<TPayload = unknown> {
	readonly event: Event<TPayload>;
	readonly name: string;
	readonly payload: TPayload;
	readonly dispatchedAt: Date;
}

export type FakeEventMatcher<TPayload = unknown> =
	| string
	| ((record: FakeEventRecord<TPayload>) => boolean);

export class FakeEventDispatcher<TPayload = unknown> {
	private readonly emitter = new Emitter<TPayload>();
	private records: FakeEventRecord<TPayload>[] = [];

	on(eventName: string, listener: Listener<TPayload>): () => void {
		return this.emitter.on(eventName, listener);
	}

	off(eventName: string, listener: Listener<TPayload>): void {
		this.emitter.off(eventName, listener);
	}

	async dispatch(event: Event<TPayload>): Promise<void> {
		await this.emit(event);
	}

	async emit(event: Event<TPayload>): Promise<void> {
		this.records.push({
			event,
			name: event.name,
			payload: event.payload,
			dispatchedAt: new Date(),
		});
		await this.emitter.emit(event);
	}

	all(): FakeEventRecord<TPayload>[] {
		return this.records.map(copyEventRecord);
	}

	dispatched(
		matcher?: FakeEventMatcher<TPayload>,
	): FakeEventRecord<TPayload>[] {
		return this.all().filter((record) => matchesEventRecord(record, matcher));
	}

	clear(): this {
		this.records = [];

		return this;
	}

	assertDispatched(matcher?: FakeEventMatcher<TPayload>): this {
		assertAtLeastOne(
			this.dispatched(matcher).length,
			"event",
			"dispatched",
			matcher,
		);

		return this;
	}

	assertDispatchedTimes(
		expected: number,
		matcher?: FakeEventMatcher<TPayload>,
	): this {
		assertCount(
			this.dispatched(matcher).length,
			expected,
			"event",
			"dispatched",
		);

		return this;
	}

	assertNotDispatched(matcher?: FakeEventMatcher<TPayload>): this {
		assertNone(this.dispatched(matcher).length, "event", "dispatched", matcher);

		return this;
	}
}

function matchesMailRecord(
	record: FakeMailRecord,
	matcher: FakeMailMatcher | undefined,
): boolean {
	if (!matcher) {
		return true;
	}

	if (typeof matcher === "function") {
		return matcher(record);
	}

	return matchesPartial(record.message, matcher);
}

function matchesQueuedJob(
	job: QueuedJob,
	matcher: FakeQueueMatcher | undefined,
): boolean {
	if (!matcher) {
		return true;
	}

	if (typeof matcher === "string") {
		return job.name === matcher;
	}

	return matcher(job);
}

function matchesStorageRecord(
	record: FakeStorageRecord,
	matcher: FakeStorageMatcher | undefined,
): boolean {
	if (!matcher) {
		return true;
	}

	if (typeof matcher === "string") {
		return record.key === matcher;
	}

	if (typeof matcher === "function") {
		return matcher(record);
	}

	return matchesPartial(record, matcher);
}

function matchesEventRecord<TPayload>(
	record: FakeEventRecord<TPayload>,
	matcher: FakeEventMatcher<TPayload> | undefined,
): boolean {
	if (!matcher) {
		return true;
	}

	if (typeof matcher === "string") {
		return record.name === matcher;
	}

	return matcher(record);
}

function matchesPartial<T extends object>(actual: T, expected: Partial<T>) {
	const actualRecord = actual as Record<string, unknown>;
	const expectedRecord = expected as Record<string, unknown>;

	for (const [key, expectedValue] of Object.entries(expectedRecord)) {
		if (expectedValue === undefined) {
			continue;
		}

		if (!isDeepStrictEqual(actualRecord[key], expectedValue)) {
			return false;
		}
	}

	return true;
}

function assertAtLeastOne(
	actual: number,
	subject: string,
	action: string,
	matcher: unknown,
): void {
	if (actual > 0) {
		return;
	}

	throw new AssertionError({
		message: `Expected ${subject} to be ${action}`,
		actual,
		expected: matcherDescription(matcher),
		operator: ">",
	});
}

function assertCount(
	actual: number,
	expected: number,
	subject: string,
	action: string,
): void {
	if (actual === expected) {
		return;
	}

	throw new AssertionError({
		message: `Expected ${subject} to be ${action} ${expected} times, received ${actual}`,
		actual,
		expected,
		operator: "===",
		stackStartFn: assertCount,
	});
}

function assertNone(
	actual: number,
	subject: string,
	action: string,
	matcher: unknown,
): void {
	if (actual === 0) {
		return;
	}

	throw new AssertionError({
		message: `Expected ${subject} not to be ${action}, received ${actual}`,
		actual,
		expected: matcherDescription(matcher),
		operator: "===",
	});
}

function matcherDescription(matcher: unknown): unknown {
	if (typeof matcher === "function") {
		return "custom matcher";
	}

	return matcher ?? "unfiltered";
}

function copyMailRecord(record: FakeMailRecord): FakeMailRecord {
	return {
		message: copyMailMessage(record.message),
		sentAt: copyDate(record.sentAt),
	};
}

function copyMailMessage(message: FakeMailMessage): FakeMailMessage {
	return {
		...message,
		to: copyAddress(message.to),
		from: message.from ? copyAddress(message.from) : undefined,
		cc: message.cc ? copyAddress(message.cc) : undefined,
		bcc: message.bcc ? copyAddress(message.bcc) : undefined,
		headers: message.headers ? { ...message.headers } : undefined,
		data: message.data ? { ...message.data } : undefined,
	};
}

function copyAddress(address: FakeMailAddress): FakeMailAddress {
	return Array.isArray(address) ? [...address] : address;
}

function copyEventRecord<TPayload>(
	record: FakeEventRecord<TPayload>,
): FakeEventRecord<TPayload> {
	return {
		event: record.event,
		name: record.name,
		payload: record.payload,
		dispatchedAt: copyDate(record.dispatchedAt),
	};
}

function copyStorageRecord(record: FakeStorageRecord): FakeStorageRecord {
	return {
		key: record.key,
		bytes: new Uint8Array(record.bytes),
		size: record.size,
		storedAt: copyDate(record.storedAt),
		clientName: record.clientName,
		type: record.type,
	};
}

function copyDate(date: Date): Date {
	return new Date(date.getTime());
}

type StorageRecordValue = {
	readonly bytes: Uint8Array;
	readonly clientName?: string;
	readonly type?: string;
};

async function storageValueToRecordValue(
	value: FakeStorageValue,
): Promise<StorageRecordValue> {
	if (value instanceof UploadedFile) {
		const file = value.toFile();
		return {
			bytes: await blobToBytes(file),
			clientName: value.clientName,
			type: value.type,
		};
	}

	if (value instanceof File) {
		return {
			bytes: await blobToBytes(value),
			clientName: value.name,
			type: value.type,
		};
	}

	if (value instanceof Blob) {
		return {
			bytes: await blobToBytes(value),
			type: value.type,
		};
	}

	if (value instanceof ArrayBuffer) {
		return { bytes: new Uint8Array(value) };
	}

	if (value instanceof Uint8Array) {
		return { bytes: new Uint8Array(value) };
	}

	return { bytes: new TextEncoder().encode(value) };
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

function normalizeStorageKey(key: string): string {
	const normalized = key.trim().replace(/^\/+/, "");
	if (!normalized) {
		throw new Error("Storage key cannot be empty");
	}

	return normalized;
}

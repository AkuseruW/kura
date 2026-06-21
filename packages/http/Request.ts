import type { SchemaLike } from "../validation/Schema";
import { parseRequestBody, type RequestBodyType } from "./Body";
import { createContext, type RequestFormData } from "./Server";

export class KuraRequest {
	private body: Record<string, unknown> = {};
	private bodyType: RequestBodyType | undefined;
	private query: Record<string, string> = {};
	private formData: RequestFormData | null = null;
	private rawBody: string | null = null;

	constructor(private request: Request) {
		const url = new URL(request.url);
		url.searchParams.forEach((value, key) => {
			this.query[key] = value;
		});
	}

	async parse(): Promise<void> {
		const ctx = createContext(this.request);
		await parseRequestBody(ctx);
		this.body = isRecord(ctx.body) ? ctx.body : {};
		this.bodyType = ctx.bodyType;
		this.formData = ctx.formData ?? null;
		this.rawBody = ctx.rawBody ?? null;
	}

	file(name: string): File | null {
		const file = this.formData?.get(name);
		return file instanceof File ? file : null;
	}

	files(name: string): File[] {
		const files = this.formData?.getAll(name) ?? [];
		return files.filter((f): f is File => f instanceof File);
	}

	header(name: string): string | null {
		return this.request.headers.get(name);
	}

	raw(): string | null {
		return this.rawBody;
	}

	type(): RequestBodyType | undefined {
		return this.bodyType;
	}

	input<T = unknown>(key: string): T | undefined;
	input<T>(key: string, defaultValue: T): T;
	input<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.body[key] ?? this.query[key];
		return value === undefined ? defaultValue : (value as T);
	}

	all(): Record<string, unknown> {
		return { ...this.query, ...this.body };
	}

	only(keys: string[]): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		const all = this.all();
		for (const key of keys) {
			if (key in all) {
				result[key] = all[key];
			}
		}
		return result;
	}

	except(keys: string[]): Record<string, unknown> {
		const result = this.all();
		for (const key of keys) {
			delete result[key];
		}
		return result;
	}

	validate<T>(schema: SchemaLike<T>): T {
		return schema.parse(this.all());
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

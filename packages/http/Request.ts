import type { Schema } from "../validator/Schema";
import { formDataToObject, parseRequestFormData } from "./Body";
import type { RequestFormData } from "./Server";

export class KuraRequest {
	private body: Record<string, unknown> = {};
	private query: Record<string, string> = {};
	private formData: RequestFormData | null = null;

	constructor(private request: Request) {
		const url = new URL(request.url);
		url.searchParams.forEach((value, key) => {
			this.query[key] = value;
		});
	}

	async parse(): Promise<void> {
		const contentType = this.request.headers.get("content-type");
		if (contentType?.includes("application/json")) {
			this.body = (await this.request.json()) as Record<string, unknown>;
		} else if (contentType?.includes("multipart/form-data")) {
			this.formData = await parseRequestFormData(this.request, contentType);
			this.body = formDataToObject(this.formData);
		} else if (contentType?.includes("application/x-www-form-urlencoded")) {
			this.formData = await parseRequestFormData(this.request, contentType);
			this.body = formDataToObject(this.formData);
		}
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

	input<T>(key: string, defaultValue?: T): T {
		return (this.body[key] ?? this.query[key] ?? defaultValue) as T;
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

	validate<T>(schema: Schema<T>): T {
		return schema.parse(this.all());
	}
}

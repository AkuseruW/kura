import type { Schema } from "../validator/Schema";

export class KuraRequest {
	private body: Record<string, any> = {};
	private query: Record<string, string> = {};
	private formData: FormData | null = null;

	constructor(private request: Request) {
		const url = new URL(request.url);
		url.searchParams.forEach((value, key) => {
			this.query[key] = value;
		});
	}

	async parse(): Promise<void> {
		const contentType = this.request.headers.get("content-type");
		if (contentType?.includes("application/json")) {
			this.body = (await this.request.json()) as Record<string, any>;
		} else if (contentType?.includes("multipart/form-data")) {
			this.formData = (await this.request.formData()) as unknown as FormData;
		} else if (contentType?.includes("application/x-www-form-urlencoded")) {
			const text = await this.request.text();
			const params = new URLSearchParams(text);
			params.forEach((value, key) => {
				this.body[key] = value;
			});
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
		return this.body[key] ?? this.query[key] ?? defaultValue;
	}

	all(): Record<string, any> {
		return { ...this.query, ...this.body };
	}

	only(keys: string[]): Record<string, any> {
		const result: Record<string, any> = {};
		const all = this.all();
		for (const key of keys) {
			if (key in all) {
				result[key] = all[key];
			}
		}
		return result;
	}

	except(keys: string[]): Record<string, any> {
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

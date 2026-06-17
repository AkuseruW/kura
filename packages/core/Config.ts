import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export class Config {
	private items: Record<string, unknown> = {};

	constructor(items: Record<string, unknown> = {}) {
		this.items = items;
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		const parts = key.split(".");
		let result: unknown = this.items;

		for (const part of parts) {
			if (!isRecord(result)) {
				return defaultValue;
			}
			result = result[part];
		}

		return (result as T | undefined) ?? defaultValue;
	}

	set(key: string, value: unknown): void {
		const parts = key.split(".");
		const lastKey = parts.pop();
		if (!lastKey) {
			throw new Error("Config key cannot be empty");
		}
		let current = this.items;

		for (const part of parts) {
			if (!isRecord(current[part])) {
				current[part] = {};
			}
			current = current[part] as Record<string, unknown>;
		}

		current[lastKey] = value;
	}

	has(key: string): boolean {
		const parts = key.split(".");
		let result: unknown = this.items;

		for (const part of parts) {
			if (!isRecord(result)) {
				return false;
			}
			if (result[part] === undefined) {
				return false;
			}
			result = result[part];
		}

		return true;
	}

	all(): Record<string, unknown> {
		return { ...this.items };
	}

	async load(path: string): Promise<void> {
		const glob = new Bun.Glob("*.ts");

		for await (const file of glob.scan(path)) {
			const name = file.replace(".ts", "");
			const modulePath = pathToFileURL(resolve(path, file)).href;
			const module = await import(modulePath);
			this.items[name] = module.default;
		}
	}
}

export function defineConfig<T>(config: T): T {
	return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

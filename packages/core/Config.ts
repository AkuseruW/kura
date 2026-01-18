export class Config {
	private items: Record<string, any> = {};

	constructor(items: Record<string, any> = {}) {
		this.items = items;
	}

	get<T>(key: string, defaultValue?: T): T {
		const parts = key.split(".");
		let result: any = this.items;

		for (const part of parts) {
			result = result[part];
		}

		return result ?? defaultValue;
	}

	set(key: string, value: any): void {
		const parts = key.split(".");
		const lastKey = parts.pop()!;
		let current = this.items;

		for (const part of parts) {
			if (!current[part]) {
				current[part] = {};
			}
			current = current[part];
		}

		current[lastKey] = value;
	}

	has(key: string): boolean {
		const parts = key.split(".");
		let result: any = this.items;

		for (const part of parts) {
			if (result[part] === undefined) {
				return false;
			}
			result = result[part];
		}

		return true;
	}

	async load(path: string): Promise<void> {
		const glob = new Bun.Glob("*.ts");

		for await (const file of glob.scan(path)) {
			const name = file.replace(".ts", "");
			const module = await import(`${path}/${file}.ts`);
			this.items[name] = module.default;
		}
	}
}

export function defineConfig<T>(config: T): T {
	return config;
}

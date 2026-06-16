export class Env {
	get<T>(key: string, defaultValue: T): T {
		return (process.env[key] as unknown as T) ?? defaultValue;
	}

	number(key: string, defaultValue?: number): number | undefined {
		const value = process.env[key];
		return value ? Number(value) : defaultValue;
	}

	boolean(key: string, defaultValue?: boolean): boolean | undefined {
		const value = process.env[key];
		return value ? value === "true" : defaultValue;
	}

	required(key: string): string {
		const value = process.env[key];
		if (!value) {
			throw new Error(`Missing environment variable: ${key}`);
		}
		return value;
	}

	async load(path: string): Promise<void> {
		const file = Bun.file(path);
		const content = await file.text();

		for (const line of content.split("\n")) {
			const [key, ...values] = line.split("=");
			if (key && values.length) {
				process.env[key.trim()] = values.join("=").trim();
			}
		}
	}
}

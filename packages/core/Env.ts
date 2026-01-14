export class Env {
	get<T>(key: string, defaultValue: T): T {
		return process.env[key] as unknown as T ?? defaultValue
	}

	async load(path: string): Promise<void> {
		const file = Bun.file(path)
		const content = await file.text()

		for (const line of content.split('\n')) {
			const [key, ...values] = line.split('=')
			if (key && values.length) {
				process.env[key.trim()] = values.join('=').trim()
			}
		}
	}
}

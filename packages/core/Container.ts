export class Container {
	private bindings = new Map<string, () => unknown>();
	private singletons = new Map<string, unknown>();
	private aliases = new Map<string, string>();

	bind<T>(key: string, factory: () => T) {
		this.aliases.delete(key);
		this.bindings.set(key, factory);
	}

	singleton<T>(key: string, factory: () => T) {
		this.bind(key, () => {
			if (!this.singletons.has(key)) {
				this.singletons.set(key, factory());
			}
			return this.singletons.get(key) as T;
		});
	}

	alias(aliasKey: string, targetKey: string): void {
		this.aliases.set(aliasKey, targetKey);
	}

	make<T>(key: string): T {
		return this.resolve<T>(key);
	}

	resolve<T>(key: string): T {
		const resolvedKey = this.resolveAlias(key);
		const factory = this.bindings.get(resolvedKey);
		if (!factory) {
			throw new Error(`No binding found for ${key}`);
		}
		return factory() as T;
	}

	private resolveAlias(key: string, seen = new Set<string>()): string {
		const target = this.aliases.get(key);
		if (!target) {
			return key;
		}
		if (seen.has(key)) {
			throw new Error(`Circular alias detected for ${key}`);
		}
		seen.add(key);
		return this.resolveAlias(target, seen);
	}
}

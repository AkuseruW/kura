export class Container {
	private bindings = new Map<string, () => any>();
	private singletons = new Map<string, any>();

	bind(key: string, factory: () => any) {
		this.bindings.set(key, factory);
	}

	singleton(key: string, factory: () => any) {
		this.bind(key, () => {
			if (!this.singletons.has(key)) {
				this.singletons.set(key, factory());
			}
			return this.singletons.get(key);
		});
	}

	resolve<T>(key: string): T {
		const factory = this.bindings.get(key);
		if (!factory) {
			throw new Error(`No binding found for ${key}`);
		}
		return factory();
	}
}

export class Event<TPayload = unknown> {
	constructor(
		public readonly name: string,
		public readonly payload: TPayload,
	) {}
}

export type Listener<TPayload = unknown> = (
	event: Event<TPayload>,
) => void | Promise<void>;

export class Emitter<TPayload = unknown> {
	private listeners = new Map<string, Set<Listener<TPayload>>>();

	on(eventName: string, listener: Listener<TPayload>): () => void {
		const listeners = this.listeners.get(eventName) ?? new Set();

		listeners.add(listener);
		this.listeners.set(eventName, listeners);

		return () => this.off(eventName, listener);
	}

	off(eventName: string, listener: Listener<TPayload>): void {
		const listeners = this.listeners.get(eventName);

		if (!listeners) {
			return;
		}

		listeners.delete(listener);

		if (listeners.size === 0) {
			this.listeners.delete(eventName);
		}
	}

	async emit(event: Event<TPayload>): Promise<void> {
		const listeners = this.listeners.get(event.name);

		if (!listeners) {
			return;
		}

		for (const listener of [...listeners]) {
			await listener(event);
		}
	}
}

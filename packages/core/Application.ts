import { Config } from "./Config";
import { Container } from "./Container";
import { Env } from "./Env";
import { Emitter, Event, type Listener } from "./Event";
import type { ServiceProvider } from "./ServiceProvider";

export type AppState =
	| "created"
	| "registered"
	| "booted"
	| "ready"
	| "shutdown";

export type ApplicationLifecycleEventName =
	| "app.registered"
	| "app.booted"
	| "app.ready"
	| "app.shutting_down"
	| "app.shutdown";

export type ApplicationLifecycleEventPayload = {
	app: Application;
	state: AppState;
};

export class Application {
	private state: AppState = "created";
	private providers: ServiceProvider[] = [];

	public container: Container;
	public config: Config;
	public env: Env;
	public events: Emitter<ApplicationLifecycleEventPayload>;

	constructor() {
		this.container = new Container();
		this.config = new Config();
		this.env = new Env();
		this.events = new Emitter();
	}

	register(provider: ServiceProvider): void {
		this.providers.push(provider);
	}

	on(
		eventName: ApplicationLifecycleEventName,
		listener: Listener<ApplicationLifecycleEventPayload>,
	): () => void {
		return this.events.on(eventName, listener);
	}

	async boot(): Promise<void> {
		this.state = "registered";

		for (const provider of this.providers) {
			await provider.register();
		}
		await this.emitLifecycle("app.registered");

		this.state = "booted";

		for (const provider of this.providers) {
			if (provider.boot) {
				await provider.boot();
			}
		}
		await this.emitLifecycle("app.booted");

		this.state = "ready";
		await this.emitLifecycle("app.ready");
	}

	getState(): AppState {
		return this.state;
	}

	async shutdown(): Promise<void> {
		this.state = "shutdown";
		await this.emitLifecycle("app.shutting_down");

		for (const provider of this.providers) {
			if (provider.shutdown) {
				await provider.shutdown();
			}
		}
		await this.emitLifecycle("app.shutdown");
	}

	listen(): void {
		process.on("SIGTERM", async () => {
			await this.shutdown();
			process.exit(0);
		});

		process.on("SIGINT", async () => {
			await this.shutdown();
			process.exit(0);
		});
	}

	private async emitLifecycle(
		eventName: ApplicationLifecycleEventName,
	): Promise<void> {
		await this.events.emit(
			new Event(eventName, {
				app: this,
				state: this.state,
			}),
		);
	}
}

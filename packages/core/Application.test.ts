import { describe, expect, test } from "bun:test";
import {
	Application,
	type ApplicationLifecycleEventPayload,
	type AppState,
} from "./Application";
import type { Event } from "./Event";
import { ServiceProvider } from "./ServiceProvider";

class RecordingProvider extends ServiceProvider {
	constructor(
		app: Application,
		private readonly calls: string[],
	) {
		super(app);
	}

	register(): void {
		this.calls.push("provider.register");
	}

	override boot(): void {
		this.calls.push("provider.boot");
	}

	override shutdown(): void {
		this.calls.push("provider.shutdown");
	}
}

describe("Application", () => {
	test("emits lifecycle events during boot", async () => {
		const app = new Application();
		const calls: string[] = [];
		const events: Array<{ name: string; sameApp: boolean; state: AppState }> =
			[];
		const capture = (event: Event<ApplicationLifecycleEventPayload>) => {
			calls.push(`event.${event.name}`);
			events.push({
				name: event.name,
				sameApp: event.payload.app === app,
				state: event.payload.state,
			});
		};

		app.on("app.registered", capture);
		app.on("app.booted", capture);
		app.on("app.ready", capture);
		app.register(new RecordingProvider(app, calls));

		await app.boot();

		expect(calls).toEqual([
			"provider.register",
			"event.app.registered",
			"provider.boot",
			"event.app.booted",
			"event.app.ready",
		]);
		expect(events).toEqual([
			{ name: "app.registered", sameApp: true, state: "registered" },
			{ name: "app.booted", sameApp: true, state: "booted" },
			{ name: "app.ready", sameApp: true, state: "ready" },
		]);
		expect(app.getState()).toBe("ready");
	});

	test("emits lifecycle events during shutdown", async () => {
		const app = new Application();
		const calls: string[] = [];
		const states: AppState[] = [];

		app.on("app.shutting_down", (event) => {
			calls.push(`event.${event.name}`);
			states.push(event.payload.state);
		});
		app.on("app.shutdown", (event) => {
			calls.push(`event.${event.name}`);
			states.push(event.payload.state);
		});
		app.register(new RecordingProvider(app, calls));

		await app.shutdown();

		expect(calls).toEqual([
			"event.app.shutting_down",
			"provider.shutdown",
			"event.app.shutdown",
		]);
		expect(states).toEqual(["shutdown", "shutdown"]);
		expect(app.getState()).toBe("shutdown");
	});
});

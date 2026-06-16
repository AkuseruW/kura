import type { Application } from "./Application";

export abstract class ServiceProvider {
	constructor(protected app: Application) {}

	abstract register(): void | Promise<void>;

	boot?(): void | Promise<void>;

	shutdown?(): void | Promise<void>;
}

import type { Middleware } from "./Middleware";
import type { Context } from "./Server";

export type ControllerAction = (ctx: Context) => Response | Promise<Response>;

export abstract class BaseController {
	static middleware: Middleware[] = [];
	static middlewareFor: Record<string, Middleware[]> = {};

	protected ctx!: Context;

	setContext(ctx: Context): void {
		this.ctx = ctx;
	}
}

export type ControllerConstructor = (new () => BaseController) & {
	middleware?: Middleware[];
	middlewareFor?: Record<string, Middleware[]>;
};

const controllers: Map<string, ControllerConstructor> = new Map();

export function registerController(
	name: string,
	controller: ControllerConstructor,
): void {
	controllers.set(name, controller);
}

export function resolveController(name: string): ControllerConstructor {
	const controller = controllers.get(name);
	if (!controller) {
		throw new Error(`Controller [${name}] not found`);
	}
	return controller;
}

export function getControllerMiddleware(
	controller: ControllerConstructor,
	action: string,
): Middleware[] {
	const globalMiddleware = controller.middleware ?? [];
	const actionMiddleware = controller.middlewareFor?.[action] ?? [];
	return [...globalMiddleware, ...actionMiddleware];
}

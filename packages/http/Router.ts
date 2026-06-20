import type { Schema } from "../validation/Schema";
import { ensureContext } from "./Context";
import {
	type ControllerConstructor,
	getControllerMiddleware,
	resolveController,
} from "./Controller";
import type { Middleware } from "./Middleware";
import { applyMiddlewares } from "./MiddlewareStack";
import type { RouteOpenApiOptions } from "./OpenApi";
import { KuraResponse } from "./Response";
import { escapeRegex, joinPaths, normalizePath } from "./RoutePath";

export {
	type RouteValidationErrorDetails,
	RouteValidationException,
} from "./RouteValidation";

import { validateRouteRequest } from "./RouteValidation";
import type { Context, ContextCore } from "./Server";

export type RouteHandler = (ctx: Context) => Response | Promise<Response>;
export type RouteSchemaOptions = {
	readonly params?: Schema<unknown>;
	readonly query?: Schema<unknown>;
	readonly headers?: Schema<unknown>;
	readonly cookies?: Schema<unknown>;
	readonly body?: Schema<unknown>;
	readonly responses?: Record<string | number, Schema<unknown>>;
};
export type RegisteredRoute = {
	readonly method: string;
	readonly path: string;
	readonly name?: string;
	readonly params: readonly string[];
	readonly schema?: RouteSchemaOptions;
	readonly openapi?: RouteOpenApiOptions;
};

export type ResourceController = {
	index?: RouteHandler;
	show?: RouteHandler;
	store?: RouteHandler;
	update?: RouteHandler;
	destroy?: RouteHandler;
};

export type ResourceAction = "index" | "show" | "store" | "update" | "destroy";
type ResourceControllerInput = ResourceController | string;

export type Route = {
	method: string;
	path: string;
	name?: string;
	pattern: RegExp;
	params: string[];
	handler: RouteHandler;
	schema?: RouteSchemaOptions;
	openapi?: RouteOpenApiOptions;
};

export class Router {
	private routes: Route[] = [];
	private exactRoutes: Map<string, Map<string, Route>> = new Map();
	private dynamicRoutes: Map<string, Route[]> = new Map();
	private namedRoutes: Map<string, string> = new Map();

	private addRoute(
		method: string,
		path: string,
		handler: RouteHandler,
	): RouteBuilder {
		const { pattern, params } = this.pathToRegex(path);
		const route = { method, path, pattern, params, handler };
		this.routes.push(route);
		this.indexRoute(route);
		return new RouteBuilder(this.namedRoutes, route);
	}

	route(name: string, params: Record<string, string | number> = {}): string {
		const path = this.namedRoutes.get(name);
		if (!path) {
			throw new Error(`Route [${name}] not found`);
		}
		return path.replace(/:(\w+)/g, (_, key) => {
			if (!(key in params)) {
				throw new Error(`Missing route parameter [${key}] for route [${name}]`);
			}
			return String(params[key]);
		});
	}

	private pathToRegex(path: string): { pattern: RegExp; params: string[] } {
		const params: string[] = [];
		const escapedPath = escapeRegex(path);
		const pattern = escapedPath.replace(/:(\w+)/g, (_, name) => {
			params.push(name);
			return "([^/]+)";
		});
		return { pattern: new RegExp(`^${pattern}$`), params };
	}

	get(path: string, handler: RouteHandler): RouteBuilder {
		return this.addRoute("GET", path, handler);
	}

	post(path: string, handler: RouteHandler): RouteBuilder {
		return this.addRoute("POST", path, handler);
	}

	put(path: string, handler: RouteHandler): RouteBuilder {
		return this.addRoute("PUT", path, handler);
	}

	patch(path: string, handler: RouteHandler): RouteBuilder {
		return this.addRoute("PATCH", path, handler);
	}

	delete(path: string, handler: RouteHandler): RouteBuilder {
		return this.addRoute("DELETE", path, handler);
	}

	match(
		method: string,
		path: string,
	): { handler: RouteHandler; params: Record<string, string> } | null {
		const match = this.matchRoute(method, path);

		return match
			? { handler: match.route.handler, params: match.params }
			: null;
	}

	async dispatch(ctx: Context | ContextCore): Promise<Response> {
		const context = ensureContext(ctx);
		const url = new URL(context.request.url);
		const match = this.matchRoute(context.request.method, url.pathname);

		if (!match) {
			return KuraResponse.notFound();
		}

		context.params = match.params;
		await validateRouteRequest(match.route, context, match.params, url);
		return match.route.handler(context);
	}

	private matchRoute(
		method: string,
		path: string,
	): { route: Route; params: Record<string, string> } | null {
		const exactRoute = this.exactRoutes.get(method)?.get(path);
		if (exactRoute) {
			return { route: exactRoute, params: {} };
		}

		for (const route of this.dynamicRoutes.get(method) ?? []) {
			const match = path.match(route.pattern);
			if (match) {
				const params: Record<string, string> = {};
				route.params.forEach((name, i) => {
					params[name] = match[i + 1] ?? "";
				});
				return { route, params };
			}
		}
		return null;
	}

	list(): readonly RegisteredRoute[] {
		return this.routes.map((route) => {
			const registeredRoute: RegisteredRoute = {
				method: route.method,
				path: route.path,
				name: route.name,
				params: [...route.params],
			};
			const routeWithSchema = route.schema
				? { ...registeredRoute, schema: route.schema }
				: registeredRoute;

			return route.openapi
				? { ...routeWithSchema, openapi: route.openapi }
				: routeWithSchema;
		});
	}

	resource(name: string, controller: ResourceControllerInput): ResourceBuilder {
		return new ResourceBuilder(this, name, controller);
	}

	group(): GroupBuilder {
		return new GroupBuilder(this);
	}

	private indexRoute(route: Route): void {
		if (route.params.length === 0) {
			const routes = this.exactRoutes.get(route.method) ?? new Map();
			if (!this.exactRoutes.has(route.method)) {
				this.exactRoutes.set(route.method, routes);
			}
			if (!routes.has(route.path)) {
				routes.set(route.path, route);
			}
			return;
		}

		const routes = this.dynamicRoutes.get(route.method) ?? [];
		if (!this.dynamicRoutes.has(route.method)) {
			this.dynamicRoutes.set(route.method, routes);
		}
		routes.push(route);
	}
}

class RouteBuilder {
	constructor(
		private namedRoutes: Map<string, string>,
		private route: Route,
	) {}

	as(name: string): this {
		this.route.name = name;
		this.namedRoutes.set(name, this.route.path);
		return this;
	}

	openapi(options: RouteOpenApiOptions): this {
		this.route.openapi = options;
		return this;
	}

	schema(options: RouteSchemaOptions): this {
		this.route.schema = mergeRouteSchemas(this.route.schema, options);
		return this;
	}
}

class ResourceBuilder {
	private actions: ResourceAction[] = [
		"index",
		"show",
		"store",
		"update",
		"destroy",
	];

	constructor(
		private router: Router,
		private name: string,
		private controller: ResourceControllerInput,
	) {}

	only(actions: ResourceAction[]): this {
		this.actions = actions;
		return this;
	}

	except(actions: ResourceAction[]): this {
		this.actions = this.actions.filter((a) => !actions.includes(a));
		return this;
	}

	register(): void {
		const basePath = normalizePath(this.name);
		const paramPath = joinPaths(basePath, ":id");

		const index = this.resolveHandler("index");
		if (this.actions.includes("index") && index) {
			this.router.get(basePath, index);
		}
		const show = this.resolveHandler("show");
		if (this.actions.includes("show") && show) {
			this.router.get(paramPath, show);
		}
		const store = this.resolveHandler("store");
		if (this.actions.includes("store") && store) {
			this.router.post(basePath, store);
		}
		const update = this.resolveHandler("update");
		if (this.actions.includes("update") && update) {
			this.router.put(paramPath, update);
		}
		const destroy = this.resolveHandler("destroy");
		if (this.actions.includes("destroy") && destroy) {
			this.router.delete(paramPath, destroy);
		}
	}

	private resolveHandler(action: ResourceAction): RouteHandler | null {
		if (typeof this.controller !== "string") {
			return this.controller[action] ?? null;
		}

		const Controller = resolveController(this.controller);
		const method = (Controller.prototype as Record<string, unknown>)[action];
		if (typeof method !== "function") {
			return null;
		}

		const handler: RouteHandler = async (ctx) => {
			const instance = new Controller();
			instance.setContext(ctx);
			return method.call(instance, ctx) as Response | Promise<Response>;
		};

		return applyMiddlewares(
			handler,
			getControllerMiddleware(Controller as ControllerConstructor, action),
		);
	}
}

class GroupBuilder {
	private _prefix: string = "";
	private _middlewares: Middleware[] = [];
	private _namePrefix: string = "";

	constructor(private router: Router) {}

	prefix(prefix: string): this {
		this._prefix = normalizePath(prefix);
		return this;
	}

	middleware(middleware: Middleware): this {
		this._middlewares.push(middleware);
		return this;
	}

	as(namePrefix: string): this {
		this._namePrefix = namePrefix;
		return this;
	}

	routes(callback: (router: GroupRouter) => void): void {
		const groupRouter = new GroupRouter(
			this.router,
			this._prefix,
			this._middlewares,
			this._namePrefix,
		);
		callback(groupRouter);
	}
}

class GroupRouter {
	constructor(
		private router: Router,
		private prefix: string,
		private middlewares: Middleware[],
		private namePrefix: string,
	) {}

	private wrapHandler(handler: RouteHandler): RouteHandler {
		return applyMiddlewares(handler, this.middlewares);
	}

	get(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.get(
			joinPaths(this.prefix, path),
			this.wrapHandler(handler),
		);
		return new GroupRouteBuilder(routeBuilder, this.namePrefix);
	}

	post(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.post(
			joinPaths(this.prefix, path),
			this.wrapHandler(handler),
		);
		return new GroupRouteBuilder(routeBuilder, this.namePrefix);
	}

	put(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.put(
			joinPaths(this.prefix, path),
			this.wrapHandler(handler),
		);
		return new GroupRouteBuilder(routeBuilder, this.namePrefix);
	}

	patch(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.patch(
			joinPaths(this.prefix, path),
			this.wrapHandler(handler),
		);
		return new GroupRouteBuilder(routeBuilder, this.namePrefix);
	}

	delete(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.delete(
			joinPaths(this.prefix, path),
			this.wrapHandler(handler),
		);
		return new GroupRouteBuilder(routeBuilder, this.namePrefix);
	}
}

class GroupRouteBuilder {
	constructor(
		private routeBuilder: RouteBuilder,
		private namePrefix: string,
	) {}

	as(name: string): this {
		this.routeBuilder.as(this.namePrefix + name);
		return this;
	}

	openapi(options: RouteOpenApiOptions): this {
		this.routeBuilder.openapi(options);
		return this;
	}

	schema(options: RouteSchemaOptions): this {
		this.routeBuilder.schema(options);
		return this;
	}
}

function mergeRouteSchemas(
	current: RouteSchemaOptions | undefined,
	next: RouteSchemaOptions,
): RouteSchemaOptions {
	return {
		...current,
		...next,
		responses: {
			...(current?.responses ?? {}),
			...(next.responses ?? {}),
		},
	};
}

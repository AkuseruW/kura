import type { Context } from "./Server";

type RouteHandler = (ctx: Context) => Response | Promise<Response>;
type Middleware = (
	ctx: Context,
	next: () => Promise<Response>,
) => Response | Promise<Response>;

type ResourceController = {
	index?: RouteHandler;
	show?: RouteHandler;
	store?: RouteHandler;
	update?: RouteHandler;
	destroy?: RouteHandler;
};

type ResourceAction = "index" | "show" | "store" | "update" | "destroy";

type Route = {
	method: string;
	path: string;
	pattern: RegExp;
	params: string[];
	handler: RouteHandler;
};

export class Router {
	private routes: Route[] = [];
	private namedRoutes: Map<string, string> = new Map();

	private addRoute(
		method: string,
		path: string,
		handler: RouteHandler,
	): RouteBuilder {
		const { pattern, params } = this.pathToRegex(path);
		this.routes.push({ method, path, pattern, params, handler });
		return new RouteBuilder(this.namedRoutes, path);
	}

	route(name: string, params: Record<string, string | number> = {}): string {
		const path = this.namedRoutes.get(name);
		if (!path) {
			throw new Error(`Route [${name}] not found`);
		}
		return path.replace(/:(\w+)/g, (_, key) => String(params[key] ?? ""));
	}

	private pathToRegex(path: string): { pattern: RegExp; params: string[] } {
		const params: string[] = [];
		const pattern = path.replace(/:(\w+)/g, (_, name) => {
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
		for (const route of this.routes) {
			if (route.method !== method) continue;
			const match = path.match(route.pattern);
			if (match) {
				const params: Record<string, string> = {};
				route.params.forEach((name, i) => {
					params[name] = match[i + 1] ?? "";
				});
				return { handler: route.handler, params };
			}
		}
		return null;
	}

	resource(name: string, controller: ResourceController): ResourceBuilder {
		return new ResourceBuilder(this, name, controller);
	}

	group(): GroupBuilder {
		return new GroupBuilder(this);
	}
}

class RouteBuilder {
	constructor(
		private namedRoutes: Map<string, string>,
		private path: string,
	) {}

	as(name: string): void {
		this.namedRoutes.set(name, this.path);
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
		private controller: ResourceController,
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
		const basePath = `/${this.name}`;
		const paramPath = `/${this.name}/:id`;

		if (this.actions.includes("index") && this.controller.index) {
			this.router.get(basePath, this.controller.index);
		}
		if (this.actions.includes("show") && this.controller.show) {
			this.router.get(paramPath, this.controller.show);
		}
		if (this.actions.includes("store") && this.controller.store) {
			this.router.post(basePath, this.controller.store);
		}
		if (this.actions.includes("update") && this.controller.update) {
			this.router.put(paramPath, this.controller.update);
		}
		if (this.actions.includes("destroy") && this.controller.destroy) {
			this.router.delete(paramPath, this.controller.destroy);
		}
	}
}

class GroupBuilder {
	private _prefix: string = "";
	private _middlewares: Middleware[] = [];
	private _namePrefix: string = "";

	constructor(private router: Router) {}

	prefix(prefix: string): this {
		this._prefix = prefix;
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
		if (this.middlewares.length === 0) {
			return handler;
		}
		return async (ctx: Context) => {
			let index = 0;
			const next = async (): Promise<Response> => {
				const middleware = this.middlewares[index++];
				if (middleware) {
					return middleware(ctx, next);
				}
				return handler(ctx);
			};
			return next();
		};
	}

	get(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.get(
			this.prefix + path,
			this.wrapHandler(handler),
		);
		return new GroupRouteBuilder(routeBuilder, this.namePrefix);
	}

	post(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.post(
			this.prefix + path,
			this.wrapHandler(handler),
		);
		return new GroupRouteBuilder(routeBuilder, this.namePrefix);
	}

	put(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.put(
			this.prefix + path,
			this.wrapHandler(handler),
		);
		return new GroupRouteBuilder(routeBuilder, this.namePrefix);
	}

	patch(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.patch(
			this.prefix + path,
			this.wrapHandler(handler),
		);
		return new GroupRouteBuilder(routeBuilder, this.namePrefix);
	}

	delete(path: string, handler: RouteHandler): GroupRouteBuilder {
		const routeBuilder = this.router.delete(
			this.prefix + path,
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

	as(name: string): void {
		this.routeBuilder.as(this.namePrefix + name);
	}
}

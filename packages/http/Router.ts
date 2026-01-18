import type { Context } from "./Server";

type RouteHandler = (ctx: Context) => Response | Promise<Response>;

type Route = {
	method: string;
	path: string;
	pattern: RegExp;
	params: string[];
	handler: RouteHandler;
};

export class Router {
	private routes: Route[] = [];

	private addRoute(method: string, path: string, handler: RouteHandler): void {
		const { pattern, params } = this.pathToRegex(path);
		this.routes.push({ method, path, pattern, params, handler });
	}

	private pathToRegex(path: string): { pattern: RegExp; params: string[] } {
		const params: string[] = [];
		const pattern = path.replace(/:(\w+)/g, (_, name) => {
			params.push(name);
			return "([^/]+)";
		});
		return { pattern: new RegExp(`^${pattern}$`), params };
	}

	get(path: string, handler: RouteHandler): void {
		this.addRoute("GET", path, handler);
	}

	post(path: string, handler: RouteHandler): void {
		this.addRoute("POST", path, handler);
	}

	put(path: string, handler: RouteHandler): void {
		this.addRoute("PUT", path, handler);
	}

	patch(path: string, handler: RouteHandler): void {
		this.addRoute("PATCH", path, handler);
	}

	delete(path: string, handler: RouteHandler): void {
		this.addRoute("DELETE", path, handler);
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
}

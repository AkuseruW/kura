import type { Serve } from "bun";
import { BaseException } from "../core/BaseException";
import type { Router } from "./Router";

export type RequestFormData = Awaited<
	ReturnType<typeof Bun.readableStreamToFormData>
>;
export type RequestFormDataEntry = NonNullable<
	ReturnType<RequestFormData["get"]>
>;

export type Context = {
	request: Request;
	params?: Record<string, string>;
	body?: unknown;
	formData?: RequestFormData;
	requestId?: string;
	auth?: {
		guard: string;
		user?: unknown;
		sessionId?: string;
		token?: string;
		claims?: Record<string, unknown>;
	};
};

type Handler = (ctx: Context) => Response | Promise<Response>;

export type BunStaticRouteMap = Serve.Routes<undefined, string>;

export type BunDevelopmentOptions = Serve.Development;

export type ServerOptions = {
	readonly port: number;
	readonly hostname?: string;
	readonly staticRoutes?: BunStaticRouteMap;
	readonly development?: BunDevelopmentOptions;
};

export class Server {
	private server: ReturnType<typeof Bun.serve> | null = null;
	private handler: Handler = () => new Response("Not Found", { status: 404 });
	private staticRoutes: BunStaticRouteMap | undefined;

	constructor(private options: ServerOptions) {
		this.staticRoutes = options.staticRoutes;
	}

	setHandler(handler: Handler): void {
		this.handler = handler;
	}

	setStaticRoutes(routes: BunStaticRouteMap): void {
		this.staticRoutes = routes;
	}

	setRouter(router: Router): void {
		this.handler = async (ctx) => {
			const url = new URL(ctx.request.url);
			const match = router.match(ctx.request.method, url.pathname);
			if (!match) {
				return new Response("Not Found", { status: 404 });
			}

			ctx.params = match.params;
			return match.handler(ctx);
		};
	}

	start(): void {
		const options = {
			hostname: this.options.hostname,
			port: this.options.port,
			routes: this.staticRoutes,
			development: this.options.development,
			fetch: async (request) => {
				try {
					const ctx: Context = { request };
					return await this.handler(ctx);
				} catch (error) {
					if (error instanceof BaseException) {
						return new Response(
							JSON.stringify({ code: error.code, error: error.message }),
							{
								status: error.status,
								headers: { "Content-Type": "application/json" },
							},
						);
					}
					return new Response("Internal Server Error", { status: 500 });
				}
			},
		} satisfies Serve.Options<undefined, string>;

		this.server = Bun.serve(options);
	}

	stop(): void {
		this.server?.stop();
	}
}

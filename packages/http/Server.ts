import type { Serve } from "bun";
import { BaseException } from "../core/BaseException";
import { KuraResponse } from "./Response";
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
	validated?: ValidatedRouteData;
	requestId?: string;
	auth?: {
		guard: string;
		user?: unknown;
		sessionId?: string;
		token?: string;
		claims?: Record<string, unknown>;
	};
};

export type ValidatedRouteData = {
	params?: unknown;
	query?: unknown;
	headers?: unknown;
	cookies?: unknown;
	body?: unknown;
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
	private handler: Handler = () => KuraResponse.notFound();
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
		this.handler = (ctx) => router.dispatch(ctx);
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
						return KuraResponse.exception(error);
					}
					return KuraResponse.internalServerError();
				}
			},
		} satisfies Serve.Options<undefined, string>;

		this.server = Bun.serve(options);
	}

	stop(): void {
		this.server?.stop();
	}
}

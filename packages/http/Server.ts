import type { Serve } from "bun";
import { type Context, createContext } from "./Context";
import {
	type HttpErrorHandler,
	type HttpErrorHandlerInput,
	resolveHttpErrorHandler,
} from "./ErrorHandler";
import { KuraResponse } from "./Response";
import type { Router } from "./Router";

export type {
	AuthContext,
	Context,
	ContextCore,
	ContextInit,
	ContextState,
	RequestFormData,
	RequestFormDataEntry,
	ValidatedRouteData,
} from "./Context";
export { createContext, ensureContext } from "./Context";

type Handler = (ctx: Context) => Response | Promise<Response>;

export type BunStaticRouteMap = Serve.Routes<undefined, string>;

export type BunDevelopmentOptions = Serve.Development;

export type BunServerTlsOptions = Bun.TLSOptions | Bun.TLSOptions[];

type BunProtocolOptions = {
	readonly http1?: boolean;
	readonly http3?: boolean;
	readonly tls?: BunServerTlsOptions;
};

type KuraServeOptions = Serve.Options<undefined, string> & BunProtocolOptions;

export type ServerOptions = {
	readonly port: number;
	readonly hostname?: string;
	readonly staticRoutes?: BunStaticRouteMap;
	readonly development?: BunDevelopmentOptions;
	readonly environment?: string;
	readonly errorHandler?: HttpErrorHandlerInput;
	readonly http1?: boolean;
	readonly http3?: boolean;
	readonly tls?: BunServerTlsOptions;
};

export class Server {
	private server: ReturnType<typeof Bun.serve> | null = null;
	private handler: Handler = () => KuraResponse.notFound();
	private readonly errorHandler: HttpErrorHandler;
	private staticRoutes: BunStaticRouteMap | undefined;

	constructor(private options: ServerOptions) {
		this.staticRoutes = options.staticRoutes;
		this.errorHandler = resolveHttpErrorHandler(options.errorHandler, {
			debug: options.environment === "development",
		});
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
		const protocol = resolveProtocolOptions(this.options);
		const options: KuraServeOptions = {
			hostname: this.options.hostname,
			port: this.options.port,
			routes: this.staticRoutes,
			development: this.options.development,
			...protocol,
			fetch: async (request) => {
				let ctx: Context | undefined;
				try {
					ctx = createContext(request);
					return await this.handler(ctx);
				} catch (error) {
					return this.errorHandler(error, {
						context: ctx,
						environment: this.options.environment,
						request,
					});
				}
			},
		} satisfies Serve.Options<undefined, string>;

		this.server = Bun.serve(options);
	}

	stop(): void {
		this.server?.stop();
	}
}

function resolveProtocolOptions(options: ServerOptions): BunProtocolOptions {
	if (options.http3 === true && options.tls === undefined) {
		throw new Error("HTTP/3 requires TLS. Provide tls when http3 is enabled.");
	}

	if (options.http1 === false && options.http3 !== true) {
		throw new Error("Disabling HTTP/1 requires HTTP/3 to be enabled.");
	}

	return {
		http1: options.http1,
		http3: options.http3,
		tls: options.tls,
	};
}

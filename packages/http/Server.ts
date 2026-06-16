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

export class Server {
	private server: ReturnType<typeof Bun.serve> | null = null;
	private handler: Handler = () => new Response("Not Found", { status: 404 });

	constructor(private options: { port: number }) {}

	setHandler(handler: Handler): void {
		this.handler = handler;
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
		this.server = Bun.serve({
			port: this.options.port,
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
		});
	}

	stop(): void {
		this.server?.stop();
	}
}

import type { Context } from "./Server";

export type Middleware = (
	ctx: Context,
	next: () => Promise<Response>,
) => Response | Promise<Response>;

export class MiddlewarePipeline {
	private middlewares: Middleware[] = [];

	use(middleware: Middleware): this {
		this.middlewares.push(middleware);
		return this;
	}

	async run(ctx: Context, handler: () => Promise<Response>): Promise<Response> {
		let index = 0;
		const next = async (): Promise<Response> => {
			const middleware = this.middlewares[index++];
			if (middleware) {
				return middleware(ctx, next);
			}
			return handler();
		};
		return next();
	}
}

export const BodyParser: Middleware = async (ctx, next) => {
	const contentType = ctx.request.headers.get("content-type");
	if (contentType?.includes("application/json")) {
		ctx.body = await ctx.request.json();
	}
	return next();
};

export const Cors = (
	options: { origin?: string; methods?: string[] } = {},
): Middleware => {
	const origin = options.origin ?? "*";
	const methods = options.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE"];

	return async (ctx, next) => {
		const response = await next();
		response.headers.set("Access-Control-Allow-Origin", origin);
		response.headers.set("Access-Control-Allow-Methods", methods.join(", "));
		response.headers.set(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization",
		);
		return response;
	};
};

export const RequestId: Middleware = async (ctx, next) => {
	const id = crypto.randomUUID();
	ctx.requestId = id;
	const response = await next();
	response.headers.set("X-Request-Id", id);
	return response;
};

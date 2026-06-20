import type { Middleware } from "./Middleware";
import type { RouteHandler } from "./Router";

export function applyMiddlewares(
	handler: RouteHandler,
	middlewares: readonly Middleware[],
): RouteHandler {
	if (middlewares.length === 0) {
		return handler;
	}

	return async (ctx) => {
		let index = -1;
		const dispatch = async (position: number): Promise<Response> => {
			if (position <= index) {
				throw new Error("next() called multiple times");
			}
			index = position;
			const middleware = middlewares[position];
			if (middleware) {
				return middleware(ctx, () => dispatch(position + 1));
			}
			return handler(ctx);
		};

		return dispatch(0);
	};
}

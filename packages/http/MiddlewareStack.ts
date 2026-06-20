import type { Middleware } from "./Middleware";
import type { RouteHandler } from "./Router";

export function applyMiddlewares(
	handler: RouteHandler,
	middlewares: readonly Middleware[],
): RouteHandler {
	if (middlewares.length === 0) {
		return handler;
	}

	let composed = handler;

	for (let index = middlewares.length - 1; index >= 0; index -= 1) {
		const middleware = middlewares[index];
		if (!middleware) {
			continue;
		}

		const nextHandler = composed;
		composed = async (ctx) => {
			let nextCalled = false;

			return middleware(ctx, async () => {
				if (nextCalled) {
					throw new Error("next() called multiple times");
				}

				nextCalled = true;
				return nextHandler(ctx);
			});
		};
	}

	return composed;
}

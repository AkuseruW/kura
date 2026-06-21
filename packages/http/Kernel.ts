import type { HttpErrorHandlerInput } from "./ErrorHandler";
import type { Middleware } from "./Middleware";

export type NamedMiddlewareMap = Record<string, Middleware>;

export type HttpKernelOptions<
	NamedMiddleware extends NamedMiddlewareMap = NamedMiddlewareMap,
> = {
	readonly errorHandler?: HttpErrorHandlerInput;
	readonly server?: readonly Middleware[];
	readonly router?: readonly Middleware[];
	readonly named?: NamedMiddleware;
};

export type HttpKernel<
	NamedMiddleware extends NamedMiddlewareMap = NamedMiddlewareMap,
> = {
	readonly errorHandler?: HttpErrorHandlerInput;
	readonly server: readonly Middleware[];
	readonly router: readonly Middleware[];
	readonly named: NamedMiddleware;
};

export function defineHttpKernel(): HttpKernel<Record<string, never>>;
export function defineHttpKernel<
	const NamedMiddleware extends NamedMiddlewareMap,
>(options: HttpKernelOptions<NamedMiddleware>): HttpKernel<NamedMiddleware>;
export function defineHttpKernel<
	const NamedMiddleware extends NamedMiddlewareMap,
>(
	options?: HttpKernelOptions<NamedMiddleware>,
): HttpKernel<NamedMiddleware> | HttpKernel<Record<string, never>> {
	if (!options) {
		return {
			server: [],
			router: [],
			named: {},
		};
	}

	return {
		...(options.errorHandler ? { errorHandler: options.errorHandler } : {}),
		server: options.server ?? [],
		router: options.router ?? [],
		named: options.named ?? ({} as NamedMiddleware),
	};
}

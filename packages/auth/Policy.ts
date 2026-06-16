import { BaseException } from "../core/BaseException";
import type {
	ControllerAction,
	ControllerConstructor,
} from "../http/Controller";
import type { Middleware } from "../http/Middleware";
import type { Context } from "../http/Server";

export type PolicyAction =
	| "view"
	| "create"
	| "update"
	| "delete"
	| (string & {});
export type PolicyResult = boolean | Promise<boolean>;
export type PolicyBeforeResult =
	| boolean
	| undefined
	| Promise<boolean | undefined>;
export type PolicyHandler<TUser = unknown, TResource = unknown> = (
	user: TUser,
	resource: TResource | undefined,
	ctx: Context,
) => PolicyResult;
export type PolicyBeforeHandler<TUser = unknown, TResource = unknown> = (
	user: TUser,
	action: string,
	resource: TResource | undefined,
	ctx: Context,
) => PolicyBeforeResult;

export class AuthorizationException extends BaseException {
	static unauthenticated(): AuthorizationException {
		return new AuthorizationException(
			"Unauthenticated",
			"E_UNAUTHENTICATED",
			401,
		);
	}

	static denied(): AuthorizationException {
		return new AuthorizationException(
			"This action is unauthorized",
			"E_AUTHORIZATION_DENIED",
			403,
		);
	}

	toResponse(): Response {
		return new Response(
			JSON.stringify({ code: this.code, error: this.message }),
			{
				status: this.status,
				headers: { "Content-Type": "application/json" },
			},
		);
	}
}

export abstract class BasePolicy<TUser = unknown, TResource = unknown> {
	before(
		_user: TUser,
		_action: string,
		_resource: TResource | undefined,
		_ctx: Context,
	): PolicyBeforeResult {
		return undefined;
	}

	view(_user: TUser, _resource?: TResource, _ctx?: Context): PolicyResult {
		return false;
	}

	create(_user: TUser, _resource?: TResource, _ctx?: Context): PolicyResult {
		return false;
	}

	update(_user: TUser, _resource?: TResource, _ctx?: Context): PolicyResult {
		return false;
	}

	delete(_user: TUser, _resource?: TResource, _ctx?: Context): PolicyResult {
		return false;
	}
}

export type PolicyConstructor<
	TUser = unknown,
	TResource = unknown,
> = new () => BasePolicy<TUser, TResource>;
export type PolicyInput<TUser = unknown, TResource = unknown> =
	| BasePolicy<TUser, TResource>
	| PolicyConstructor<TUser, TResource>;
export type PolicyResourceResolver<TResource = unknown> = (
	ctx: Context,
) => TResource | Promise<TResource>;

export async function authorize<TUser = unknown, TResource = unknown>(
	ctx: Context,
	policyInput: PolicyInput<TUser, TResource>,
	action: PolicyAction,
	resource?: TResource,
): Promise<void> {
	const user = authenticatedUser<TUser>(ctx);
	const policy = resolvePolicy(policyInput);
	const beforeResult = await policy.before(user, action, resource, ctx);
	if (typeof beforeResult === "boolean") {
		enforceAuthorization(beforeResult);
		return;
	}

	const handler = policyHandler(policy, action);
	enforceAuthorization(await handler.call(policy, user, resource, ctx));
}

export function authorizeMiddleware<TUser = unknown, TResource = unknown>(
	policyInput: PolicyInput<TUser, TResource>,
	action: PolicyAction,
	resourceResolver?: PolicyResourceResolver<TResource>,
): Middleware {
	return async (ctx, next) => {
		try {
			await authorize(
				ctx,
				policyInput,
				action,
				resourceResolver ? await resourceResolver(ctx) : undefined,
			);
		} catch (error) {
			if (error instanceof AuthorizationException) {
				return error.toResponse();
			}
			throw error;
		}

		return next();
	};
}

export type CanDecorator = {
	(
		target: object,
		propertyKey: string | symbol,
		descriptor: PropertyDescriptor,
	): void;
	<T extends ControllerAction>(
		value: T,
		context: ClassMethodDecoratorContext,
	): T | undefined;
};

export function can<TUser = unknown, TResource = unknown>(
	policyInput: PolicyInput<TUser, TResource>,
	action: PolicyAction,
	resourceResolver?: PolicyResourceResolver<TResource>,
): CanDecorator {
	const middleware = authorizeMiddleware(policyInput, action, resourceResolver);
	const decorator = (
		targetOrValue: object | ControllerAction | undefined,
		propertyOrContext: string | symbol | ClassMethodDecoratorContext,
		descriptor?: PropertyDescriptor,
	): ControllerAction | undefined => {
		if (isMethodDecoratorContext(propertyOrContext)) {
			if (propertyOrContext.private) {
				throw new Error("@can() cannot be used on private methods");
			}
			if (propertyOrContext.kind !== "method") {
				throw new Error("@can() can only be used on methods");
			}
			if (typeof targetOrValue !== "function") {
				throw new Error("@can() decorator target is invalid");
			}

			const actionHandler = targetOrValue as ControllerAction;
			return async function authorizedControllerAction(
				this: unknown,
				ctx: Context,
			): Promise<Response> {
				const response = await middleware(ctx, async () =>
					actionHandler.call(this, ctx),
				);
				return response;
			};
		}

		if (!descriptor || typeof descriptor.value !== "function") {
			throw new Error("@can() can only be used on methods");
		}
		if (!targetOrValue || typeof targetOrValue === "function") {
			throw new Error("@can() decorator target is invalid");
		}

		registerControllerAuthorization(
			targetOrValue.constructor as ControllerConstructor,
			normalizeMethodName(propertyOrContext),
			middleware,
		);
	};

	return decorator as CanDecorator;
}

function authenticatedUser<TUser>(ctx: Context): TUser {
	if (!ctx.auth || ctx.auth.user === undefined || ctx.auth.user === null) {
		throw AuthorizationException.unauthenticated();
	}

	return ctx.auth.user as TUser;
}

function resolvePolicy<TUser, TResource>(
	policyInput: PolicyInput<TUser, TResource>,
): BasePolicy<TUser, TResource> {
	if (typeof policyInput === "function") {
		return new policyInput();
	}

	return policyInput;
}

function policyHandler<TUser, TResource>(
	policy: BasePolicy<TUser, TResource>,
	action: string,
): PolicyHandler<TUser, TResource> {
	const method = (policy as unknown as Record<string, unknown>)[action];
	if (typeof method !== "function") {
		throw new Error(`Policy action [${action}] is not defined`);
	}

	return method as PolicyHandler<TUser, TResource>;
}

function enforceAuthorization(allowed: boolean): void {
	if (!allowed) {
		throw AuthorizationException.denied();
	}
}

function registerControllerAuthorization(
	controller: ControllerConstructor,
	action: string,
	middleware: Middleware,
): void {
	const current = controller.middlewareFor ?? {};
	controller.middlewareFor = {
		...current,
		[action]: [...(current[action] ?? []), middleware],
	};
}

function normalizeMethodName(name: string | symbol): string {
	if (typeof name === "symbol") {
		throw new Error("@can() cannot be used on symbol methods");
	}

	return name;
}

function isMethodDecoratorContext(
	value: string | symbol | ClassMethodDecoratorContext,
): value is ClassMethodDecoratorContext {
	return typeof value === "object" && value !== null && "kind" in value;
}

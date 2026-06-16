import type { Middleware } from "../http/Middleware";
import { KuraResponse } from "../http/Response";
import type { Context } from "../http/Server";

export type AuthContext = NonNullable<Context["auth"]>;
export type GuardResult = boolean | AuthContext | Response;
export type GuardResolver = (
	ctx: Context,
) => GuardResult | Promise<GuardResult>;
export type GuardOptions = {
	guardName?: string;
};

export interface Guard {
	authenticate(ctx: Context): GuardResult | Promise<GuardResult>;
}

export type GuardInput = Guard | GuardResolver;

export function guard(
	input: GuardInput,
	options: GuardOptions = {},
): Middleware {
	return async (ctx, next) => {
		const result = await authenticate(input, ctx);
		if (result instanceof Response) {
			return result;
		}
		if (result === false) {
			return new KuraResponse().unauthorized();
		}
		if (result === true) {
			if (options.guardName) {
				ctx.auth = { ...ctx.auth, guard: options.guardName };
			}
		} else {
			ctx.auth = {
				...ctx.auth,
				...result,
				guard: options.guardName ?? result.guard,
			};
		}
		return next();
	};
}

async function authenticate(
	input: GuardInput,
	ctx: Context,
): Promise<GuardResult> {
	if (isGuard(input)) {
		return input.authenticate(ctx);
	}
	return input(ctx);
}

function isGuard(input: GuardInput): input is Guard {
	return typeof input === "object" && input !== null && "authenticate" in input;
}

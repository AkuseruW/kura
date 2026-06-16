import type { Context } from "../http/Server";
import type { AuthContext, Guard, GuardResult } from "./Guard";

export type SessionResolverResult =
	| boolean
	| Response
	| (Partial<AuthContext> & { guard?: string });

export type SessionResolver = (
	sessionId: string,
	ctx: Context,
) => SessionResolverResult | Promise<SessionResolverResult>;

export type SessionGuardOptions = {
	cookieName?: string;
	headerName?: string;
	guardName?: string;
	resolve: SessionResolver;
};

export class SessionGuard implements Guard {
	constructor(private options: SessionGuardOptions) {}

	async authenticate(ctx: Context): Promise<GuardResult> {
		const sessionId = this.sessionId(ctx.request);
		if (!sessionId) {
			return false;
		}

		const resolved = await this.options.resolve(sessionId, ctx);
		if (resolved === false || resolved instanceof Response) {
			return resolved;
		}

		const guardName = resolved === true ? undefined : resolved.guard;
		const details = resolved === true ? {} : resolved;
		return {
			...details,
			guard: guardName ?? this.options.guardName ?? "session",
			sessionId: details.sessionId ?? sessionId,
		};
	}

	private sessionId(request: Request): string | null {
		const headerName = this.options.headerName;
		if (headerName) {
			const headerValue = request.headers.get(headerName);
			if (headerValue) {
				return headerValue;
			}
		}

		const cookieName = this.options.cookieName ?? "kura_session";
		return getCookie(request.headers.get("cookie"), cookieName);
	}
}

function getCookie(header: string | null, name: string): string | null {
	if (!header) {
		return null;
	}

	for (const cookie of header.split(";")) {
		const [rawName, ...rawValue] = cookie.trim().split("=");
		if (rawName !== name) {
			continue;
		}

		const value = rawValue.join("=");
		if (!value) {
			return "";
		}
		return safeDecode(value);
	}

	return null;
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

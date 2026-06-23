import {
	type CookieOptions,
	type CookieSameSite,
	clearCookie,
	readCookie,
	serializeCookie,
} from "../http/Cookie";

export type SessionCookieOptions = {
	readonly domain?: string;
	readonly httpOnly?: boolean;
	readonly maxAge?: number;
	readonly name?: string;
	readonly path?: string;
	readonly sameSite?: CookieSameSite;
	readonly secure?: boolean;
};

export class SessionCookie {
	constructor(private readonly options: SessionCookieOptions = {}) {}

	get name(): string {
		return this.options.name ?? "kura-session";
	}

	read(request: Request): string | null {
		return readCookie(request.headers.get("cookie"), this.name);
	}

	serialize(sessionId: string, maxAge = this.options.maxAge): string {
		return serializeCookie(this.name, sessionId, {
			...this.cookieOptions(),
			maxAge,
		});
	}

	clear(): string {
		return clearCookie(this.name, this.cookieOptions());
	}

	private cookieOptions(): CookieOptions {
		return {
			domain: this.options.domain,
			httpOnly: this.options.httpOnly ?? true,
			path: this.options.path ?? "/",
			sameSite: this.options.sameSite ?? "lax",
			secure: this.options.secure ?? false,
		};
	}
}

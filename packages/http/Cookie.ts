export type CookieSameSite = "lax" | "strict" | "none";

export type CookieOptions = {
	readonly domain?: string;
	readonly expires?: Date;
	readonly httpOnly?: boolean;
	readonly maxAge?: number;
	readonly path?: string;
	readonly sameSite?: CookieSameSite;
	readonly secure?: boolean;
};

export function parseCookies(
	header: string | null | undefined,
): Record<string, string> {
	if (!header) {
		return {};
	}

	const cookies: Record<string, string> = {};

	for (const cookie of header.split(";")) {
		const [rawName, ...rawValue] = cookie.trim().split("=");
		if (!rawName || rawValue.length === 0) {
			continue;
		}

		cookies[rawName] = safeDecode(rawValue.join("="));
	}

	return cookies;
}

export function readCookie(
	header: string | null | undefined,
	name: string,
): string | null {
	return parseCookies(header)[name] ?? null;
}

export function serializeCookie(
	name: string,
	value: string,
	options: CookieOptions = {},
): string {
	assertValidCookieName(name);
	assertValidCookieValue(value);

	if (options.sameSite === "none" && options.secure !== true) {
		throw new Error("Cookies using SameSite=None must also set Secure.");
	}

	const attributes = [`${name}=${encodeURIComponent(value)}`];

	if (options.maxAge !== undefined) {
		attributes.push(`Max-Age=${serializeMaxAge(options.maxAge)}`);
	}

	if (options.expires) {
		attributes.push(`Expires=${options.expires.toUTCString()}`);
	}

	if (options.domain) {
		assertValidCookieAttribute("Domain", options.domain);
		attributes.push(`Domain=${options.domain}`);
	}

	if (options.path) {
		assertValidCookieAttribute("Path", options.path);
		attributes.push(`Path=${options.path}`);
	}

	if (options.httpOnly !== false) {
		attributes.push("HttpOnly");
	}

	if (options.secure) {
		attributes.push("Secure");
	}

	if (options.sameSite) {
		attributes.push(`SameSite=${serializeSameSite(options.sameSite)}`);
	}

	return attributes.join("; ");
}

export function clearCookie(
	name: string,
	options: Omit<CookieOptions, "expires" | "maxAge"> = {},
): string {
	return serializeCookie(name, "", {
		...options,
		expires: new Date(0),
		maxAge: 0,
	});
}

function serializeSameSite(value: CookieSameSite): string {
	if (value === "none") {
		return "None";
	}

	return value === "strict" ? "Strict" : "Lax";
}

function serializeMaxAge(value: number): string {
	if (!Number.isSafeInteger(value)) {
		throw new TypeError("Cookie maxAge must be a safe integer");
	}

	return String(Math.max(0, value));
}

function assertValidCookieName(name: string): void {
	if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
		throw new TypeError(`Cookie name [${name}] is invalid`);
	}
}

function assertValidCookieValue(value: string): void {
	if (/[\r\n;]/.test(value)) {
		throw new TypeError("Cookie value contains invalid characters");
	}
}

function assertValidCookieAttribute(name: string, value: string): void {
	if (/[\r\n;]/.test(value)) {
		throw new TypeError(`Cookie ${name} contains invalid characters`);
	}
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

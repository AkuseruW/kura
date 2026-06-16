import type { Context } from "../http/Server";
import type { Guard, GuardResult } from "./Guard";

export type JwtAlgorithm = "HS256";
export type JwtSecret = string | ArrayBuffer | Uint8Array;
export type JwtHeader = {
	alg: JwtAlgorithm;
	typ?: string;
	kid?: string;
};
export type JwtClaims = Record<string, unknown> & {
	iss?: string;
	sub?: string;
	aud?: string | string[];
	exp?: number;
	nbf?: number;
	iat?: number;
	jti?: string;
};
export type JwtSecretResolver = (
	header: JwtHeader,
	ctx: Context,
) => JwtSecret | Promise<JwtSecret>;
export type JwtGuardOptions = {
	secret: JwtSecret | JwtSecretResolver;
	issuer?: string;
	audience?: string | string[];
	clockTolerance?: number;
	guardName?: string;
	requireExpiration?: boolean;
};

export class JwtGuard implements Guard {
	constructor(private options: JwtGuardOptions) {}

	async authenticate(ctx: Context): Promise<GuardResult> {
		const token = bearerToken(ctx.request);
		if (!token) {
			return false;
		}

		try {
			const claims = await verifyJwt(token, this.options, ctx);
			return {
				guard: this.options.guardName ?? "jwt",
				token,
				claims,
				user: claims.sub,
			};
		} catch {
			return false;
		}
	}
}

async function verifyJwt(
	token: string,
	options: JwtGuardOptions,
	ctx: Context,
): Promise<JwtClaims> {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("Invalid JWT format");
	}

	const [encodedHeader, encodedPayload, encodedSignature] = parts;
	if (!encodedHeader || !encodedPayload || !encodedSignature) {
		throw new Error("Invalid JWT format");
	}

	const header = decodeHeader(encodedHeader);
	if (header.alg !== "HS256") {
		throw new Error("Unsupported JWT algorithm");
	}

	const secret = await resolveSecret(options.secret, header, ctx);
	const expectedSignature = await signHmac(
		`${encodedHeader}.${encodedPayload}`,
		secret,
	);
	const signature = base64UrlDecode(encodedSignature);
	if (!timingSafeEqual(signature, expectedSignature)) {
		throw new Error("Invalid JWT signature");
	}

	const claims = decodeClaims(encodedPayload);
	validateClaims(claims, options);
	return claims;
}

function decodeHeader(encoded: string): JwtHeader {
	const header = decodeJsonObject(encoded);
	if (header.alg !== "HS256") {
		throw new Error("Unsupported JWT algorithm");
	}

	const jwtHeader: JwtHeader = { alg: header.alg };
	if (typeof header.typ === "string") {
		jwtHeader.typ = header.typ;
	}
	if (typeof header.kid === "string") {
		jwtHeader.kid = header.kid;
	}
	return jwtHeader;
}

function decodeClaims(encoded: string): JwtClaims {
	const claims = decodeJsonObject(encoded);
	return claims;
}

function decodeJsonObject(encoded: string): Record<string, unknown> {
	const json = new TextDecoder().decode(base64UrlDecode(encoded));
	const value: unknown = JSON.parse(json);
	if (!isRecord(value)) {
		throw new Error("JWT part must be a JSON object");
	}
	return value;
}

function validateClaims(claims: JwtClaims, options: JwtGuardOptions): void {
	const now = Math.floor(Date.now() / 1000);
	const clockTolerance = options.clockTolerance ?? 0;
	if (options.requireExpiration !== false && typeof claims.exp !== "number") {
		throw new Error("JWT expiration is required");
	}
	if (typeof claims.exp === "number" && claims.exp <= now - clockTolerance) {
		throw new Error("JWT has expired");
	}
	if (typeof claims.nbf === "number" && claims.nbf > now + clockTolerance) {
		throw new Error("JWT is not active yet");
	}
	if (typeof claims.iat === "number" && claims.iat > now + clockTolerance) {
		throw new Error("JWT was issued in the future");
	}
	if (options.issuer && claims.iss !== options.issuer) {
		throw new Error("JWT issuer mismatch");
	}
	if (options.audience && !hasAudience(claims.aud, options.audience)) {
		throw new Error("JWT audience mismatch");
	}
}

function hasAudience(
	claim: string | string[] | undefined,
	expected: string | string[],
): boolean {
	const claimValues = Array.isArray(claim) ? claim : claim ? [claim] : [];
	const expectedValues = Array.isArray(expected) ? expected : [expected];
	return expectedValues.some((value) => claimValues.includes(value));
}

async function resolveSecret(
	secret: JwtSecret | JwtSecretResolver,
	header: JwtHeader,
	ctx: Context,
): Promise<JwtSecret> {
	if (typeof secret === "function") {
		return secret(header, ctx);
	}
	return secret;
}

async function signHmac(value: string, secret: JwtSecret): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		secretBuffer(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(value),
	);
	return new Uint8Array(signature);
}

function secretBuffer(secret: JwtSecret): ArrayBuffer {
	let bytes: Uint8Array;
	if (typeof secret === "string") {
		bytes = new TextEncoder().encode(secret);
	} else if (secret instanceof Uint8Array) {
		bytes = secret;
	} else {
		bytes = new Uint8Array(secret);
	}

	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	if (copy.byteLength < 32) {
		throw new Error("JWT HS256 secret must be at least 32 bytes");
	}
	return copy.buffer;
}

function bearerToken(request: Request): string | null {
	const authorization = request.headers.get("authorization");
	if (!authorization) {
		return null;
	}

	const match = authorization.match(/^Bearer\s+(.+)$/i);
	return match?.[1] ?? null;
}

function base64UrlDecode(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
	return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
	let diff = left.length ^ right.length;
	const length = Math.max(left.length, right.length);
	for (let i = 0; i < length; i++) {
		diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
	}
	return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

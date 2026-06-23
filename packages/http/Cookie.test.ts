import { describe, expect, test } from "bun:test";
import {
	clearCookie,
	parseCookies,
	readCookie,
	serializeCookie,
} from "./Cookie";

describe("HTTP cookies", () => {
	test("parses and reads request cookies", () => {
		const header = "theme=dark; session=abc%20123; invalid";

		expect(parseCookies(header)).toEqual({
			session: "abc 123",
			theme: "dark",
		});
		expect(readCookie(header, "session")).toBe("abc 123");
		expect(readCookie(header, "missing")).toBeNull();
	});

	test("serializes secure cookie attributes", () => {
		expect(
			serializeCookie("session", "abc 123", {
				httpOnly: true,
				maxAge: 3600,
				path: "/",
				sameSite: "lax",
				secure: true,
			}),
		).toBe(
			"session=abc%20123; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax",
		);
	});

	test("clears cookies with matching scope", () => {
		expect(clearCookie("session", { path: "/", sameSite: "strict" })).toBe(
			"session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Strict",
		);
	});

	test("rejects unsafe cookie options", () => {
		expect(() => serializeCookie("bad name", "value")).toThrow(
			"Cookie name [bad name] is invalid",
		);
		expect(() =>
			serializeCookie("csrf", "value", { sameSite: "none" }),
		).toThrow("SameSite=None must also set Secure");
	});
});

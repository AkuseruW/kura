import { describe, expect, test } from "bun:test";
import { Hash } from "./Hash";

describe("Hash", () => {
	test("hashes passwords without returning the plain text", async () => {
		const hash = await Hash.make("correct horse battery staple");

		expect(typeof hash).toBe("string");
		expect(hash).not.toBe("correct horse battery staple");
		expect(hash.length).toBeGreaterThan(20);
	});

	test("verifies valid and invalid passwords", async () => {
		const hash = await Hash.make("secret-password");

		await expect(Hash.verify(hash, "secret-password")).resolves.toBe(true);
		await expect(Hash.verify(hash, "wrong-password")).resolves.toBe(false);
	});

	test("creates different hashes for the same password", async () => {
		const first = await Hash.make("secret-password");
		const second = await Hash.make("secret-password");

		expect(first).not.toBe(second);
		await expect(Hash.verify(first, "secret-password")).resolves.toBe(true);
		await expect(Hash.verify(second, "secret-password")).resolves.toBe(true);
	});

	test("passes Bun password algorithm options through", async () => {
		const argonHash = await Hash.make("secret-password", "argon2id");
		const bcryptHash = await Hash.make("secret-password", {
			algorithm: "bcrypt",
			cost: 4,
		});

		expect(argonHash.startsWith("$argon2id")).toBe(true);
		expect(bcryptHash.startsWith("$2")).toBe(true);
		await expect(Hash.verify(argonHash, "secret-password")).resolves.toBe(true);
		await expect(
			Hash.verify(bcryptHash, "secret-password", "bcrypt"),
		).resolves.toBe(true);
	});

	test("rejects empty passwords when hashing", async () => {
		await expect(Hash.make("")).rejects.toThrow();
	});
});

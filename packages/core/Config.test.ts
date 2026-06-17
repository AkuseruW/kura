import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "./Config";

let tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
	tempDirs = [];
});

describe("Config", () => {
	test("gets and sets dot notation values", () => {
		const config = new Config();

		config.set("database.connections.postgres.host", "localhost");

		expect(config.get<string>("database.connections.postgres.host")).toBe(
			"localhost",
		);
		expect(config.has("database.connections.postgres.host")).toBe(true);
		expect(config.all()).toEqual({
			database: {
				connections: {
					postgres: {
						host: "localhost",
					},
				},
			},
		});
	});

	test("returns defaults for missing paths without throwing", () => {
		const config = new Config();

		expect(config.get("database.connections.postgres", "default")).toBe(
			"default",
		);
		expect(config.has("database.connections.postgres")).toBe(false);
	});

	test("loads TypeScript config files", async () => {
		const dir = await mkdtemp(join(tmpdir(), "kura-config-"));
		tempDirs.push(dir);
		await writeFile(
			join(dir, "app.ts"),
			"export default { name: 'kura', debug: true };",
		);

		const config = new Config();
		await config.load(dir);

		expect(config.get<string>("app.name")).toBe("kura");
		expect(config.get<boolean>("app.debug")).toBe(true);
	});
});

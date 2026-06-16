import { describe, expect, test } from "bun:test";
import { DatabaseManager, MemoryDatabaseDriver } from "../database/Database";
import {
	databaseHealthCheck,
	HealthManager,
	type HealthReportCheck,
	redisHealthCheck,
} from "./Health";

describe("HealthManager", () => {
	test("runs custom checks and reports aggregate status", async () => {
		const health = new HealthManager()
			.register("app", () => ({ status: "up", data: { version: "test" } }))
			.register("cache", () => ({
				status: "down",
				message: "cache unavailable",
			}));

		const report = await health.run();

		expect(report.status).toBe("down");
		expect(report.checks.map((check) => check.name)).toEqual(["app", "cache"]);
		expect(first(report.checks).data).toEqual({ version: "test" });
		expect(second(report.checks).message).toBe("cache unavailable");
	});

	test("converts thrown check errors into down results", async () => {
		const health = new HealthManager().register("external", () => {
			throw new Error("connection refused");
		});

		const report = await health.run();

		expect(report.status).toBe("down");
		expect(first(report.checks).status).toBe("down");
		expect(first(report.checks).message).toBe("connection refused");
	});

	test("runs selected checks only", async () => {
		const health = new HealthManager()
			.register("app", () => ({ status: "up" }))
			.register("database", () => ({ status: "down" }));

		const report = await health.run(["app"]);

		expect(report.status).toBe("up");
		expect(report.checks.map((check) => check.name)).toEqual(["app"]);
		await expect(health.run(["missing"])).rejects.toThrow(
			"Health check [missing] is not registered",
		);
	});

	test("checks database connectivity", async () => {
		const driver = new MemoryDatabaseDriver();
		const database = new DatabaseManager({
			connections: { primary: { driver: "memory" } },
		}).extend("memory", driver);
		const health = new HealthManager().register(
			"database",
			databaseHealthCheck(database, { connection: "primary" }),
		);

		const report = await health.run();

		expect(report.status).toBe("up");
		expect(driver.connection("primary")?.queries).toEqual([
			{ sql: "select 1", bindings: [] },
		]);
		expect(first(report.checks).data).toEqual({ connection: "primary" });
	});

	test("checks Redis ping responses", async () => {
		const healthy = new HealthManager().register(
			"redis",
			redisHealthCheck({ ping: () => "PONG" }),
		);
		const unhealthy = new HealthManager().register(
			"redis",
			redisHealthCheck({ ping: () => "NOPE" }),
		);

		expect((await healthy.run()).status).toBe("up");
		const report = await unhealthy.run();

		expect(report.status).toBe("down");
		expect(first(report.checks).message).toBe(
			"Unexpected Redis ping response [NOPE]",
		);
	});
});

function first(items: readonly HealthReportCheck[]): HealthReportCheck {
	const item = items[0];
	if (!item) {
		throw new Error("Expected first health report check");
	}

	return item;
}

function second(items: readonly HealthReportCheck[]): HealthReportCheck {
	const item = items[1];
	if (!item) {
		throw new Error("Expected second health report check");
	}

	return item;
}

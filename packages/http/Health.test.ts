import { describe, expect, test } from "bun:test";
import { HealthManager, type HealthReport } from "../core/Health";
import { registerHealthRoutes } from "./Health";
import { Router } from "./Router";
import { createTestClient } from "./TestClient";

describe("health routes", () => {
	test("exposes live and ready health endpoints", async () => {
		const health = new HealthManager().register("database", () => ({
			status: "down",
			message: "database offline",
		}));
		const router = new Router();
		registerHealthRoutes(router, health);
		const client = createTestClient(router);

		const live = await client.get("/health/live");
		const ready = await client.get("/health/ready");

		live.assertStatus(200);
		expect(await live.json<HealthReport>()).toEqual({
			status: "up",
			checks: [],
		});
		ready.assertStatus(503);
		expect((await ready.json<HealthReport>()).status).toBe("down");
	});

	test("supports custom base paths and selected ready checks", async () => {
		const health = new HealthManager()
			.register("app", () => ({ status: "up" }))
			.register("database", () => ({ status: "down" }));
		const router = new Router();
		registerHealthRoutes(router, health, {
			basePath: "status",
			readyChecks: ["app"],
		});

		const response = await createTestClient(router).get("/status/ready");

		response.assertStatus(200);
		expect(
			(await response.json<HealthReport>()).checks.map((check) => check.name),
		).toEqual(["app"]);
	});
});

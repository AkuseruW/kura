import { describe, expect, test } from "bun:test";
import {
	type LogEntry,
	MemoryLogWriter,
	StructuredLogger,
} from "../core/Logger";
import { MetricsRegistry, type MetricsSnapshot } from "../core/Metrics";
import {
	RequestLogger,
	RequestMetrics,
	registerMetricsRoute,
} from "./Observability";
import { Router } from "./Router";
import type { Context } from "./Server";
import { createTestClient } from "./TestClient";

describe("RequestLogger", () => {
	test("writes structured request logs", async () => {
		const writer = new MemoryLogWriter();
		const logger = new StructuredLogger({ writer });
		const ctx: Context = {
			request: new Request("http://localhost/users", {
				headers: { "x-tenant": "acme" },
			}),
			requestId: "req-1",
		};

		const response = await RequestLogger(logger, {
			includeHeaders: ["x-tenant"],
		})(ctx, async () => new Response("created", { status: 201 }));
		const entry = only(writer.entries);

		expect(response.status).toBe(201);
		expect(entry.level).toBe("info");
		expect(entry.message).toBe("HTTP request completed");
		expect(entry.context.method).toBe("GET");
		expect(entry.context.path).toBe("/users");
		expect(entry.context.status).toBe(201);
		expect(entry.context.requestId).toBe("req-1");
		expect(entry.context.headers).toEqual({ "x-tenant": "acme" });
		expect(typeof entry.context.durationMs).toBe("number");
	});

	test("logs failed requests and rethrows errors", async () => {
		const writer = new MemoryLogWriter();
		const logger = new StructuredLogger({ writer });
		const middleware = RequestLogger(logger);

		await expect(
			middleware(
				{ request: new Request("http://localhost/fail") },
				async () => {
					throw new Error("boom");
				},
			),
		).rejects.toThrow("boom");

		const entry = only(writer.entries);
		expect(entry.level).toBe("error");
		expect(entry.context.status).toBe(500);
		expect(entry.context.error).toBe("boom");
	});
});

describe("RequestMetrics", () => {
	test("records request counters and durations", async () => {
		const metrics = new MetricsRegistry();
		const middleware = RequestMetrics(metrics);

		const response = await middleware(
			{ request: new Request("http://localhost/users") },
			async () => new Response(null, { status: 204 }),
		);
		const snapshot = metrics.snapshot();

		expect(response.status).toBe(204);
		expect(snapshot.counters).toEqual([
			{
				name: "http.server.requests",
				value: 1,
				labels: { method: "GET", path: "/users", status: 204 },
			},
		]);
		expect(firstHistogram(snapshot).name).toBe("http.server.duration_ms");
		expect(firstHistogram(snapshot).count).toBe(1);
		expect(firstHistogram(snapshot).labels).toEqual({
			method: "GET",
			path: "/users",
			status: 204,
		});
	});

	test("records failed requests as status 500", async () => {
		const metrics = new MetricsRegistry();
		const middleware = RequestMetrics(metrics);

		await expect(
			middleware(
				{ request: new Request("http://localhost/fail") },
				async () => {
					throw new Error("boom");
				},
			),
		).rejects.toThrow("boom");

		expect(metrics.snapshot().counters).toEqual([
			{
				name: "http.server.requests",
				value: 1,
				labels: { method: "GET", path: "/fail", status: 500 },
			},
		]);
	});

	test("exposes metrics snapshots through a route", async () => {
		const metrics = new MetricsRegistry();
		metrics.increment("jobs.processed", 2, { queue: "default" });
		const router = new Router();
		registerMetricsRoute(router, metrics);

		const response = await createTestClient(router).get("/metrics");

		response.assertStatus(200);
		expect(await response.json<MetricsSnapshot>()).toEqual({
			counters: [
				{
					name: "jobs.processed",
					value: 2,
					labels: { queue: "default" },
				},
			],
			histograms: [],
		});
	});
});

function only(items: readonly LogEntry[]): LogEntry {
	if (items.length !== 1 || !items[0]) {
		throw new Error(`Expected one log entry, received ${items.length}`);
	}

	return items[0];
}

function firstHistogram(
	snapshot: MetricsSnapshot,
): MetricsSnapshot["histograms"][number] {
	const histogram = snapshot.histograms[0];
	if (!histogram) {
		throw new Error("Expected a histogram sample");
	}

	return histogram;
}

import { describe, expect, test } from "bun:test";
import {
	type MetricLabels,
	MetricsRegistry,
	type OpenTelemetryCounter,
	type OpenTelemetryHistogram,
	type OpenTelemetryMeter,
	OpenTelemetryMetricsObserver,
} from "./Metrics";

describe("MetricsRegistry", () => {
	test("records counters and histograms", () => {
		const metrics = new MetricsRegistry();

		metrics.increment("jobs.processed", 1, { queue: "default" });
		metrics.increment("jobs.processed", 2, { queue: "default" });
		metrics.observe("jobs.duration_ms", 10, { queue: "default" });
		metrics.observe("jobs.duration_ms", 30, { queue: "default" });

		expect(metrics.snapshot()).toEqual({
			counters: [
				{
					name: "jobs.processed",
					value: 3,
					labels: { queue: "default" },
				},
			],
			histograms: [
				{
					name: "jobs.duration_ms",
					count: 2,
					sum: 40,
					min: 10,
					max: 30,
					labels: { queue: "default" },
				},
			],
		});
	});

	test("forwards samples to OpenTelemetry-compatible meters", () => {
		const meter = new FakeMeter();
		const metrics = new MetricsRegistry(
			new OpenTelemetryMetricsObserver(meter),
		);

		metrics.increment("http.server.requests", 1, { status: 200 });
		metrics.observe("http.server.duration_ms", 12, { status: 200 });

		expect(meter.counter("http.server.requests").additions).toEqual([
			{ value: 1, attributes: { status: 200 } },
		]);
		expect(meter.histogram("http.server.duration_ms").records).toEqual([
			{ value: 12, attributes: { status: 200 } },
		]);
	});
});

class FakeMeter implements OpenTelemetryMeter {
	private readonly counters = new Map<string, FakeCounter>();
	private readonly histograms = new Map<string, FakeHistogram>();

	createCounter(name: string): OpenTelemetryCounter {
		const counter = new FakeCounter();
		this.counters.set(name, counter);
		return counter;
	}

	createHistogram(name: string): OpenTelemetryHistogram {
		const histogram = new FakeHistogram();
		this.histograms.set(name, histogram);
		return histogram;
	}

	counter(name: string): FakeCounter {
		const counter = this.counters.get(name);
		if (!counter) {
			throw new Error(`Expected counter [${name}]`);
		}

		return counter;
	}

	histogram(name: string): FakeHistogram {
		const histogram = this.histograms.get(name);
		if (!histogram) {
			throw new Error(`Expected histogram [${name}]`);
		}

		return histogram;
	}
}

class FakeCounter implements OpenTelemetryCounter {
	readonly additions: {
		readonly value: number;
		readonly attributes?: MetricLabels;
	}[] = [];

	add(value: number, attributes?: MetricLabels): void {
		this.additions.push({ value, attributes });
	}
}

class FakeHistogram implements OpenTelemetryHistogram {
	readonly records: {
		readonly value: number;
		readonly attributes?: MetricLabels;
	}[] = [];

	record(value: number, attributes?: MetricLabels): void {
		this.records.push({ value, attributes });
	}
}

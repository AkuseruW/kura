export type MetricLabelValue = string | number | boolean;
export type MetricLabels = Record<string, MetricLabelValue>;

export type CounterSample = {
	readonly name: string;
	readonly value: number;
	readonly labels: MetricLabels;
};

export type HistogramSample = {
	readonly name: string;
	readonly count: number;
	readonly sum: number;
	readonly min: number;
	readonly max: number;
	readonly labels: MetricLabels;
};

export type MetricsSnapshot = {
	readonly counters: readonly CounterSample[];
	readonly histograms: readonly HistogramSample[];
};

export type MetricsObserver = {
	count(name: string, value: number, labels: MetricLabels): void;
	observe(name: string, value: number, labels: MetricLabels): void;
};

export type OpenTelemetryCounter = {
	add(value: number, attributes?: MetricLabels): void;
};

export type OpenTelemetryHistogram = {
	record(value: number, attributes?: MetricLabels): void;
};

export type OpenTelemetryMeter = {
	createCounter(name: string): OpenTelemetryCounter;
	createHistogram(name: string): OpenTelemetryHistogram;
};

type HistogramState = {
	count: number;
	sum: number;
	min: number;
	max: number;
	labels: MetricLabels;
};

type CounterState = {
	value: number;
	labels: MetricLabels;
};

export class MetricsRegistry {
	private readonly counters = new Map<string, CounterState>();
	private readonly histograms = new Map<string, HistogramState>();

	constructor(private readonly observer?: MetricsObserver) {}

	increment(name: string, value = 1, labels: MetricLabels = {}): void {
		const key = metricKey(name, labels);
		const counter = this.counters.get(key) ?? {
			value: 0,
			labels: { ...labels },
		};
		counter.value += value;
		this.counters.set(key, counter);
		this.observer?.count(name, value, labels);
	}

	observe(name: string, value: number, labels: MetricLabels = {}): void {
		const key = metricKey(name, labels);
		const histogram =
			this.histograms.get(key) ??
			({
				count: 0,
				sum: 0,
				min: value,
				max: value,
				labels: { ...labels },
			} satisfies HistogramState);

		histogram.count += 1;
		histogram.sum += value;
		histogram.min = Math.min(histogram.min, value);
		histogram.max = Math.max(histogram.max, value);
		this.histograms.set(key, histogram);
		this.observer?.observe(name, value, labels);
	}

	snapshot(): MetricsSnapshot {
		return {
			counters: [...this.counters.entries()].map(([key, counter]) => ({
				name: metricNameFromKey(key),
				value: counter.value,
				labels: counter.labels,
			})),
			histograms: [...this.histograms.entries()].map(([key, histogram]) => ({
				name: metricNameFromKey(key),
				count: histogram.count,
				sum: histogram.sum,
				min: histogram.min,
				max: histogram.max,
				labels: histogram.labels,
			})),
		};
	}
}

export class OpenTelemetryMetricsObserver implements MetricsObserver {
	private readonly counters = new Map<string, OpenTelemetryCounter>();
	private readonly histograms = new Map<string, OpenTelemetryHistogram>();

	constructor(private readonly meter: OpenTelemetryMeter) {}

	count(name: string, value: number, labels: MetricLabels): void {
		let counter = this.counters.get(name);
		if (!counter) {
			counter = this.meter.createCounter(name);
			this.counters.set(name, counter);
		}

		counter.add(value, labels);
	}

	observe(name: string, value: number, labels: MetricLabels): void {
		let histogram = this.histograms.get(name);
		if (!histogram) {
			histogram = this.meter.createHistogram(name);
			this.histograms.set(name, histogram);
		}

		histogram.record(value, labels);
	}
}

function metricKey(name: string, labels: MetricLabels): string {
	const normalizedLabels = Object.entries(labels)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${String(value)}`)
		.join(",");

	return `${name}|${normalizedLabels}`;
}

function metricNameFromKey(key: string): string {
	return key.slice(0, key.indexOf("|"));
}

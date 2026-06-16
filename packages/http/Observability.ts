import type { LogContext, StructuredLogger } from "../core/Logger";
import type { MetricsRegistry } from "../core/Metrics";
import type { Middleware } from "./Middleware";
import type { Router } from "./Router";

export type RequestLoggerOptions = {
	readonly message?: string;
	readonly includeHeaders?: readonly string[];
};

export type RequestMetricsOptions = {
	readonly durationMetric?: string;
	readonly requestMetric?: string;
};

export function RequestLogger(
	logger: StructuredLogger,
	options: RequestLoggerOptions = {},
): Middleware {
	const message = options.message ?? "HTTP request completed";

	return async (ctx, next) => {
		const startedAt = performance.now();
		const url = new URL(ctx.request.url);

		try {
			const response = await next();
			logger.info(message, {
				...requestContext(ctx.request, url, response.status, startedAt),
				requestId: ctx.requestId,
				headers: selectedHeaders(ctx.request.headers, options.includeHeaders),
			});
			return response;
		} catch (error) {
			logger.error("HTTP request failed", {
				...requestContext(ctx.request, url, 500, startedAt),
				error: error instanceof Error ? error.message : "Unknown error",
				requestId: ctx.requestId,
				headers: selectedHeaders(ctx.request.headers, options.includeHeaders),
			});
			throw error;
		}
	};
}

export function RequestMetrics(
	metrics: MetricsRegistry,
	options: RequestMetricsOptions = {},
): Middleware {
	const durationMetric = options.durationMetric ?? "http.server.duration_ms";
	const requestMetric = options.requestMetric ?? "http.server.requests";

	return async (ctx, next) => {
		const startedAt = performance.now();
		const url = new URL(ctx.request.url);
		let status = 500;

		try {
			const response = await next();
			status = response.status;
			return response;
		} finally {
			const labels = {
				method: ctx.request.method,
				path: url.pathname,
				status,
			};
			metrics.increment(requestMetric, 1, labels);
			metrics.observe(durationMetric, elapsedSince(startedAt), labels);
		}
	};
}

export function registerMetricsRoute(
	router: Router,
	metrics: MetricsRegistry,
	path = "/metrics",
): void {
	router.get(path, () => Response.json(metrics.snapshot()));
}

function requestContext(
	request: Request,
	url: URL,
	status: number,
	startedAt: number,
): LogContext {
	return {
		method: request.method,
		path: url.pathname,
		status,
		durationMs: elapsedSince(startedAt),
	};
}

function selectedHeaders(
	headers: Headers,
	names: readonly string[] | undefined,
): LogContext | undefined {
	if (!names || names.length === 0) {
		return undefined;
	}

	const selected: LogContext = {};
	for (const name of names) {
		const value = headers.get(name);
		if (value !== null) {
			selected[name] = value;
		}
	}

	return selected;
}

function elapsedSince(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 100) / 100;
}

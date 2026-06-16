import type { HealthManager, HealthReport } from "../core/Health";
import type { Router } from "./Router";

export type HealthRouteOptions = {
	readonly basePath?: string;
	readonly liveChecks?: readonly string[];
	readonly readyChecks?: readonly string[];
};

export function registerHealthRoutes(
	router: Router,
	health: HealthManager,
	options: HealthRouteOptions = {},
): void {
	const basePath = normalizeBasePath(options.basePath ?? "/health");

	router.get(basePath, async () => healthResponse(await health.run()));
	router.get(`${basePath}/live`, async () =>
		healthResponse(await health.run(options.liveChecks ?? [])),
	);
	router.get(`${basePath}/ready`, async () =>
		healthResponse(await health.run(options.readyChecks)),
	);
}

function healthResponse(report: HealthReport): Response {
	return Response.json(report, {
		status: report.status === "up" ? 200 : 503,
	});
}

function normalizeBasePath(path: string): string {
	const trimmed = path.replace(/^\/+|\/+$/g, "");
	return trimmed ? `/${trimmed}` : "/health";
}

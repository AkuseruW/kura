export type KuraBenchmarkPreset = "api" | "full" | "web";
export type KuraBenchmarkArchitecture = "domain" | "modular" | "standard";

export type BenchmarkEndpoint = {
	readonly label: string;
	readonly path: string;
	readonly primary?: boolean;
};

export type KuraBenchmarkApp = {
	readonly kind: "kura";
	readonly name: string;
	readonly preset: KuraBenchmarkPreset;
	readonly architecture: KuraBenchmarkArchitecture;
	readonly endpoints: readonly BenchmarkEndpoint[];
	readonly healthPath: string;
};

export type BaselineBenchmarkApp = {
	readonly kind: "baseline";
	readonly name:
		| "bun-raw"
		| "kura-bare"
		| "kura-dynamic"
		| "kura-middleware-heavy"
		| "kura-validation-heavy";
	readonly endpoints: readonly BenchmarkEndpoint[];
	readonly healthPath: string;
};

export type BenchmarkApp = BaselineBenchmarkApp | KuraBenchmarkApp;

const architectures = ["standard", "modular", "domain"] as const;

export const kuraBenchmarkApps: readonly KuraBenchmarkApp[] =
	architectures.flatMap((architecture) => [
		{
			kind: "kura",
			name: `api-${architecture}`,
			preset: "api",
			architecture,
			healthPath: "/health",
			endpoints: [
				{ label: "health", path: "/health", primary: true },
				{ label: "home-json", path: "/" },
			],
		},
		{
			kind: "kura",
			name: `web-${architecture}`,
			preset: "web",
			architecture,
			healthPath: "/health",
			endpoints: [
				{ label: "home-view", path: "/", primary: true },
				{ label: "health", path: "/health" },
			],
		},
		{
			kind: "kura",
			name: `full-${architecture}`,
			preset: "full",
			architecture,
			healthPath: "/health",
			endpoints: [
				{ label: "health", path: "/health", primary: true },
				{ label: "home-static", path: "/" },
				{ label: "api-health", path: "/api/health" },
			],
		},
	]);

export const baselineBenchmarkApps: readonly BaselineBenchmarkApp[] = [
	{
		kind: "baseline",
		name: "bun-raw",
		healthPath: "/health",
		endpoints: [
			{ label: "health", path: "/health", primary: true },
			{ label: "home-json", path: "/" },
			{ label: "api-health", path: "/api/health" },
		],
	},
	{
		kind: "baseline",
		name: "kura-bare",
		healthPath: "/health",
		endpoints: [
			{ label: "health", path: "/health", primary: true },
			{ label: "home-json", path: "/" },
			{ label: "api-health", path: "/api/health" },
		],
	},
	{
		kind: "baseline",
		name: "kura-dynamic",
		healthPath: "/health",
		endpoints: [
			{ label: "dynamic-early", path: "/tenants/acme/resource-0/items/42" },
			{
				label: "dynamic-late",
				path: "/tenants/acme/resource-999/items/42",
				primary: true,
			},
			{
				label: "dynamic-miss",
				path: "/tenants/acme/resource-missing/items/42",
			},
			{ label: "health", path: "/health" },
		],
	},
	{
		kind: "baseline",
		name: "kura-middleware-heavy",
		healthPath: "/health",
		endpoints: [
			{ label: "middleware-heavy", path: "/middleware", primary: true },
			{ label: "health", path: "/health" },
		],
	},
	{
		kind: "baseline",
		name: "kura-validation-heavy",
		healthPath: "/health",
		endpoints: [
			{
				label: "validation-query",
				path: "/users/42?tab=profile",
				primary: true,
			},
			{ label: "health", path: "/health" },
		],
	},
];

export const benchmarkApps: readonly BenchmarkApp[] = [
	...baselineBenchmarkApps,
	...kuraBenchmarkApps,
];

export function resolveBenchmarkApps(
	names: readonly string[],
): readonly BenchmarkApp[] {
	if (names.length === 0 || names.includes("all")) {
		return benchmarkApps;
	}

	const selected = new Set(names);
	const apps = benchmarkApps.filter((app) => selected.has(app.name));
	const missing = [...selected].filter(
		(name) => !benchmarkApps.some((app) => app.name === name),
	);

	if (missing.length > 0) {
		throw new Error(
			`Unknown benchmark app${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
		);
	}

	return apps;
}

export function selectedEndpoints(
	app: BenchmarkApp,
	mode: "all" | "primary",
): readonly BenchmarkEndpoint[] {
	return mode === "all"
		? app.endpoints
		: app.endpoints.filter((endpoint) => endpoint.primary === true);
}

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
	readonly name: "bun-raw";
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

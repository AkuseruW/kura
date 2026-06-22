import type {
	AuthPreset,
	CachePreset,
	DatabasePreset,
	ModulePreset,
	NewAppChoices,
	QueuePreset,
} from "./Types";

export type FeatureSupportStatus = "config-only" | "runtime-ready" | "starter";

export type FeatureSupportChoices = {
	readonly database: DatabasePreset | string;
	readonly auth: AuthPreset | string;
	readonly cache: CachePreset | string;
	readonly queue: QueuePreset | string;
	readonly modules: readonly (ModulePreset | string)[];
};

export type FeatureSupportRow = {
	readonly name: string;
	readonly status: FeatureSupportStatus;
	readonly message: string;
};

export function featureSupportRows(
	choices: FeatureSupportChoices | NewAppChoices,
): readonly FeatureSupportRow[] {
	const rows: FeatureSupportRow[] = [
		{
			name: "Core",
			status: "runtime-ready",
			message: "HTTP server, routing, middleware, config, and OpenAPI docs.",
		},
		cacheSupportRow(choices.cache),
	];
	const database = databaseSupportRow(choices.database);
	const auth = authSupportRow(choices.auth);
	const queue = queueSupportRow(choices.queue);

	if (database) {
		rows.push(database);
	}

	if (auth) {
		rows.push(auth);
	}

	if (queue) {
		rows.push(queue);
	}

	for (const module of choices.modules) {
		rows.push(moduleSupportRow(module));
	}

	return rows;
}

export function featureSupportWarnings(
	choices: FeatureSupportChoices | NewAppChoices,
): readonly FeatureSupportRow[] {
	return featureSupportRows(choices).filter(
		(row) => row.status !== "runtime-ready",
	);
}

export function readFeatureSupportChoices(
	value: unknown,
): FeatureSupportChoices | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	return {
		database: readString(value.database) ?? "none",
		auth: readString(value.auth) ?? "none",
		cache: readString(value.cache) ?? "memory",
		queue: readString(value.queue) ?? "none",
		modules: readStringArray(value.modules),
	};
}

function databaseSupportRow(database: string): FeatureSupportRow | undefined {
	if (database === "none") {
		return undefined;
	}

	if (database === "sqlite") {
		return {
			name: "Database",
			status: "runtime-ready",
			message: "SQLite config, migrations, and local persistence are ready.",
		};
	}

	return {
		name: "Database",
		status: "config-only",
		message: `${formatDatabase(database)} config and migrations are scaffolded; add a database driver before real queries.`,
	};
}

function authSupportRow(auth: string): FeatureSupportRow | undefined {
	if (auth === "none") {
		return undefined;
	}

	return {
		name: "Auth",
		status: "starter",
		message: `${formatAuth(auth)} auth routes and demo persistence are scaffolded; review persistence and security before production.`,
	};
}

function cacheSupportRow(cache: string): FeatureSupportRow {
	if (cache === "redis") {
		return {
			name: "Cache",
			status: "config-only",
			message:
				"Redis cache settings are scaffolded; configure a Redis client before production use.",
		};
	}

	return {
		name: "Cache",
		status: "runtime-ready",
		message: `${formatCache(cache)} cache requires no external service.`,
	};
}

function queueSupportRow(queue: string): FeatureSupportRow | undefined {
	if (queue === "none") {
		return undefined;
	}

	if (queue === "redis") {
		return {
			name: "Queue",
			status: "config-only",
			message:
				"Redis queue settings are scaffolded; configure a Redis client before production use.",
		};
	}

	return {
		name: "Queue",
		status: "runtime-ready",
		message: `${formatQueue(queue)} queue config is ready for local workers.`,
	};
}

function moduleSupportRow(module: string): FeatureSupportRow {
	if (module === "mail") {
		return {
			name: "Mail",
			status: "starter",
			message:
				"Config and mailable class are scaffolded; connect a real transport before sending email.",
		};
	}

	if (module === "storage") {
		return {
			name: "Storage",
			status: "starter",
			message:
				"Local storage service is scaffolded; review disks and public access before production.",
		};
	}

	if (module === "i18n") {
		return {
			name: "i18n",
			status: "starter",
			message:
				"Translation config and sample messages are scaffolded; add locales and loaders as needed.",
		};
	}

	if (module === "websockets") {
		return {
			name: "WebSockets",
			status: "starter",
			message:
				"WebSocket config and service are scaffolded; wire upgrades and auth before production realtime.",
		};
	}

	return {
		name: formatLabel(module),
		status: "starter",
		message:
			"Starter files are scaffolded; review the integration before production use.",
	};
}

function formatDatabase(database: string): string {
	if (database === "sqlite") {
		return "SQLite";
	}

	if (database === "postgres") {
		return "Postgres";
	}

	if (database === "mysql") {
		return "MySQL";
	}

	return formatLabel(database);
}

function formatAuth(auth: string): string {
	if (auth === "access-token") {
		return "Access token";
	}

	return formatLabel(auth);
}

function formatCache(cache: string): string {
	if (cache === "file") {
		return "Filesystem";
	}

	return formatLabel(cache);
}

function formatQueue(queue: string): string {
	if (queue === "sqlite") {
		return "SQLite";
	}

	return formatLabel(queue);
}

function formatLabel(value: string): string {
	const normalized = value.trim();

	if (normalized.length === 0) {
		return "Selected";
	}

	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

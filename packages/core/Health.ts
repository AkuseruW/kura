import type { DatabaseManager } from "../database/Database";

export type HealthStatus = "up" | "down";

export type HealthCheckResult = {
	readonly status: HealthStatus;
	readonly message?: string;
	readonly data?: Record<string, unknown>;
};

export type HealthReportCheck = HealthCheckResult & {
	readonly name: string;
	readonly durationMs: number;
};

export type HealthReport = {
	readonly status: HealthStatus;
	readonly checks: readonly HealthReportCheck[];
};

export type HealthCheck = () => HealthCheckResult | Promise<HealthCheckResult>;

type RegisteredHealthCheck = {
	readonly name: string;
	readonly check: HealthCheck;
};

export type DatabaseHealthCheckOptions = {
	readonly connection?: string;
	readonly query?: string;
};

export type RedisHealthClient = {
	ping(): string | Promise<string>;
};

export type RedisHealthCheckOptions = {
	readonly expectedResponse?: string;
};

export class HealthManager {
	private readonly checks = new Map<string, RegisteredHealthCheck>();

	register(name: string, check: HealthCheck): this {
		if (!name.trim()) {
			throw new Error("Health check name cannot be empty");
		}

		this.checks.set(name, { name, check });
		return this;
	}

	async run(names?: readonly string[]): Promise<HealthReport> {
		const checks = this.resolveChecks(names);
		const results: HealthReportCheck[] = [];

		for (const registered of checks) {
			results.push(await this.runCheck(registered));
		}

		return {
			status: results.every((result) => result.status === "up") ? "up" : "down",
			checks: results,
		};
	}

	private resolveChecks(
		names?: readonly string[],
	): readonly RegisteredHealthCheck[] {
		if (!names) {
			return [...this.checks.values()];
		}

		return names.map((name) => {
			const check = this.checks.get(name);
			if (!check) {
				throw new Error(`Health check [${name}] is not registered`);
			}

			return check;
		});
	}

	private async runCheck(
		registered: RegisteredHealthCheck,
	): Promise<HealthReportCheck> {
		const startedAt = performance.now();

		try {
			const result = await registered.check();

			return {
				name: registered.name,
				status: result.status,
				message: result.message,
				data: result.data,
				durationMs: elapsedSince(startedAt),
			};
		} catch (error) {
			return {
				name: registered.name,
				status: "down",
				message: error instanceof Error ? error.message : "Health check failed",
				durationMs: elapsedSince(startedAt),
			};
		}
	}
}

export function databaseHealthCheck(
	database: DatabaseManager,
	options: DatabaseHealthCheckOptions = {},
): HealthCheck {
	return async () => {
		await database.query(options.query ?? "select 1", [], options.connection);

		return {
			status: "up",
			data: options.connection ? { connection: options.connection } : undefined,
		};
	};
}

export function redisHealthCheck(
	client: RedisHealthClient,
	options: RedisHealthCheckOptions = {},
): HealthCheck {
	const expectedResponse = options.expectedResponse ?? "PONG";

	return async () => {
		const response = await client.ping();

		if (response !== expectedResponse) {
			return {
				status: "down",
				message: `Unexpected Redis ping response [${response}]`,
			};
		}

		return { status: "up" };
	};
}

function elapsedSince(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 100) / 100;
}

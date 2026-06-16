import {
	type Command,
	type ConsoleKernel,
	type ConsoleOptions,
	defineCommand,
} from "../console/Console";
import type { DatabaseManager } from "./Database";
import {
	SeederRunner,
	type SeederRunResult,
	type SeederSource,
} from "./Factory";
import {
	type MigrationDefinition,
	MigrationRunner,
	type MigrationRunnerOptions,
	type MigrationRunResult,
} from "./Migration";

export interface DatabaseConsoleOptions {
	readonly database: DatabaseManager;
	readonly migrations?: readonly MigrationDefinition[];
	readonly seeders?: readonly SeederSource[];
	readonly connection?: string;
	readonly migrationTable?: string;
}

export function createDatabaseCommands(
	options: DatabaseConsoleOptions,
): readonly Command[] {
	return [
		makeMigrationRunCommand(options),
		makeMigrationRollbackCommand(options),
		makeDatabaseSeedCommand(options),
		makeDatabaseFreshCommand(options),
	];
}

export function registerDatabaseCommands(
	console: ConsoleKernel,
	options: DatabaseConsoleOptions,
): ConsoleKernel {
	for (const command of createDatabaseCommands(options)) {
		console.register(command);
	}

	return console;
}

function makeMigrationRunCommand(options: DatabaseConsoleOptions): Command {
	return defineCommand(
		{
			name: "migration:run",
			description: "Run pending database migrations",
			options: databaseCommandOptions(),
		},
		async (context) => {
			const runner = makeMigrationRunner(options, context.options);
			const result = await runner.run(options.migrations ?? []);
			context.output.write(formatMigrationRunResult(result));
		},
	);
}

function makeMigrationRollbackCommand(
	options: DatabaseConsoleOptions,
): Command {
	return defineCommand(
		{
			name: "migration:rollback",
			description: "Roll back the latest database migration batch",
			options: [
				...databaseCommandOptions(),
				{
					name: "batch",
					alias: "b",
					value: "string",
					description: "Migration batch to roll back",
				},
			],
		},
		async (context) => {
			const runner = makeMigrationRunner(options, context.options);
			const result = await runner.rollback(
				options.migrations ?? [],
				parseBatchOption(context.options),
			);
			context.output.write(formatMigrationRollbackResult(result));
		},
	);
}

function makeDatabaseSeedCommand(options: DatabaseConsoleOptions): Command {
	return defineCommand(
		{
			name: "db:seed",
			description: "Run database seeders",
		},
		async (context) => {
			const result = await runSeeders(options.seeders ?? []);
			context.output.write(formatSeederRunResult(result));
		},
	);
}

function makeDatabaseFreshCommand(options: DatabaseConsoleOptions): Command {
	return defineCommand(
		{
			name: "db:fresh",
			description:
				"Roll back all migrations, run migrations, and optionally seed",
			options: [
				...databaseCommandOptions(),
				{
					name: "seed",
					alias: "s",
					description: "Run seeders after migrations",
				},
			],
		},
		async (context) => {
			const runner = makeMigrationRunner(options, context.options);
			const rolledBack = await rollbackAll(runner, options.migrations ?? []);
			const migrated = await runner.run(options.migrations ?? []);
			context.output.write(formatFreshResult(rolledBack, migrated));

			if (isEnabled(context.options, "seed")) {
				const seeded = await runSeeders(options.seeders ?? []);
				context.output.write(formatSeederRunResult(seeded));
			}
		},
	);
}

function databaseCommandOptions() {
	return [
		{
			name: "connection",
			alias: "c",
			value: "string" as const,
			description: "Database connection name",
		},
		{
			name: "table",
			alias: "t",
			value: "string" as const,
			description: "Migration tracking table",
		},
	];
}

function makeMigrationRunner(
	options: DatabaseConsoleOptions,
	consoleOptions: ConsoleOptions,
): MigrationRunner {
	const runnerOptions: MigrationRunnerOptions = {
		connection:
			readStringOption(consoleOptions, "connection") ?? options.connection,
		table: readStringOption(consoleOptions, "table") ?? options.migrationTable,
	};

	return new MigrationRunner(options.database, runnerOptions);
}

async function rollbackAll(
	runner: MigrationRunner,
	migrations: readonly MigrationDefinition[],
): Promise<readonly string[]> {
	const rolledBack: string[] = [];
	const seenBatches = new Set<number>();

	while (true) {
		const result = await runner.rollback(migrations);

		if (result.migrations.length === 0) {
			return rolledBack;
		}

		if (result.batch !== null) {
			if (seenBatches.has(result.batch)) {
				throw new Error(
					`Rollback did not advance past migration batch [${result.batch}]`,
				);
			}

			seenBatches.add(result.batch);
		}

		rolledBack.push(...result.migrations);
	}
}

async function runSeeders(
	seeders: readonly SeederSource[],
): Promise<SeederRunResult> {
	return new SeederRunner().run(seeders);
}

function parseBatchOption(options: ConsoleOptions): number | undefined {
	const value = readStringOption(options, "batch");

	if (value === undefined) {
		return undefined;
	}

	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error("Option [batch] must be a positive integer");
	}

	return parsed;
}

function readStringOption(
	options: ConsoleOptions,
	name: string,
): string | undefined {
	const value = options[name];

	if (Array.isArray(value)) {
		return value.at(-1);
	}

	if (typeof value === "string") {
		return value;
	}

	return undefined;
}

function isEnabled(options: ConsoleOptions, name: string): boolean {
	return options[name] === true;
}

function formatMigrationRunResult(result: MigrationRunResult): string {
	if (result.migrations.length === 0) {
		return "No pending migrations.";
	}

	return `Migrated ${formatCount(result.migrations.length, "migration")} in batch ${result.batch}: ${result.migrations.join(", ")}`;
}

function formatMigrationRollbackResult(result: MigrationRunResult): string {
	if (result.migrations.length === 0) {
		return "No migrations were rolled back.";
	}

	return `Rolled back ${formatCount(result.migrations.length, "migration")} from batch ${result.batch}: ${result.migrations.join(", ")}`;
}

function formatSeederRunResult(result: SeederRunResult): string {
	if (result.seeders.length === 0) {
		return "No seeders registered.";
	}

	return `Seeded ${formatCount(result.seeders.length, "seeder")}: ${result.seeders.join(", ")}`;
}

function formatFreshResult(
	rolledBack: readonly string[],
	migrated: MigrationRunResult,
): string {
	const rollbackSummary =
		rolledBack.length === 0
			? "No migrations were rolled back."
			: `Rolled back ${formatCount(rolledBack.length, "migration")}: ${rolledBack.join(", ")}`;

	return `${rollbackSummary}\n${formatMigrationRunResult(migrated)}`;
}

function formatCount(count: number, label: string): string {
	return `${count} ${label}${count === 1 ? "" : "s"}`;
}

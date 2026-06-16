export type QueryPrimitive =
	| string
	| number
	| boolean
	| bigint
	| null
	| Date
	| Uint8Array;

export type QueryBindings = readonly QueryPrimitive[];

export type QueryRow = Record<string, unknown>;

export type QueryResult<TRow extends QueryRow = QueryRow> = {
	readonly rows: readonly TRow[];
	readonly affectedRows: number;
	readonly insertId?: string | number | bigint;
};

export type ExecutedQuery = {
	readonly sql: string;
	readonly bindings: QueryBindings;
};

export type DatabaseConnectionConfig = {
	readonly driver: string;
	readonly [key: string]: unknown;
};

export type DatabaseManagerOptions = {
	readonly default?: string;
	readonly connections?: Record<string, DatabaseConnectionConfig>;
};

export interface DatabaseConnection {
	query<TRow extends QueryRow = QueryRow>(
		sql: string,
		bindings?: QueryBindings,
	): Promise<QueryResult<TRow>>;
	close(): void | Promise<void>;
}

export interface DatabaseDriver {
	connect(
		name: string,
		config: DatabaseConnectionConfig,
	): DatabaseConnection | Promise<DatabaseConnection>;
}

export class DatabaseManager {
	private readonly configs = new Map<string, DatabaseConnectionConfig>();
	private readonly drivers = new Map<string, DatabaseDriver>();
	private readonly connections = new Map<string, DatabaseConnection>();
	private defaultConnectionName?: string;

	constructor(options: DatabaseManagerOptions = {}) {
		this.defaultConnectionName = options.default;

		for (const [name, config] of Object.entries(options.connections ?? {})) {
			this.addConnection(name, config);
		}
	}

	extend(name: string, driver: DatabaseDriver): this {
		this.drivers.set(name, driver);
		return this;
	}

	addConnection(name: string, config: DatabaseConnectionConfig): this {
		this.configs.set(name, config);
		return this;
	}

	setDefaultConnection(name: string): this {
		this.defaultConnectionName = name;
		return this;
	}

	async connection<TConnection extends DatabaseConnection = DatabaseConnection>(
		name?: string,
	): Promise<TConnection> {
		const connectionName = name ?? this.getDefaultConnectionName();

		if (!connectionName) {
			throw new Error(
				"No database connection name was provided and no default connection is configured",
			);
		}

		const cachedConnection = this.connections.get(connectionName);
		if (cachedConnection) {
			return cachedConnection as TConnection;
		}

		const config = this.configs.get(connectionName);
		if (!config) {
			throw new Error(
				`Database connection [${connectionName}] is not configured`,
			);
		}

		const driver = this.drivers.get(config.driver);
		if (!driver) {
			throw new Error(
				`Database driver [${config.driver}] is not registered for connection [${connectionName}]`,
			);
		}

		const connection = await driver.connect(connectionName, config);
		this.connections.set(connectionName, connection);
		return connection as TConnection;
	}

	async query<TRow extends QueryRow = QueryRow>(
		sql: string,
		bindings: QueryBindings = [],
		connectionName?: string,
	): Promise<QueryResult<TRow>> {
		const connection = await this.connection(connectionName);
		return connection.query<TRow>(sql, bindings);
	}

	async close(name?: string): Promise<void> {
		const connectionName = name ?? this.getDefaultConnectionName();
		if (!connectionName) {
			return;
		}

		const connection = this.connections.get(connectionName);
		if (!connection) {
			return;
		}

		await connection.close();
		this.connections.delete(connectionName);
	}

	async closeAll(): Promise<void> {
		const connectionNames = [...this.connections.keys()];

		for (const connectionName of connectionNames) {
			await this.close(connectionName);
		}
	}

	private getDefaultConnectionName(): string | undefined {
		if (this.defaultConnectionName) {
			return this.defaultConnectionName;
		}

		if (this.configs.size === 1) {
			return this.configs.keys().next().value;
		}

		return undefined;
	}
}

export class MemoryDatabaseDriver implements DatabaseDriver {
	private readonly connections = new Map<string, MemoryDatabaseConnection>();

	connect(name: string): MemoryDatabaseConnection {
		const connection = new MemoryDatabaseConnection();
		this.connections.set(name, connection);
		return connection;
	}

	connection(name: string): MemoryDatabaseConnection | undefined {
		return this.connections.get(name);
	}
}

export class MemoryDatabaseConnection implements DatabaseConnection {
	private readonly queuedResults: QueryResult<QueryRow>[] = [];
	private closed = false;

	readonly queries: ExecutedQuery[] = [];

	queueResult<TRow extends QueryRow>(result: QueryResult<TRow>): this {
		this.queuedResults.push(result);
		return this;
	}

	async query<TRow extends QueryRow = QueryRow>(
		sql: string,
		bindings: QueryBindings = [],
	): Promise<QueryResult<TRow>> {
		if (this.closed) {
			throw new Error("Cannot query a closed memory database connection");
		}

		this.queries.push({
			sql,
			bindings: [...bindings],
		});

		const result = this.queuedResults.shift();
		return (result ?? { rows: [], affectedRows: 0 }) as QueryResult<TRow>;
	}

	close(): void {
		this.closed = true;
	}

	isClosed(): boolean {
		return this.closed;
	}
}

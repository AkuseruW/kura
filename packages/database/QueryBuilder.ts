import type {
	QueryBindings,
	QueryPrimitive,
	QueryResult,
	QueryRow,
} from "./Database";

export type QueryColumn<TRow extends QueryRow = QueryRow> =
	| Extract<keyof TRow, string>
	| "*";

export type QueryOperator =
	| "="
	| "!="
	| "<>"
	| ">"
	| ">="
	| "<"
	| "<="
	| "like"
	| "not like"
	| "in"
	| "not in"
	| "is"
	| "is not";

export type SortDirection = "asc" | "desc";

export type QueryValue = QueryPrimitive | readonly QueryPrimitive[];

export type CompiledQuery = {
	readonly sql: string;
	readonly bindings: QueryBindings;
};

export type PaginatedResult<TRow extends QueryRow> = {
	readonly data: readonly TRow[];
	readonly total: number;
	readonly perPage: number;
	readonly currentPage: number;
	readonly lastPage: number;
	readonly from: number | null;
	readonly to: number | null;
};

export interface QueryExecutor {
	query<TRow extends QueryRow = QueryRow>(
		sql: string,
		bindings?: QueryBindings,
		connectionName?: string,
	): Promise<QueryResult<TRow>>;
}

type BooleanOperator = "and" | "or";
type AggregateFunction = "count" | "sum" | "avg";

type WhereCondition<TRow extends QueryRow> = {
	readonly boolean: BooleanOperator;
	readonly column: QueryColumn<TRow>;
	readonly operator: QueryOperator;
	readonly value: QueryValue;
};

type OrderClause<TRow extends QueryRow> = {
	readonly column: QueryColumn<TRow>;
	readonly direction: SortDirection;
};

type SelectCompileOptions = {
	readonly limit?: number;
	readonly offset?: number;
};

type WhereCompileResult = {
	readonly sql: string;
	readonly bindings: QueryPrimitive[];
};

type AggregateRow = QueryRow & {
	readonly aggregate: number | string | bigint | null;
};

const queryOperators = new Set<QueryOperator>([
	"=",
	"!=",
	"<>",
	">",
	">=",
	"<",
	"<=",
	"like",
	"not like",
	"in",
	"not in",
	"is",
	"is not",
]);

export class QueryBuilder<TRow extends QueryRow = QueryRow> {
	private selectedColumns: QueryColumn<TRow>[] = ["*"];
	private readonly whereConditions: WhereCondition<TRow>[] = [];
	private readonly orderClauses: OrderClause<TRow>[] = [];
	private limitValue?: number;

	constructor(
		private readonly executor: QueryExecutor,
		private readonly tableName: string,
		private readonly connectionName?: string,
	) {}

	select(...columns: QueryColumn<TRow>[]): this {
		if (columns.length === 0) {
			throw new Error("select() requires at least one column");
		}

		this.selectedColumns = [...columns];
		return this;
	}

	where(column: QueryColumn<TRow>, value: QueryValue): this;
	where(
		column: QueryColumn<TRow>,
		operator: QueryOperator,
		value: QueryValue,
	): this;
	where(
		column: QueryColumn<TRow>,
		operatorOrValue: QueryOperator | QueryValue,
		value?: QueryValue,
	): this {
		return this.addWhereCondition("and", column, operatorOrValue, value);
	}

	orWhere(column: QueryColumn<TRow>, value: QueryValue): this;
	orWhere(
		column: QueryColumn<TRow>,
		operator: QueryOperator,
		value: QueryValue,
	): this;
	orWhere(
		column: QueryColumn<TRow>,
		operatorOrValue: QueryOperator | QueryValue,
		value?: QueryValue,
	): this {
		return this.addWhereCondition("or", column, operatorOrValue, value);
	}

	orderBy(column: QueryColumn<TRow>, direction: SortDirection = "asc"): this {
		if (direction !== "asc" && direction !== "desc") {
			throw new Error("orderBy() direction must be [asc] or [desc]");
		}

		this.orderClauses.push({ column, direction });
		return this;
	}

	limit(value: number): this {
		this.limitValue = parseNonNegativeInteger(value, "limit()");
		return this;
	}

	toSQL(): CompiledQuery {
		return this.compileSelect();
	}

	async all(): Promise<readonly TRow[]> {
		const result = await this.execute<TRow>(this.compileSelect());
		return result.rows;
	}

	async first(): Promise<TRow | null> {
		const result = await this.execute<TRow>(this.compileSelect({ limit: 1 }));
		return result.rows[0] ?? null;
	}

	async paginate(page = 1, perPage = 15): Promise<PaginatedResult<TRow>> {
		const currentPage = parsePositiveInteger(page, "paginate() page");
		const pageSize = parsePositiveInteger(perPage, "paginate() perPage");
		const offset = (currentPage - 1) * pageSize;
		const total = await this.count();
		const data = await this.execute<TRow>(
			this.compileSelect({
				limit: pageSize,
				offset,
			}),
		);
		const lastPage = Math.max(Math.ceil(total / pageSize), 1);
		const from = data.rows.length === 0 ? null : offset + 1;
		const to = from === null ? null : from + data.rows.length - 1;

		return {
			data: data.rows,
			total,
			perPage: pageSize,
			currentPage,
			lastPage,
			from,
			to,
		};
	}

	async count(column: QueryColumn<TRow> = "*"): Promise<number> {
		return (await this.aggregate("count", column)) ?? 0;
	}

	async sum(column: QueryColumn<TRow>): Promise<number | null> {
		return this.aggregate("sum", column);
	}

	async avg(column: QueryColumn<TRow>): Promise<number | null> {
		return this.aggregate("avg", column);
	}

	private addWhereCondition(
		boolean: BooleanOperator,
		column: QueryColumn<TRow>,
		operatorOrValue: QueryOperator | QueryValue,
		value?: QueryValue,
	): this {
		const hasExplicitOperator = value !== undefined;
		const operator = hasExplicitOperator
			? normalizeOperator(operatorOrValue)
			: "=";
		const conditionValue = hasExplicitOperator ? value : operatorOrValue;

		this.whereConditions.push({
			boolean,
			column,
			operator,
			value: conditionValue,
		});
		return this;
	}

	private compileSelect(options: SelectCompileOptions = {}): CompiledQuery {
		const bindings: QueryPrimitive[] = [];
		const segments = [
			`select ${this.compileColumns(this.selectedColumns)} from ${escapeIdentifier(this.tableName)}`,
		];
		const where = this.compileWhereConditions();

		if (where.sql) {
			segments.push(`where ${where.sql}`);
			bindings.push(...where.bindings);
		}

		if (this.orderClauses.length > 0) {
			segments.push(
				`order by ${this.orderClauses
					.map(
						(clause) =>
							`${escapeIdentifier(clause.column)} ${clause.direction}`,
					)
					.join(", ")}`,
			);
		}

		const limit = options.limit ?? this.limitValue;
		if (limit !== undefined) {
			segments.push(`limit ${parseNonNegativeInteger(limit, "limit")}`);
		}

		if (options.offset !== undefined) {
			segments.push(
				`offset ${parseNonNegativeInteger(options.offset, "offset")}`,
			);
		}

		return {
			sql: segments.join(" "),
			bindings,
		};
	}

	private compileAggregate(
		functionName: AggregateFunction,
		column: QueryColumn<TRow>,
	): CompiledQuery {
		const bindings: QueryPrimitive[] = [];
		const aggregateColumn = column === "*" ? "*" : escapeIdentifier(column);
		const segments = [
			`select ${functionName}(${aggregateColumn}) as ${escapeIdentifier("aggregate")} from ${escapeIdentifier(this.tableName)}`,
		];
		const where = this.compileWhereConditions();

		if (where.sql) {
			segments.push(`where ${where.sql}`);
			bindings.push(...where.bindings);
		}

		return {
			sql: segments.join(" "),
			bindings,
		};
	}

	private compileColumns(columns: readonly QueryColumn<TRow>[]): string {
		return columns.map((column) => escapeIdentifier(column)).join(", ");
	}

	private compileWhereConditions(): WhereCompileResult {
		const bindings: QueryPrimitive[] = [];
		const conditions = this.whereConditions.map((condition, index) => {
			const compiled = compileWhereCondition(condition);
			bindings.push(...compiled.bindings);

			if (index === 0) {
				return compiled.sql;
			}

			return `${condition.boolean} ${compiled.sql}`;
		});

		return {
			sql: conditions.join(" "),
			bindings,
		};
	}

	private async aggregate(
		functionName: AggregateFunction,
		column: QueryColumn<TRow>,
	): Promise<number | null> {
		const result = await this.execute<AggregateRow>(
			this.compileAggregate(functionName, column),
		);

		return parseAggregateValue(result.rows[0]);
	}

	private execute<TResult extends QueryRow>(
		compiled: CompiledQuery,
	): Promise<QueryResult<TResult>> {
		return this.executor.query<TResult>(
			compiled.sql,
			compiled.bindings,
			this.connectionName,
		);
	}
}

function normalizeOperator(value: QueryOperator | QueryValue): QueryOperator {
	if (typeof value !== "string") {
		throw new Error("where() operator must be a string");
	}

	const operator = value.toLowerCase() as QueryOperator;
	if (!queryOperators.has(operator)) {
		throw new Error(`Unsupported query operator [${value}]`);
	}

	return operator;
}

function compileWhereCondition<TRow extends QueryRow>(
	condition: WhereCondition<TRow>,
): WhereCompileResult {
	const column = escapeIdentifier(condition.column);
	const value = condition.value;

	if (isArrayValue(value)) {
		if (condition.operator !== "in" && condition.operator !== "not in") {
			throw new Error(
				`Query operator [${condition.operator}] does not accept array values`,
			);
		}

		if (value.length === 0) {
			throw new Error("where() array values cannot be empty");
		}

		return {
			sql: `${column} ${condition.operator} (${value.map(() => "?").join(", ")})`,
			bindings: [...value],
		};
	}

	if (value === null) {
		return compileNullWhereCondition(column, condition.operator);
	}

	return {
		sql: `${column} ${condition.operator} ?`,
		bindings: [value],
	};
}

function compileNullWhereCondition(
	column: string,
	operator: QueryOperator,
): WhereCompileResult {
	if (operator === "=" || operator === "is") {
		return {
			sql: `${column} is null`,
			bindings: [],
		};
	}

	if (operator === "!=" || operator === "<>" || operator === "is not") {
		return {
			sql: `${column} is not null`,
			bindings: [],
		};
	}

	return {
		sql: `${column} ${operator} ?`,
		bindings: [null],
	};
}

function parseAggregateValue(row: AggregateRow | undefined): number | null {
	const value = row?.aggregate;

	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === "number") {
		return value;
	}

	if (typeof value === "bigint") {
		return Number(value);
	}

	const parsed = Number(value);
	if (Number.isFinite(parsed)) {
		return parsed;
	}

	throw new Error("Database aggregate did not return a numeric value");
}

function isArrayValue(value: QueryValue): value is readonly QueryPrimitive[] {
	return Array.isArray(value);
}

function escapeIdentifier(identifier: string): string {
	if (identifier === "*") {
		return "*";
	}

	const parts = identifier.split(".");
	if (parts.some((part) => part.length === 0 || part.trim() !== part)) {
		throw new Error(`Invalid query identifier [${identifier}]`);
	}

	return parts
		.map((part) => {
			if (part === "*") {
				return "*";
			}

			return `"${part.replaceAll('"', '""')}"`;
		})
		.join(".");
}

function parseNonNegativeInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}

	return value;
}

function parsePositiveInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer`);
	}

	return value;
}

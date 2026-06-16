// biome-ignore-all lint/complexity/noThisInStatic: Active Record static APIs resolve subclass constructors through this.
import { BaseException } from "../core/BaseException";
import type { DatabaseManager, QueryPrimitive, QueryRow } from "./Database";
import type {
	CompiledQuery,
	PaginatedResult,
	QueryBuilder,
	QueryColumn,
	QueryOperator,
	QueryValue,
	SortDirection,
} from "./QueryBuilder";

export type ModelAttributes = QueryRow;

export type ModelClass<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
> = {
	new (attributes?: Partial<TAttributes>): TModel;
	readonly name: string;
	table?: string;
	primaryKey?: string;
	database?: DatabaseManager;
	connection?: string;
};

export type ModelPaginatedResult<TModel> = Omit<
	PaginatedResult<ModelAttributes>,
	"data"
> & {
	readonly data: readonly TModel[];
};

export class ModelNotFoundException extends BaseException {
	constructor(modelName: string, primaryKey: string, key: QueryPrimitive) {
		super(
			`${modelName} record was not found for ${primaryKey} [${String(key)}]`,
			"E_MODEL_NOT_FOUND",
			404,
		);
	}
}

export class ModelQueryBuilder<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
> {
	constructor(
		private readonly model: ModelClass<TModel, TAttributes>,
		private readonly builder: QueryBuilder<TAttributes>,
	) {}

	select(...columns: QueryColumn<TAttributes>[]): this {
		this.builder.select(...columns);
		return this;
	}

	where(column: QueryColumn<TAttributes>, value: QueryValue): this;
	where(
		column: QueryColumn<TAttributes>,
		operator: QueryOperator,
		value: QueryValue,
	): this;
	where(
		column: QueryColumn<TAttributes>,
		operatorOrValue: QueryOperator | QueryValue,
		value?: QueryValue,
	): this {
		if (value === undefined) {
			this.builder.where(column, operatorOrValue as QueryValue);
			return this;
		}

		this.builder.where(column, operatorOrValue as QueryOperator, value);
		return this;
	}

	orWhere(column: QueryColumn<TAttributes>, value: QueryValue): this;
	orWhere(
		column: QueryColumn<TAttributes>,
		operator: QueryOperator,
		value: QueryValue,
	): this;
	orWhere(
		column: QueryColumn<TAttributes>,
		operatorOrValue: QueryOperator | QueryValue,
		value?: QueryValue,
	): this {
		if (value === undefined) {
			this.builder.orWhere(column, operatorOrValue as QueryValue);
			return this;
		}

		this.builder.orWhere(column, operatorOrValue as QueryOperator, value);
		return this;
	}

	orderBy(
		column: QueryColumn<TAttributes>,
		direction: SortDirection = "asc",
	): this {
		this.builder.orderBy(column, direction);
		return this;
	}

	limit(value: number): this {
		this.builder.limit(value);
		return this;
	}

	toSQL(): CompiledQuery {
		return this.builder.toSQL();
	}

	async all(): Promise<readonly TModel[]> {
		const rows = await this.builder.all();
		return rows.map((row) => hydrateModel(this.model, row));
	}

	async first(): Promise<TModel | null> {
		const row = await this.builder.first();
		return row ? hydrateModel(this.model, row) : null;
	}

	async paginate(
		page = 1,
		perPage = 15,
	): Promise<ModelPaginatedResult<TModel>> {
		const result = await this.builder.paginate(page, perPage);

		return {
			...result,
			data: result.data.map((row) => hydrateModel(this.model, row)),
		};
	}

	count(column: QueryColumn<TAttributes> = "*"): Promise<number> {
		return this.builder.count(column);
	}

	sum(column: QueryColumn<TAttributes>): Promise<number | null> {
		return this.builder.sum(column);
	}

	avg(column: QueryColumn<TAttributes>): Promise<number | null> {
		return this.builder.avg(column);
	}
}

export abstract class BaseModel<
	TAttributes extends ModelAttributes = ModelAttributes,
> {
	static table = "";
	static primaryKey = "id";
	static database?: DatabaseManager;
	static connection?: string;

	private attributes: Partial<TAttributes> = {};

	constructor(attributes: Partial<TAttributes> = {}) {
		this.fill(attributes);
	}

	static useDatabase<
		TAttributes extends ModelAttributes,
		TModel extends BaseModel<TAttributes>,
		TModelClass extends ModelClass<TModel, TAttributes>,
	>(this: TModelClass, database: DatabaseManager): TModelClass {
		this.database = database;
		return this;
	}

	static query<
		TAttributes extends ModelAttributes,
		TModel extends BaseModel<TAttributes>,
	>(
		this: ModelClass<TModel, TAttributes>,
	): ModelQueryBuilder<TModel, TAttributes> {
		return new ModelQueryBuilder(this, createQueryBuilder(this));
	}

	static async find<
		TAttributes extends ModelAttributes,
		TModel extends BaseModel<TAttributes>,
	>(
		this: ModelClass<TModel, TAttributes>,
		key: QueryPrimitive,
	): Promise<TModel | null> {
		return new ModelQueryBuilder(this, createQueryBuilder(this))
			.where(resolvePrimaryKey(this) as QueryColumn<TAttributes>, key)
			.first();
	}

	static async findOrFail<
		TAttributes extends ModelAttributes,
		TModel extends BaseModel<TAttributes>,
	>(
		this: ModelClass<TModel, TAttributes>,
		key: QueryPrimitive,
	): Promise<TModel> {
		const model = await new ModelQueryBuilder(this, createQueryBuilder(this))
			.where(resolvePrimaryKey(this) as QueryColumn<TAttributes>, key)
			.first();
		if (!model) {
			throw new ModelNotFoundException(this.name, resolvePrimaryKey(this), key);
		}

		return model;
	}

	static hydrate<
		TAttributes extends ModelAttributes,
		TModel extends BaseModel<TAttributes>,
	>(this: ModelClass<TModel, TAttributes>, attributes: TAttributes): TModel {
		return hydrateModel(this, attributes);
	}

	fill(attributes: Partial<TAttributes>): this {
		this.attributes = {
			...this.attributes,
			...attributes,
		};
		Object.assign(this, attributes);
		return this;
	}

	getAttribute<TKey extends Extract<keyof TAttributes, string>>(
		key: TKey,
	): TAttributes[TKey] | undefined {
		return this.attributes[key];
	}

	setAttribute<TKey extends Extract<keyof TAttributes, string>>(
		key: TKey,
		value: TAttributes[TKey],
	): this {
		const attributes: Partial<TAttributes> = {};
		attributes[key] = value;
		this.fill(attributes);
		return this;
	}

	toObject(): Partial<TAttributes> {
		return { ...this.attributes };
	}

	toJSON(): Partial<TAttributes> {
		return this.toObject();
	}
}

function createQueryBuilder<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): QueryBuilder<TAttributes> {
	return resolveDatabase(model).table<TAttributes>(
		resolveTable(model),
		model.connection,
	);
}

function hydrateModel<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>, attributes: TAttributes): TModel {
	return new model(attributes);
}

function resolveDatabase<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): DatabaseManager {
	if (!model.database) {
		throw new Error(
			`Database manager is not configured for model [${model.name}]`,
		);
	}

	return model.database;
}

function resolveTable<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): string {
	if (!model.table) {
		throw new Error(
			`Database table is not configured for model [${model.name}]`,
		);
	}

	return model.table;
}

function resolvePrimaryKey<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): string {
	return model.primaryKey ?? "id";
}

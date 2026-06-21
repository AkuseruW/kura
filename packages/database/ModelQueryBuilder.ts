import type { BaseModel } from "./BaseModel";
import { hydrateModel } from "./ModelHydration";
import { preloadModelRelations } from "./ModelPreloader";
import type {
	ModelAttributes,
	ModelClass,
	ModelPaginatedResult,
} from "./ModelTypes";
import type {
	CompiledQuery,
	QueryBuilder,
	QueryColumn,
	QueryOperator,
	QueryValue,
	SortDirection,
} from "./QueryBuilder";

export class ModelQueryBuilder<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
> {
	private readonly preloadedRelations: string[] = [];

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

	preload(name: string): this {
		const relationName = name.trim();
		if (relationName.length === 0) {
			throw new Error("preload() relation name cannot be empty");
		}

		if (!this.preloadedRelations.includes(relationName)) {
			this.preloadedRelations.push(relationName);
		}

		return this;
	}

	toSQL(): CompiledQuery {
		return this.builder.toSQL();
	}

	async all(): Promise<readonly TModel[]> {
		const rows = await this.builder.all();
		const models = rows.map((row) => hydrateModel(this.model, row));
		await preloadModelRelations(models, this.preloadedRelations);
		return models;
	}

	async first(): Promise<TModel | null> {
		const row = await this.builder.first();
		if (!row) {
			return null;
		}

		const model = hydrateModel(this.model, row);
		await preloadModelRelations([model], this.preloadedRelations);
		return model;
	}

	async paginate(
		page = 1,
		perPage = 15,
	): Promise<ModelPaginatedResult<TModel>> {
		const result = await this.builder.paginate(page, perPage);
		const data = result.data.map((row) => hydrateModel(this.model, row));
		await preloadModelRelations(data, this.preloadedRelations);

		return {
			...result,
			data,
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

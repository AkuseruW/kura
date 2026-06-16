// biome-ignore-all lint/complexity/noThisInStatic: Active Record static APIs resolve subclass constructors through this.
import { BaseException } from "../core/BaseException";
import type { DatabaseManager, QueryPrimitive, QueryRow } from "./Database";
import type {
	CompiledQuery,
	PaginatedResult,
	QueryBuilder,
	QueryColumn,
	QueryMutationValues,
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
	timestamps?: boolean;
	createdAtColumn?: string;
	updatedAtColumn?: string;
};

export type ModelColumnOptions = {
	readonly name?: string;
};

export type ModelColumnDefinition = {
	readonly propertyKey: string;
	readonly columnName: string;
};

export type ColumnDecorator = {
	(target: object, propertyKey: string | symbol): void;
	(value: undefined, context: ClassFieldDecoratorContext): void;
};

export type ModelPaginatedResult<TModel> = Omit<
	PaginatedResult<ModelAttributes>,
	"data"
> & {
	readonly data: readonly TModel[];
};

type ConstructorObject = {
	readonly prototype: object;
};

const modelColumns = new WeakMap<
	ConstructorObject,
	Map<string, ModelColumnDefinition>
>();
const markPersisted = Symbol("markPersisted");

export function column(options: ModelColumnOptions = {}): ColumnDecorator {
	const decorator = (
		targetOrValue: object | undefined,
		propertyOrContext: string | symbol | ClassFieldDecoratorContext,
	): void => {
		if (isFieldDecoratorContext(propertyOrContext)) {
			if (propertyOrContext.private) {
				throw new Error("@column() cannot be used on private fields");
			}

			const propertyKey = normalizePropertyKey(propertyOrContext.name);
			propertyOrContext.addInitializer(function initializeColumn(
				this: unknown,
			) {
				if (typeof this !== "object" || this === null) {
					throw new Error("@column() initializer target is invalid");
				}

				registerColumn(
					this.constructor as ConstructorObject,
					propertyKey,
					options,
				);
			});
			return;
		}

		if (!targetOrValue) {
			throw new Error("@column() decorator target is invalid");
		}

		registerColumn(
			targetOrValue.constructor as ConstructorObject,
			normalizePropertyKey(propertyOrContext),
			options,
		);
	};

	return decorator as ColumnDecorator;
}

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
	static timestamps = true;
	static createdAtColumn = "createdAt";
	static updatedAtColumn = "updatedAt";

	private attributes: Partial<TAttributes> = {};
	private original: Partial<TAttributes> = {};
	private persisted = false;

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

	static async create<
		TAttributes extends ModelAttributes,
		TModel extends BaseModel<TAttributes>,
	>(
		this: ModelClass<TModel, TAttributes>,
		attributes: Partial<TAttributes>,
	): Promise<TModel> {
		const model = new this();
		model.fill(attributes);
		await model.save();
		return model;
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
		this.setAttributeByName(key, value);
		return this;
	}

	getOriginal(): Partial<TAttributes>;
	getOriginal<TKey extends Extract<keyof TAttributes, string>>(
		key: TKey,
	): TAttributes[TKey] | undefined;
	getOriginal<TKey extends Extract<keyof TAttributes, string>>(
		key?: TKey,
	): Partial<TAttributes> | TAttributes[TKey] | undefined {
		if (key === undefined) {
			return { ...this.original };
		}

		return this.original[key];
	}

	isDirty<TKey extends Extract<keyof TAttributes, string>>(
		key?: TKey,
	): boolean {
		if (key !== undefined) {
			return !areAttributeValuesEqual(this.attributes[key], this.original[key]);
		}

		const keys = new Set([
			...Object.keys(this.attributes),
			...Object.keys(this.original),
		]);

		for (const attributeKey of keys) {
			const keyName = attributeKey as Extract<keyof TAttributes, string>;
			if (
				!areAttributeValuesEqual(
					this.attributes[keyName],
					this.original[keyName],
				)
			) {
				return true;
			}
		}

		return false;
	}

	isPersisted(): boolean {
		return this.persisted;
	}

	syncOriginal(): this {
		this.original = { ...this.attributes };
		return this;
	}

	async save(): Promise<this> {
		const model = this.getModelClass();

		if (!this.persisted) {
			return this.insertNewModel(model);
		}

		return this.updateExistingModel(model);
	}

	async delete(): Promise<boolean> {
		if (!this.persisted) {
			return false;
		}

		const model = this.getModelClass();
		const primaryKey = resolvePrimaryKey(model);
		const primaryKeyValue = this.getPersistedPrimaryKey(model);
		const result = await createQueryBuilder(model)
			.where(primaryKey as QueryColumn<TAttributes>, primaryKeyValue)
			.delete();

		if (result.affectedRows <= 0) {
			return false;
		}

		this.persisted = false;
		return true;
	}

	toObject(): Partial<TAttributes> {
		return { ...this.attributes };
	}

	toJSON(): Partial<TAttributes> {
		return this.toObject();
	}

	private async insertNewModel(
		model: ModelClass<this, TAttributes>,
	): Promise<this> {
		this.applyCreateTimestamps(model);

		const values = collectModelMutationValues(model, this.attributes);
		if (!values) {
			throw new Error(`Model [${model.name}] has no attributes to insert`);
		}

		const result = await createQueryBuilder(model).insert(values);
		const primaryKey = resolvePrimaryKey(model);

		if (
			result.insertId !== undefined &&
			this.getAttributeByName(primaryKey) === undefined
		) {
			this.setAttributeByName(primaryKey, result.insertId);
		}

		this[markPersisted]();
		return this;
	}

	private async updateExistingModel(
		model: ModelClass<this, TAttributes>,
	): Promise<this> {
		if (!this.isDirty()) {
			return this;
		}

		this.applyUpdateTimestamp(model);

		const dirtyAttributes = this.getDirtyAttributes();
		const values = collectModelMutationValues(model, dirtyAttributes);
		if (!values) {
			return this;
		}

		await createQueryBuilder(model)
			.where(
				resolvePrimaryKey(model) as QueryColumn<TAttributes>,
				this.getPersistedPrimaryKey(model),
			)
			.update(values);
		this.syncOriginal();
		return this;
	}

	private applyCreateTimestamps(model: ModelClass<this, TAttributes>): void {
		if (!usesTimestamps(model)) {
			return;
		}

		const now = new Date();
		const createdAtColumn = resolveCreatedAtColumn(model);
		const updatedAtColumn = resolveUpdatedAtColumn(model);

		if (this.getAttributeByName(createdAtColumn) === undefined) {
			this.setAttributeByName(createdAtColumn, now);
		}

		if (this.getAttributeByName(updatedAtColumn) === undefined) {
			this.setAttributeByName(updatedAtColumn, now);
		}
	}

	private applyUpdateTimestamp(model: ModelClass<this, TAttributes>): void {
		if (usesTimestamps(model)) {
			this.setAttributeByName(resolveUpdatedAtColumn(model), new Date());
		}
	}

	private getDirtyAttributes(): Partial<TAttributes> {
		const dirty: Partial<TAttributes> = {};

		for (const attributeKey of Object.keys(this.attributes)) {
			const key = attributeKey as Extract<keyof TAttributes, string>;
			if (!areAttributeValuesEqual(this.attributes[key], this.original[key])) {
				dirty[key] = this.attributes[key];
			}
		}

		return dirty;
	}

	private getPersistedPrimaryKey(
		model: ModelClass<this, TAttributes>,
	): QueryPrimitive {
		const primaryKey = resolvePrimaryKey(model);
		const originalValue = this.getOriginalByName(primaryKey);
		const currentValue = this.getAttributeByName(primaryKey);
		const value = originalValue ?? currentValue;

		if (!isQueryPrimitive(value) || value === null) {
			throw new Error(
				`Model [${model.name}] cannot be persisted without primary key [${primaryKey}]`,
			);
		}

		return value;
	}

	private getModelClass(): ModelClass<this, TAttributes> {
		return this.constructor as ModelClass<this, TAttributes>;
	}

	private getAttributeByName(key: string): unknown {
		return (this.attributes as Record<string, unknown>)[key];
	}

	private getOriginalByName(key: string): unknown {
		return (this.original as Record<string, unknown>)[key];
	}

	private setAttributeByName(key: string, value: unknown): void {
		const attributes = this.attributes as Record<string, unknown>;
		attributes[key] = value;
		Object.assign(this, { [key]: value });
	}

	private [markPersisted](): this {
		this.persisted = true;
		this.syncOriginal();
		return this;
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
	const instance = new model();
	instance.fill(normalizeHydratedAttributes(model, attributes));
	instance[markPersisted]();
	return instance;
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

function resolveCreatedAtColumn<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): string {
	return model.createdAtColumn ?? "createdAt";
}

function resolveUpdatedAtColumn<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): string {
	return model.updatedAtColumn ?? "updatedAt";
}

function usesTimestamps<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): boolean {
	return model.timestamps ?? true;
}

function registerColumn(
	model: ConstructorObject,
	propertyKey: string,
	options: ModelColumnOptions,
): void {
	let columns = modelColumns.get(model);
	if (!columns) {
		columns = new Map();
		modelColumns.set(model, columns);
	}

	columns.set(propertyKey, {
		propertyKey,
		columnName: options.name ?? propertyKey,
	});
}

function getColumnDefinitions<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): readonly ModelColumnDefinition[] {
	const definitions = new Map<string, ModelColumnDefinition>();
	const constructors: ConstructorObject[] = [];
	let current: ConstructorObject | undefined =
		model as unknown as ConstructorObject;
	const baseModel = BaseModel as unknown as ConstructorObject;

	while (current && current !== baseModel) {
		constructors.unshift(current);
		const prototype: object = current.prototype;
		const parentPrototype = Object.getPrototypeOf(prototype) as object | null;
		current =
			parentPrototype && parentPrototype !== BaseModel.prototype
				? (parentPrototype.constructor as ConstructorObject)
				: undefined;
	}

	for (const modelConstructor of constructors) {
		for (const definition of modelColumns.get(modelConstructor)?.values() ??
			[]) {
			definitions.set(definition.propertyKey, definition);
		}
	}

	return [...definitions.values()];
}

function collectModelMutationValues<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	attributes: Partial<TAttributes>,
): QueryMutationValues<TAttributes> | null {
	const columns = new Map(
		getColumnDefinitions(model).map((definition) => [
			definition.propertyKey,
			definition.columnName,
		]),
	);
	const hasColumnFilter = columns.size > 0;
	const allowedUndecoratedColumns = new Set([
		resolvePrimaryKey(model),
		resolveCreatedAtColumn(model),
		resolveUpdatedAtColumn(model),
	]);
	const values: Record<string, QueryPrimitive> = {};
	let count = 0;

	for (const key of Object.keys(attributes)) {
		const attributeKey = key as Extract<keyof TAttributes, string>;
		const value = attributes[attributeKey];
		const mappedColumn = columns.get(key);

		if (value === undefined) {
			continue;
		}

		if (
			hasColumnFilter &&
			!mappedColumn &&
			!allowedUndecoratedColumns.has(key)
		) {
			continue;
		}

		values[mappedColumn ?? key] = toQueryPrimitive(value, key);
		count += 1;
	}

	if (count === 0) {
		return null;
	}

	return values as QueryMutationValues<TAttributes>;
}

function normalizeHydratedAttributes<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	attributes: TAttributes,
): Partial<TAttributes> {
	const definitions = getColumnDefinitions(model);
	if (definitions.length === 0) {
		return attributes;
	}

	const propertyByColumn = new Map(
		definitions.map((definition) => [
			definition.columnName,
			definition.propertyKey,
		]),
	);
	const source = attributes as Record<string, unknown>;
	const normalized: Record<string, unknown> = {};

	for (const key of Object.keys(source)) {
		normalized[propertyByColumn.get(key) ?? key] = source[key];
	}

	return normalized as Partial<TAttributes>;
}

function normalizePropertyKey(propertyKey: string | symbol): string {
	if (typeof propertyKey === "symbol") {
		throw new Error("@column() cannot be used on symbol fields");
	}

	return propertyKey;
}

function isFieldDecoratorContext(
	value: string | symbol | ClassFieldDecoratorContext,
): value is ClassFieldDecoratorContext {
	return typeof value === "object" && value !== null && "kind" in value;
}

function toQueryPrimitive(
	value: unknown,
	attributeName: string,
): QueryPrimitive {
	if (isQueryPrimitive(value)) {
		return value;
	}

	throw new Error(
		`Model attribute [${attributeName}] cannot be persisted because it is not a query primitive`,
	);
}

function isQueryPrimitive(value: unknown): value is QueryPrimitive {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint" ||
		value instanceof Date ||
		value instanceof Uint8Array
	);
}

function areAttributeValuesEqual(left: unknown, right: unknown): boolean {
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() === right.getTime();
	}

	if (left instanceof Uint8Array && right instanceof Uint8Array) {
		return areByteArraysEqual(left, right);
	}

	return Object.is(left, right);
}

function areByteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) {
		return false;
	}

	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}

	return true;
}

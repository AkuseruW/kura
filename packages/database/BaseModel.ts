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

export type ModelRelationType =
	| "belongsTo"
	| "hasOne"
	| "hasMany"
	| "manyToMany";

export type RelationModelFactory<
	TRelated extends BaseModel<TRelatedAttributes>,
	TRelatedAttributes extends ModelAttributes,
> = () => ModelClass<TRelated, TRelatedAttributes>;

export type BelongsToRelationOptions = {
	readonly foreignKey?: string;
	readonly ownerKey?: string;
};

export type HasOneRelationOptions = {
	readonly foreignKey?: string;
	readonly localKey?: string;
};

export type HasManyRelationOptions = {
	readonly foreignKey?: string;
	readonly localKey?: string;
};

export type ManyToManyRelationOptions = {
	readonly pivotTable: string;
	readonly foreignPivotKey: string;
	readonly relatedPivotKey: string;
	readonly localKey?: string;
	readonly relatedKey?: string;
};

export type RelationDecorator = {
	(target: object, propertyKey: string | symbol): void;
	(value: undefined, context: ClassFieldDecoratorContext): void;
};

type StoredRelationDefinition = {
	readonly name: string;
	readonly type: ModelRelationType;
	readonly relatedModel: () => unknown;
	readonly foreignKey?: string;
	readonly localKey?: string;
	readonly ownerKey?: string;
	readonly pivotTable?: string;
	readonly foreignPivotKey?: string;
	readonly relatedPivotKey?: string;
	readonly relatedKey?: string;
};

type RelationOptions = BelongsToRelationOptions &
	HasOneRelationOptions &
	HasManyRelationOptions &
	Partial<ManyToManyRelationOptions>;

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
const modelRelations = new WeakMap<
	ConstructorObject,
	Map<string, StoredRelationDefinition>
>();
const initializedModelMetadata = new WeakSet<ConstructorObject>();
const markPersisted = Symbol("markPersisted");
const setLoadedRelation = Symbol("setLoadedRelation");
const relationMetadata = Symbol("relationMetadata");
const renameRelation = Symbol("renameRelation");

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

export function belongsTo<
	TRelatedAttributes extends ModelAttributes,
	TRelated extends BaseModel<TRelatedAttributes>,
>(
	relatedModel: RelationModelFactory<TRelated, TRelatedAttributes>,
	options: BelongsToRelationOptions = {},
): RelationDecorator {
	return relationDecorator("belongsTo", relatedModel, options);
}

export function hasOne<
	TRelatedAttributes extends ModelAttributes,
	TRelated extends BaseModel<TRelatedAttributes>,
>(
	relatedModel: RelationModelFactory<TRelated, TRelatedAttributes>,
	options: HasOneRelationOptions = {},
): RelationDecorator {
	return relationDecorator("hasOne", relatedModel, options);
}

export function hasMany<
	TRelatedAttributes extends ModelAttributes,
	TRelated extends BaseModel<TRelatedAttributes>,
>(
	relatedModel: RelationModelFactory<TRelated, TRelatedAttributes>,
	options: HasManyRelationOptions = {},
): RelationDecorator {
	return relationDecorator("hasMany", relatedModel, options);
}

export function manyToMany<
	TRelatedAttributes extends ModelAttributes,
	TRelated extends BaseModel<TRelatedAttributes>,
>(
	relatedModel: RelationModelFactory<TRelated, TRelatedAttributes>,
	options: ManyToManyRelationOptions,
): RelationDecorator {
	return relationDecorator("manyToMany", relatedModel, options);
}

function relationDecorator(
	type: ModelRelationType,
	relatedModel: () => unknown,
	options: RelationOptions,
): RelationDecorator {
	const decorator = (
		targetOrValue: object | undefined,
		propertyOrContext: string | symbol | ClassFieldDecoratorContext,
	): void => {
		if (isFieldDecoratorContext(propertyOrContext)) {
			if (propertyOrContext.private) {
				throw new Error(`@${type}() cannot be used on private fields`);
			}

			const propertyKey = normalizePropertyKey(propertyOrContext.name);
			propertyOrContext.addInitializer(function initializeRelation(
				this: unknown,
			) {
				if (typeof this !== "object" || this === null) {
					throw new Error(`@${type}() initializer target is invalid`);
				}

				registerRelation(
					this.constructor as ConstructorObject,
					propertyKey,
					type,
					relatedModel,
					options,
				);
			});
			return;
		}

		if (!targetOrValue) {
			throw new Error(`@${type}() decorator target is invalid`);
		}

		registerRelation(
			targetOrValue.constructor as ConstructorObject,
			normalizePropertyKey(propertyOrContext),
			type,
			relatedModel,
			options,
		);
	};

	return decorator as RelationDecorator;
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

type ResolvedRelationDefinition = {
	readonly name: string;
	readonly type: ModelRelationType;
	readonly foreignKey?: string;
	readonly localKey?: string;
	readonly ownerKey?: string;
	readonly pivotTable?: string;
	readonly foreignPivotKey?: string;
	readonly relatedPivotKey?: string;
	readonly relatedKey?: string;
};

type RelationQueryKey = {
	readonly column: string;
	readonly value: QueryPrimitive;
	readonly sourceKey: string;
};

type AnyModelClass = ModelClass<BaseModel, ModelAttributes>;

type ModelRelationMetadata = {
	readonly name: string;
	readonly type: ModelRelationType;
	readonly parentModel: AnyModelClass;
	readonly relatedModel: AnyModelClass;
	readonly foreignKey?: string;
	readonly localKey?: string;
	readonly ownerKey?: string;
	readonly pivotTable?: string;
	readonly foreignPivotKey?: string;
	readonly relatedPivotKey?: string;
	readonly relatedKey?: string;
};

type ResolvedManyToManyOptions = {
	readonly pivotTable: string;
	readonly foreignPivotKey: string;
	readonly relatedPivotKey: string;
	readonly localKey: string;
	readonly relatedKey: string;
};

type RelationMetadataProvider = {
	[relationMetadata](): ModelRelationMetadata;
};

type RelationValueSource = {
	toObject(): object;
};

type PreloadableModel = RelationValueSource & {
	relation(name: string): RelationMetadataProvider;
	[setLoadedRelation](name: string, value: unknown): void;
};

export class ModelRelation<
	TParent extends BaseModel<TParentAttributes>,
	TParentAttributes extends ModelAttributes,
	TRelated extends BaseModel<TRelatedAttributes>,
	TRelatedAttributes extends ModelAttributes,
> {
	readonly type: ModelRelationType;

	constructor(
		private readonly parent: TParent,
		private readonly parentModel: ModelClass<TParent, TParentAttributes>,
		private readonly relatedModel: ModelClass<TRelated, TRelatedAttributes>,
		private readonly definition: ResolvedRelationDefinition,
	) {
		this.type = definition.type;
	}

	query(): ModelQueryBuilder<TRelated, TRelatedAttributes> {
		if (this.definition.type === "manyToMany") {
			throw new Error(
				`Relation [${this.definition.name}] cannot be queried directly because it uses a pivot table`,
			);
		}

		const key = this.resolveQueryKey(true);

		return new ModelQueryBuilder(
			this.relatedModel,
			createQueryBuilder(this.relatedModel),
		).where(key.column as QueryColumn<TRelatedAttributes>, key.value);
	}

	async first(): Promise<TRelated | null> {
		if (this.definition.type === "manyToMany") {
			throw new Error(
				`Relation [${this.definition.name}] is a collection relation; use all()`,
			);
		}

		const key = this.resolveQueryKey(false);
		if (!key) {
			return null;
		}

		return new ModelQueryBuilder(
			this.relatedModel,
			createQueryBuilder(this.relatedModel),
		)
			.where(key.column as QueryColumn<TRelatedAttributes>, key.value)
			.first();
	}

	async all(): Promise<readonly TRelated[]> {
		if (this.definition.type === "manyToMany") {
			return this.allManyToMany();
		}

		const key = this.resolveQueryKey(false);
		if (!key) {
			return [];
		}

		return new ModelQueryBuilder(
			this.relatedModel,
			createQueryBuilder(this.relatedModel),
		)
			.where(key.column as QueryColumn<TRelatedAttributes>, key.value)
			.all();
	}

	[relationMetadata](): ModelRelationMetadata {
		return {
			name: this.definition.name,
			type: this.definition.type,
			parentModel: this.parentModel as unknown as AnyModelClass,
			relatedModel: this.relatedModel as unknown as AnyModelClass,
			foreignKey: this.definition.foreignKey,
			localKey: this.definition.localKey,
			ownerKey: this.definition.ownerKey,
			pivotTable: this.definition.pivotTable,
			foreignPivotKey: this.definition.foreignPivotKey,
			relatedPivotKey: this.definition.relatedPivotKey,
			relatedKey: this.definition.relatedKey,
		};
	}

	[renameRelation](
		name: string,
	): ModelRelation<TParent, TParentAttributes, TRelated, TRelatedAttributes> {
		return new ModelRelation(this.parent, this.parentModel, this.relatedModel, {
			...this.definition,
			name,
		});
	}

	private async allManyToMany(): Promise<readonly TRelated[]> {
		const options = resolveManyToManyOptions(this[relationMetadata]());
		const localValue = resolveRelationValue(this.parent, options.localKey);
		if (localValue === null) {
			return [];
		}

		const pivotRows = await createPivotQueryBuilder(
			this.parentModel,
			options.pivotTable,
		)
			.where(options.foreignPivotKey, localValue)
			.all();
		const relatedValues = collectPivotValues(
			pivotRows,
			options.relatedPivotKey,
		);
		const relatedModels =
			relatedValues.length === 0
				? []
				: await new ModelQueryBuilder(
						this.relatedModel,
						createQueryBuilder(this.relatedModel),
					)
						.where(
							resolveColumnName(
								this.relatedModel,
								options.relatedKey,
							) as QueryColumn<TRelatedAttributes>,
							"in",
							relatedValues,
						)
						.all();
		const relatedByKey = indexModelsByRelationKey(
			relatedModels,
			options.relatedKey,
		);
		const orderedRelated: TRelated[] = [];

		for (const pivotRow of pivotRows) {
			const relatedValue = resolvePivotValue(pivotRow, options.relatedPivotKey);
			if (relatedValue === null) {
				continue;
			}

			const related = relatedByKey.get(relationValueKey(relatedValue));
			if (related) {
				orderedRelated.push(related);
			}
		}

		return orderedRelated;
	}

	private resolveQueryKey(required: true): RelationQueryKey;
	private resolveQueryKey(required: false): RelationQueryKey | null;
	private resolveQueryKey(required: boolean): RelationQueryKey | null {
		const queryKey =
			this.definition.type === "belongsTo"
				? this.resolveBelongsToQueryKey()
				: this.resolveRelatedByForeignKeyQueryKey();

		if (queryKey || !required) {
			return queryKey;
		}

		throw new Error(
			`Relation [${this.definition.name}] cannot be queried because key value is missing`,
		);
	}

	private resolveBelongsToQueryKey(): RelationQueryKey | null {
		const foreignKey =
			this.definition.foreignKey ?? `${lowerFirst(this.relatedModel.name)}Id`;
		const ownerKey =
			this.definition.ownerKey ?? resolvePrimaryKey(this.relatedModel);
		const value = resolveRelationValue(this.parent, foreignKey);

		if (value === null) {
			return null;
		}

		return {
			column: resolveColumnName(this.relatedModel, ownerKey),
			value,
			sourceKey: foreignKey,
		};
	}

	private resolveRelatedByForeignKeyQueryKey(): RelationQueryKey | null {
		const localKey =
			this.definition.localKey ?? resolvePrimaryKey(this.parentModel);
		const foreignKey =
			this.definition.foreignKey ?? `${lowerFirst(this.parentModel.name)}Id`;
		const value = resolveRelationValue(this.parent, localKey);

		if (value === null) {
			return null;
		}

		return {
			column: resolveColumnName(this.relatedModel, foreignKey),
			value,
			sourceKey: localKey,
		};
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
	private loadedRelations = new Map<string, unknown>();
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
		this.loadedRelations.clear();
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

	belongsTo<
		TRelatedAttributes extends ModelAttributes,
		TRelated extends BaseModel<TRelatedAttributes>,
	>(
		relatedModel: ModelClass<TRelated, TRelatedAttributes>,
		options: BelongsToRelationOptions = {},
	): ModelRelation<this, TAttributes, TRelated, TRelatedAttributes> {
		return new ModelRelation(this, this.getModelClass(), relatedModel, {
			name: relatedModel.name,
			type: "belongsTo",
			...options,
		});
	}

	hasOne<
		TRelatedAttributes extends ModelAttributes,
		TRelated extends BaseModel<TRelatedAttributes>,
	>(
		relatedModel: ModelClass<TRelated, TRelatedAttributes>,
		options: HasOneRelationOptions = {},
	): ModelRelation<this, TAttributes, TRelated, TRelatedAttributes> {
		return new ModelRelation(this, this.getModelClass(), relatedModel, {
			name: relatedModel.name,
			type: "hasOne",
			...options,
		});
	}

	hasMany<
		TRelatedAttributes extends ModelAttributes,
		TRelated extends BaseModel<TRelatedAttributes>,
	>(
		relatedModel: ModelClass<TRelated, TRelatedAttributes>,
		options: HasManyRelationOptions = {},
	): ModelRelation<this, TAttributes, TRelated, TRelatedAttributes> {
		return new ModelRelation(this, this.getModelClass(), relatedModel, {
			name: relatedModel.name,
			type: "hasMany",
			...options,
		});
	}

	manyToMany<
		TRelatedAttributes extends ModelAttributes,
		TRelated extends BaseModel<TRelatedAttributes>,
	>(
		relatedModel: ModelClass<TRelated, TRelatedAttributes>,
		options: ManyToManyRelationOptions,
	): ModelRelation<this, TAttributes, TRelated, TRelatedAttributes> {
		return new ModelRelation(this, this.getModelClass(), relatedModel, {
			name: relatedModel.name,
			type: "manyToMany",
			...options,
		});
	}

	relation<
		TRelatedAttributes extends ModelAttributes,
		TRelated extends BaseModel<TRelatedAttributes>,
	>(
		name: string,
	): ModelRelation<this, TAttributes, TRelated, TRelatedAttributes> {
		const definition = resolveRelationDefinition(this.getModelClass(), name);
		if (definition) {
			return new ModelRelation(
				this,
				this.getModelClass(),
				resolveRelationModel<TRelated, TRelatedAttributes>(definition),
				definition,
			);
		}

		const relation = this.resolveRelationMethod<TRelatedAttributes, TRelated>(
			name,
		);
		if (relation) {
			return relation;
		}

		throw new Error(
			`Relation [${name}] is not defined on model [${this.getModelClass().name}]`,
		);
	}

	async related<TRelated extends BaseModel = BaseModel>(
		name: string,
	): Promise<TRelated | null> {
		if (this.loadedRelations.has(name)) {
			return this.loadedRelations.get(name) as TRelated | null;
		}

		const relation = this.relation<ModelAttributes, BaseModel>(name);
		if (isCollectionRelation(relation.type)) {
			throw new Error(
				`Relation [${name}] on model [${this.getModelClass().name}] is a collection relation; use relatedMany()`,
			);
		}

		const related = await relation.first();
		this[setLoadedRelation](name, related);

		return related as TRelated | null;
	}

	async relatedMany<TRelated extends BaseModel = BaseModel>(
		name: string,
	): Promise<readonly TRelated[]> {
		if (this.loadedRelations.has(name)) {
			return this.loadedRelations.get(name) as readonly TRelated[];
		}

		const relation = this.relation<ModelAttributes, BaseModel>(name);
		if (!isCollectionRelation(relation.type)) {
			throw new Error(
				`Relation [${name}] on model [${this.getModelClass().name}] is not a collection relation`,
			);
		}

		const related = await relation.all();
		this[setLoadedRelation](name, related);

		return related as readonly TRelated[];
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

	private resolveRelationMethod<
		TRelatedAttributes extends ModelAttributes,
		TRelated extends BaseModel<TRelatedAttributes>,
	>(
		name: string,
	): ModelRelation<this, TAttributes, TRelated, TRelatedAttributes> | null {
		const candidate = (this as unknown as Record<string, unknown>)[name];
		if (typeof candidate !== "function") {
			return null;
		}

		const relation = candidate.call(this) as unknown;
		if (relation instanceof ModelRelation) {
			return relation[renameRelation](name) as ModelRelation<
				this,
				TAttributes,
				TRelated,
				TRelatedAttributes
			>;
		}

		throw new Error(
			`Relation [${name}] on model [${this.getModelClass().name}] must return a ModelRelation`,
		);
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
		this.loadedRelations.clear();
	}

	[setLoadedRelation](name: string, value: unknown): void {
		this.loadedRelations.set(name, value);
		Object.assign(this, { [name]: value });
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

function createPivotQueryBuilder<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	table: string,
): QueryBuilder<QueryRow> {
	return resolveDatabase(model).table<QueryRow>(table, model.connection);
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

async function preloadModelRelations(
	models: readonly PreloadableModel[],
	relationNames: readonly string[],
): Promise<void> {
	if (models.length === 0 || relationNames.length === 0) {
		return;
	}

	for (const relationName of relationNames) {
		await preloadModelRelation(models, relationName);
	}
}

async function preloadModelRelation(
	models: readonly PreloadableModel[],
	relationName: string,
): Promise<void> {
	const firstModel = models[0];
	if (!firstModel) {
		return;
	}

	const relation = firstModel.relation(relationName);
	const metadata = relation[relationMetadata]();

	if (metadata.type === "belongsTo") {
		await preloadBelongsToRelation(models, metadata);
		return;
	}

	if (metadata.type === "manyToMany") {
		await preloadManyToManyRelation(models, metadata);
		return;
	}

	await preloadForeignKeyRelation(models, metadata);
}

async function preloadBelongsToRelation(
	models: readonly PreloadableModel[],
	metadata: ModelRelationMetadata,
): Promise<void> {
	const foreignKey =
		metadata.foreignKey ?? `${lowerFirst(metadata.relatedModel.name)}Id`;
	const ownerKey =
		metadata.ownerKey ?? resolvePrimaryKey(metadata.relatedModel);
	const ownerColumn = resolveColumnName(metadata.relatedModel, ownerKey);
	const foreignKeyValues = collectRelationValues(models, foreignKey);
	const relatedModels =
		foreignKeyValues.length === 0
			? []
			: await new ModelQueryBuilder(
					metadata.relatedModel,
					createQueryBuilder(metadata.relatedModel),
				)
					.where(
						ownerColumn as QueryColumn<ModelAttributes>,
						"in",
						foreignKeyValues,
					)
					.all();
	const relatedByOwnerKey = indexModelsByRelationKey(relatedModels, ownerKey);

	for (const model of models) {
		const foreignKeyValue = resolveRelationValue(model, foreignKey);
		const related =
			foreignKeyValue === null
				? null
				: (relatedByOwnerKey.get(relationValueKey(foreignKeyValue)) ?? null);
		model[setLoadedRelation](metadata.name, related);
	}
}

async function preloadForeignKeyRelation(
	models: readonly PreloadableModel[],
	metadata: ModelRelationMetadata,
): Promise<void> {
	const localKey = metadata.localKey ?? resolvePrimaryKey(metadata.parentModel);
	const foreignKey =
		metadata.foreignKey ?? `${lowerFirst(metadata.parentModel.name)}Id`;
	const foreignColumn = resolveColumnName(metadata.relatedModel, foreignKey);
	const localKeyValues = collectRelationValues(models, localKey);
	const relatedModels =
		localKeyValues.length === 0
			? []
			: await new ModelQueryBuilder(
					metadata.relatedModel,
					createQueryBuilder(metadata.relatedModel),
				)
					.where(
						foreignColumn as QueryColumn<ModelAttributes>,
						"in",
						localKeyValues,
					)
					.all();
	const relatedByForeignKey = groupModelsByRelationKey(
		relatedModels,
		foreignKey,
	);

	for (const model of models) {
		const localKeyValue = resolveRelationValue(model, localKey);
		const related =
			localKeyValue === null
				? []
				: (relatedByForeignKey.get(relationValueKey(localKeyValue)) ?? []);

		if (metadata.type === "hasMany") {
			model[setLoadedRelation](metadata.name, related);
			continue;
		}

		model[setLoadedRelation](metadata.name, related[0] ?? null);
	}
}

async function preloadManyToManyRelation(
	models: readonly PreloadableModel[],
	metadata: ModelRelationMetadata,
): Promise<void> {
	const options = resolveManyToManyOptions(metadata);
	const localKeyValues = collectRelationValues(models, options.localKey);
	const pivotRows =
		localKeyValues.length === 0
			? []
			: await createPivotQueryBuilder(metadata.parentModel, options.pivotTable)
					.where(options.foreignPivotKey, "in", localKeyValues)
					.all();
	const relatedValues = collectPivotValues(pivotRows, options.relatedPivotKey);
	const relatedModels =
		relatedValues.length === 0
			? []
			: await new ModelQueryBuilder(
					metadata.relatedModel,
					createQueryBuilder(metadata.relatedModel),
				)
					.where(
						resolveColumnName(
							metadata.relatedModel,
							options.relatedKey,
						) as QueryColumn<ModelAttributes>,
						"in",
						relatedValues,
					)
					.all();
	const relatedByKey = indexModelsByRelationKey(
		relatedModels,
		options.relatedKey,
	);
	const pivotRowsByLocalKey = groupPivotRowsByKey(
		pivotRows,
		options.foreignPivotKey,
	);

	for (const model of models) {
		const localKeyValue = resolveRelationValue(model, options.localKey);
		const matchingPivotRows =
			localKeyValue === null
				? []
				: (pivotRowsByLocalKey.get(relationValueKey(localKeyValue)) ?? []);
		model[setLoadedRelation](
			metadata.name,
			collectRelatedModelsFromPivotRows(
				matchingPivotRows,
				options.relatedPivotKey,
				relatedByKey,
			),
		);
	}
}

function collectRelationValues(
	models: readonly RelationValueSource[],
	key: string,
): readonly QueryPrimitive[] {
	const values: QueryPrimitive[] = [];
	const seen = new Set<string>();

	for (const model of models) {
		const value = resolveRelationValue(model, key);
		if (value === null) {
			continue;
		}

		const indexKey = relationValueKey(value);
		if (seen.has(indexKey)) {
			continue;
		}

		seen.add(indexKey);
		values.push(value);
	}

	return values;
}

function collectPivotValues(
	rows: readonly QueryRow[],
	key: string,
): readonly QueryPrimitive[] {
	const values: QueryPrimitive[] = [];
	const seen = new Set<string>();

	for (const row of rows) {
		const value = resolvePivotValue(row, key);
		if (value === null) {
			continue;
		}

		const indexKey = relationValueKey(value);
		if (seen.has(indexKey)) {
			continue;
		}

		seen.add(indexKey);
		values.push(value);
	}

	return values;
}

function indexModelsByRelationKey<TModel extends RelationValueSource>(
	models: readonly TModel[],
	key: string,
): ReadonlyMap<string, TModel> {
	const indexed = new Map<string, TModel>();

	for (const model of models) {
		const value = resolveRelationValue(model, key);
		if (value !== null && !indexed.has(relationValueKey(value))) {
			indexed.set(relationValueKey(value), model);
		}
	}

	return indexed;
}

function groupModelsByRelationKey<TModel extends RelationValueSource>(
	models: readonly TModel[],
	key: string,
): ReadonlyMap<string, readonly TModel[]> {
	const grouped = new Map<string, TModel[]>();

	for (const model of models) {
		const value = resolveRelationValue(model, key);
		if (value === null) {
			continue;
		}

		const indexKey = relationValueKey(value);
		const group = grouped.get(indexKey);
		if (group) {
			group.push(model);
			continue;
		}

		grouped.set(indexKey, [model]);
	}

	return grouped;
}

function groupPivotRowsByKey(
	rows: readonly QueryRow[],
	key: string,
): ReadonlyMap<string, readonly QueryRow[]> {
	const grouped = new Map<string, QueryRow[]>();

	for (const row of rows) {
		const value = resolvePivotValue(row, key);
		if (value === null) {
			continue;
		}

		const indexKey = relationValueKey(value);
		const group = grouped.get(indexKey);
		if (group) {
			group.push(row);
			continue;
		}

		grouped.set(indexKey, [row]);
	}

	return grouped;
}

function collectRelatedModelsFromPivotRows<TModel extends RelationValueSource>(
	pivotRows: readonly QueryRow[],
	relatedPivotKey: string,
	relatedByKey: ReadonlyMap<string, TModel>,
): readonly TModel[] {
	const relatedModels: TModel[] = [];

	for (const pivotRow of pivotRows) {
		const relatedValue = resolvePivotValue(pivotRow, relatedPivotKey);
		if (relatedValue === null) {
			continue;
		}

		const related = relatedByKey.get(relationValueKey(relatedValue));
		if (related) {
			relatedModels.push(related);
		}
	}

	return relatedModels;
}

function resolveManyToManyOptions(
	metadata: ModelRelationMetadata,
): ResolvedManyToManyOptions {
	return {
		pivotTable: requireRelationOption(metadata, "pivotTable"),
		foreignPivotKey: requireRelationOption(metadata, "foreignPivotKey"),
		relatedPivotKey: requireRelationOption(metadata, "relatedPivotKey"),
		localKey: metadata.localKey ?? resolvePrimaryKey(metadata.parentModel),
		relatedKey: metadata.relatedKey ?? resolvePrimaryKey(metadata.relatedModel),
	};
}

function requireRelationOption(
	metadata: ModelRelationMetadata,
	key: "pivotTable" | "foreignPivotKey" | "relatedPivotKey",
): string {
	const value = metadata[key]?.trim();
	if (!value) {
		throw new Error(`Relation [${metadata.name}] is missing ${key}`);
	}

	return value;
}

function isCollectionRelation(type: ModelRelationType): boolean {
	return type === "hasMany" || type === "manyToMany";
}

function relationValueKey(value: QueryPrimitive): string {
	if (value instanceof Date) {
		return `date:${value.getTime()}`;
	}

	if (value instanceof Uint8Array) {
		return `bytes:${Array.from(value).join(",")}`;
	}

	return `${typeof value}:${String(value)}`;
}

function resolvePivotValue(row: QueryRow, key: string): QueryPrimitive | null {
	const value = row[key];
	if (value === undefined || value === null) {
		return null;
	}

	if (isQueryPrimitive(value)) {
		return value;
	}

	throw new Error(`Pivot key [${key}] must be a query primitive`);
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

function registerRelation(
	model: ConstructorObject,
	name: string,
	type: ModelRelationType,
	relatedModel: () => unknown,
	options: RelationOptions,
): void {
	let relations = modelRelations.get(model);
	if (!relations) {
		relations = new Map();
		modelRelations.set(model, relations);
	}

	relations.set(name, {
		name,
		type,
		relatedModel,
		foreignKey: options.foreignKey,
		localKey: options.localKey,
		ownerKey: options.ownerKey,
		pivotTable: options.pivotTable,
		foreignPivotKey: options.foreignPivotKey,
		relatedPivotKey: options.relatedPivotKey,
		relatedKey: options.relatedKey,
	});
}

function getColumnDefinitions<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): readonly ModelColumnDefinition[] {
	ensureModelMetadata(model);
	const definitions = new Map<string, ModelColumnDefinition>();

	for (const modelConstructor of getModelConstructors(model)) {
		for (const definition of modelColumns.get(modelConstructor)?.values() ??
			[]) {
			definitions.set(definition.propertyKey, definition);
		}
	}

	return [...definitions.values()];
}

function getRelationDefinitions<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): readonly StoredRelationDefinition[] {
	ensureModelMetadata(model);
	const definitions = new Map<string, StoredRelationDefinition>();

	for (const modelConstructor of getModelConstructors(model)) {
		for (const definition of modelRelations.get(modelConstructor)?.values() ??
			[]) {
			definitions.set(definition.name, definition);
		}
	}

	return [...definitions.values()];
}

function resolveRelationDefinition<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	name: string,
): StoredRelationDefinition | undefined {
	return getRelationDefinitions(model).find(
		(definition) => definition.name === name,
	);
}

function resolveRelationModel<
	TRelated extends BaseModel<TRelatedAttributes>,
	TRelatedAttributes extends ModelAttributes,
>(
	definition: StoredRelationDefinition,
): ModelClass<TRelated, TRelatedAttributes> {
	const relatedModel = definition.relatedModel();
	if (!isModelClass(relatedModel)) {
		throw new Error(
			`Relation [${definition.name}] did not resolve to a BaseModel class`,
		);
	}

	return relatedModel as unknown as ModelClass<TRelated, TRelatedAttributes>;
}

function getModelConstructors<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): readonly ConstructorObject[] {
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

	return constructors;
}

function ensureModelMetadata<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): void {
	const modelConstructor = model as unknown as ConstructorObject;
	if (initializedModelMetadata.has(modelConstructor)) {
		return;
	}

	initializedModelMetadata.add(modelConstructor);
	new model();
}

function resolveColumnName<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>, key: string): string {
	return (
		getColumnDefinitions(model).find(
			(definition) => definition.propertyKey === key,
		)?.columnName ?? key
	);
}

function resolveRelationValue(
	model: RelationValueSource,
	key: string,
): QueryPrimitive | null {
	const attributes = model.toObject() as Record<string, unknown>;
	const value = Object.hasOwn(attributes, key)
		? attributes[key]
		: (model as unknown as Record<string, unknown>)[key];

	if (value === undefined || value === null) {
		return null;
	}

	if (isQueryPrimitive(value)) {
		return value;
	}

	throw new Error(`Relation key [${key}] must be a query primitive`);
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

function isModelClass(
	value: unknown,
): value is ModelClass<BaseModel<ModelAttributes>, ModelAttributes> {
	return typeof value === "function" && value.prototype instanceof BaseModel;
}

function lowerFirst(value: string): string {
	return value.length === 0
		? value
		: `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
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

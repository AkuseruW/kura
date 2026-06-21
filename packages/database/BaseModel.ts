// biome-ignore-all lint/complexity/noThisInStatic: Active Record static APIs resolve subclass constructors through this.
import { BaseException } from "../core/BaseException";
import type { DatabaseManager, QueryPrimitive } from "./Database";
import { hydrateModel } from "./ModelHydration";
import {
	getModelHookDefinitions as getStoredModelHookDefinitions,
	resolveRelationDefinition as resolveStoredRelationDefinition,
} from "./ModelMetadata";
import {
	collectModelMutationValues as collectModelMutationValuesForModel,
	createPivotQueryBuilder,
	createQueryBuilder,
	resolveCreatedAtColumn,
	resolveColumnName as resolveModelColumnName,
	resolvePrimaryKey,
	resolveRelationValue,
	resolveUpdatedAtColumn,
	usesTimestamps,
} from "./ModelOperations";
import { ModelQueryBuilder } from "./ModelQueryBuilder";
import {
	collectPivotValues,
	indexModelsByRelationKey,
	isCollectionRelation,
	resolveManyToManyOptions,
} from "./ModelRelationHelpers";
import {
	markPersisted,
	relationMetadata,
	renameRelation,
	setLoadedRelation,
} from "./ModelSymbols";
import type {
	AnyModelClass,
	BelongsToRelationOptions,
	HasManyRelationOptions,
	HasOneRelationOptions,
	ManyToManyRelationOptions,
	ModelAttributes,
	ModelClass,
	ModelHookInvoker,
	ModelHookName,
	ModelRelationMetadata,
	ModelRelationType,
	StoredRelationDefinition,
} from "./ModelTypes";
import {
	areAttributeValuesEqual,
	isQueryPrimitive,
	lowerFirst,
	relationValueKey,
	resolvePivotValue,
} from "./ModelValues";
import type { QueryColumn } from "./QueryBuilder";

export {
	afterCreate,
	afterSave,
	beforeCreate,
	beforeDelete,
	beforeSave,
	belongsTo,
	column,
	hasMany,
	hasOne,
	manyToMany,
} from "./ModelMetadata";
export { ModelQueryBuilder } from "./ModelQueryBuilder";
export type {
	BelongsToRelationOptions,
	ColumnDecorator,
	HasManyRelationOptions,
	HasOneRelationOptions,
	ManyToManyRelationOptions,
	ModelAttributes,
	ModelClass,
	ModelColumnDefinition,
	ModelColumnOptions,
	ModelHookCallback,
	ModelHookDecorator,
	ModelHookName,
	ModelHookResult,
	ModelPaginatedResult,
	ModelRelationType,
	RelationDecorator,
	RelationModelFactory,
} from "./ModelTypes";

export class ModelNotFoundException extends BaseException {
	constructor(modelName: string, primaryKey: string, key: QueryPrimitive) {
		super(
			`${modelName} record was not found for ${primaryKey} [${String(key)}]`,
			"E_MODEL_NOT_FOUND",
			404,
		);
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

		if (!(await this.runHooks("beforeDelete", true))) {
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
		if (!(await this.runHooks("beforeSave", true))) {
			return this;
		}

		if (!(await this.runHooks("beforeCreate", true))) {
			return this;
		}

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
		await this.runHooks("afterCreate");
		await this.runHooks("afterSave");
		return this;
	}

	private async updateExistingModel(
		model: ModelClass<this, TAttributes>,
	): Promise<this> {
		if (!this.isDirty()) {
			return this;
		}

		if (!(await this.runHooks("beforeSave", true))) {
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
		await this.runHooks("afterSave");
		return this;
	}

	private async runHooks(
		hook: ModelHookName,
		cancellable = false,
	): Promise<boolean> {
		for (const definition of getModelHookDefinitions(
			this.getModelClass(),
			hook,
		)) {
			const host = definition.isStatic ? this.getModelClass() : this;
			const method = (host as unknown as Record<string, unknown>)[
				definition.name
			];

			if (typeof method !== "function") {
				throw new Error(
					`Model hook [${definition.hook}] method [${definition.name}] is not defined on model [${this.getModelClass().name}]`,
				);
			}

			const result = definition.isStatic
				? await (method as ModelHookInvoker).call(host, this)
				: await (method as ModelHookInvoker).call(host);

			if (cancellable && result === false) {
				return false;
			}
		}

		return true;
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

function getModelHookDefinitions<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	hook: ModelHookName,
): ReturnType<typeof getStoredModelHookDefinitions<TModel, TAttributes>> {
	return getStoredModelHookDefinitions(model, hook, BaseModel.prototype);
}

function resolveRelationDefinition<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	name: string,
): StoredRelationDefinition | undefined {
	return resolveStoredRelationDefinition(model, name, BaseModel.prototype);
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

function resolveColumnName<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>, key: string): string {
	return resolveModelColumnName(model, key, BaseModel.prototype);
}

function collectModelMutationValues<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>, attributes: Partial<TAttributes>) {
	return collectModelMutationValuesForModel(
		model,
		attributes,
		BaseModel.prototype,
	);
}

function isModelClass(
	value: unknown,
): value is ModelClass<BaseModel<ModelAttributes>, ModelAttributes> {
	return typeof value === "function" && value.prototype instanceof BaseModel;
}

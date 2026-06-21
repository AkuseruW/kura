import type { BaseModel } from "./BaseModel";
import type { DatabaseManager, QueryRow } from "./Database";
import type { PaginatedResult } from "./QueryBuilder";

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

export type ModelHookName =
	| "beforeSave"
	| "afterSave"
	| "beforeCreate"
	| "afterCreate"
	| "beforeDelete";

export type ModelHookResult = boolean | undefined;

export type ModelHookCallback<TModel extends BaseModel = BaseModel> = (
	model: TModel,
) => ModelHookResult | Promise<ModelHookResult>;

export type ModelHookDecorator = {
	(
		target: object,
		propertyKey: string | symbol,
		descriptor: PropertyDescriptor,
	): void;
	(value: ModelHookCallback, context: ClassMethodDecoratorContext): void;
};

export type StoredRelationDefinition = {
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

export type RelationOptions = BelongsToRelationOptions &
	HasOneRelationOptions &
	HasManyRelationOptions &
	Partial<ManyToManyRelationOptions>;

export type StoredModelHookDefinition = {
	readonly name: string;
	readonly hook: ModelHookName;
	readonly isStatic: boolean;
};

export type ModelHookInvoker = (
	this: unknown,
	model?: unknown,
) => ModelHookResult | Promise<ModelHookResult>;

export type ModelPaginatedResult<TModel> = Omit<
	PaginatedResult<ModelAttributes>,
	"data"
> & {
	readonly data: readonly TModel[];
};

export type ConstructorObject = {
	readonly prototype: object;
};

export type AnyModelClass = ModelClass<BaseModel, ModelAttributes>;

export type ModelRelationMetadata = {
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

export type ResolvedManyToManyOptions = {
	readonly pivotTable: string;
	readonly foreignPivotKey: string;
	readonly relatedPivotKey: string;
	readonly localKey: string;
	readonly relatedKey: string;
};

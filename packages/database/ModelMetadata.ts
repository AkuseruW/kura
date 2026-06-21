import type { BaseModel } from "./BaseModel";
import type {
	BelongsToRelationOptions,
	ColumnDecorator,
	ConstructorObject,
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
	ModelRelationType,
	RelationDecorator,
	RelationModelFactory,
	RelationOptions,
	StoredModelHookDefinition,
	StoredRelationDefinition,
} from "./ModelTypes";

const modelColumns = new WeakMap<
	ConstructorObject,
	Map<string, ModelColumnDefinition>
>();
const modelRelations = new WeakMap<
	ConstructorObject,
	Map<string, StoredRelationDefinition>
>();
const modelHooks = new WeakMap<
	ConstructorObject,
	Map<ModelHookName, Map<string, StoredModelHookDefinition>>
>();
const initializedModelMetadata = new WeakSet<ConstructorObject>();

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

export function beforeSave(): ModelHookDecorator {
	return modelHookDecorator("beforeSave");
}

export function afterSave(): ModelHookDecorator {
	return modelHookDecorator("afterSave");
}

export function beforeCreate(): ModelHookDecorator {
	return modelHookDecorator("beforeCreate");
}

export function afterCreate(): ModelHookDecorator {
	return modelHookDecorator("afterCreate");
}

export function beforeDelete(): ModelHookDecorator {
	return modelHookDecorator("beforeDelete");
}

export function getModelHookDefinitions<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	hook: ModelHookName,
	basePrototype: object,
): readonly StoredModelHookDefinition[] {
	ensureModelMetadata(model);
	const definitions = new Map<string, StoredModelHookDefinition>();

	for (const modelConstructor of getModelConstructors(model, basePrototype)) {
		for (const definition of modelHooks
			.get(modelConstructor)
			?.get(hook)
			?.values() ?? []) {
			definitions.set(
				modelHookKey(definition.name, definition.isStatic),
				definition,
			);
		}
	}

	return [...definitions.values()];
}

export function getColumnDefinitions<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	basePrototype: object,
): readonly ModelColumnDefinition[] {
	ensureModelMetadata(model);
	const definitions = new Map<string, ModelColumnDefinition>();

	for (const modelConstructor of getModelConstructors(model, basePrototype)) {
		for (const definition of modelColumns.get(modelConstructor)?.values() ??
			[]) {
			definitions.set(definition.propertyKey, definition);
		}
	}

	return [...definitions.values()];
}

export function getRelationDefinitions<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	basePrototype: object,
): readonly StoredRelationDefinition[] {
	ensureModelMetadata(model);
	const definitions = new Map<string, StoredRelationDefinition>();

	for (const modelConstructor of getModelConstructors(model, basePrototype)) {
		for (const definition of modelRelations.get(modelConstructor)?.values() ??
			[]) {
			definitions.set(definition.name, definition);
		}
	}

	return [...definitions.values()];
}

export function resolveRelationDefinition<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	name: string,
	basePrototype: object,
): StoredRelationDefinition | undefined {
	return getRelationDefinitions(model, basePrototype).find(
		(definition) => definition.name === name,
	);
}

export function resolveColumnName<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	key: string,
	basePrototype: object,
): string {
	return (
		getColumnDefinitions(model, basePrototype).find(
			(definition) => definition.propertyKey === key,
		)?.columnName ?? key
	);
}

export function resolveModelBasePrototype(model: ConstructorObject): object {
	let currentPrototype = Object.getPrototypeOf(model.prototype) as
		| object
		| null;
	let basePrototype = currentPrototype;

	while (
		currentPrototype &&
		Object.getPrototypeOf(currentPrototype) !== Object.prototype
	) {
		currentPrototype = Object.getPrototypeOf(currentPrototype) as object | null;
		basePrototype = currentPrototype;
	}

	return basePrototype ?? Object.prototype;
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

function modelHookDecorator(hook: ModelHookName): ModelHookDecorator {
	const decorator = (
		targetOrValue: object | ModelHookCallback | undefined,
		propertyOrContext: string | symbol | ClassMethodDecoratorContext,
		descriptor?: PropertyDescriptor,
	): void => {
		if (isMethodDecoratorContext(propertyOrContext)) {
			if (propertyOrContext.private) {
				throw new Error(`@${hook}() cannot be used on private methods`);
			}

			if (propertyOrContext.kind !== "method") {
				throw new Error(`@${hook}() can only be used on methods`);
			}

			const methodName = normalizeDecoratorKey(
				propertyOrContext.name,
				`@${hook}()`,
			);
			propertyOrContext.addInitializer(function initializeModelHook(
				this: unknown,
			) {
				const model = propertyOrContext.static
					? this
					: typeof this === "object" && this !== null
						? this.constructor
						: undefined;

				if (!isConstructorObject(model)) {
					throw new Error(`@${hook}() initializer target is invalid`);
				}

				registerModelHook(model, hook, methodName, propertyOrContext.static);
			});
			return;
		}

		if (!descriptor || typeof descriptor.value !== "function") {
			throw new Error(`@${hook}() can only be used on methods`);
		}

		const methodName = normalizeDecoratorKey(propertyOrContext, `@${hook}()`);

		if (typeof targetOrValue === "function") {
			registerModelHook(
				targetOrValue as unknown as ConstructorObject,
				hook,
				methodName,
				true,
			);
			return;
		}

		if (!targetOrValue) {
			throw new Error(`@${hook}() decorator target is invalid`);
		}

		registerModelHook(
			targetOrValue.constructor as ConstructorObject,
			hook,
			methodName,
			false,
		);
	};

	return decorator as ModelHookDecorator;
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

function registerModelHook(
	model: ConstructorObject,
	hook: ModelHookName,
	name: string,
	isStatic: boolean,
): void {
	let hooksByName = modelHooks.get(model);
	if (!hooksByName) {
		hooksByName = new Map();
		modelHooks.set(model, hooksByName);
	}

	let hooks = hooksByName.get(hook);
	if (!hooks) {
		hooks = new Map();
		hooksByName.set(hook, hooks);
	}

	hooks.set(modelHookKey(name, isStatic), {
		name,
		hook,
		isStatic,
	});
}

function getModelConstructors(
	model: ConstructorObject,
	basePrototype: object,
): readonly ConstructorObject[] {
	const constructors: ConstructorObject[] = [];
	let current: ConstructorObject | undefined = model;

	while (current) {
		constructors.unshift(current);
		const prototype: object = current.prototype;
		const parentPrototype = Object.getPrototypeOf(prototype) as object | null;
		current =
			parentPrototype && parentPrototype !== basePrototype
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

function normalizePropertyKey(propertyKey: string | symbol): string {
	if (typeof propertyKey === "symbol") {
		throw new Error("@column() cannot be used on symbol fields");
	}

	return propertyKey;
}

function normalizeDecoratorKey(
	propertyKey: string | symbol,
	decoratorName: string,
): string {
	if (typeof propertyKey === "symbol") {
		throw new Error(`${decoratorName} cannot be used on symbol methods`);
	}

	return propertyKey;
}

function isFieldDecoratorContext(
	value: string | symbol | ClassFieldDecoratorContext,
): value is ClassFieldDecoratorContext {
	return typeof value === "object" && value !== null && "kind" in value;
}

function isMethodDecoratorContext(
	value: string | symbol | ClassMethodDecoratorContext,
): value is ClassMethodDecoratorContext {
	return typeof value === "object" && value !== null && "kind" in value;
}

function isConstructorObject(value: unknown): value is ConstructorObject {
	const candidate = value as { readonly prototype?: unknown };

	return (
		typeof value === "function" &&
		typeof candidate.prototype === "object" &&
		candidate.prototype !== null
	);
}

function modelHookKey(name: string, isStatic: boolean): string {
	return `${isStatic ? "static" : "instance"}:${name}`;
}

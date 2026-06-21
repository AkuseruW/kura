import type { QueryPrimitive } from "./Database";
import { hydrateModel } from "./ModelHydration";
import { resolveModelBasePrototype } from "./ModelMetadata";
import {
	createPivotQueryBuilder,
	createQueryBuilder,
	type RelationValueSource,
	resolveColumnName,
	resolvePrimaryKey,
	resolveRelationValue,
} from "./ModelOperations";
import {
	collectPivotValues,
	collectRelatedModelsFromPivotRows,
	collectRelationValues,
	groupModelsByRelationKey,
	groupPivotRowsByKey,
	indexModelsByRelationKey,
	resolveManyToManyOptions,
} from "./ModelRelationHelpers";
import { relationMetadata, setLoadedRelation } from "./ModelSymbols";
import type {
	AnyModelClass,
	ModelAttributes,
	ModelRelationMetadata,
} from "./ModelTypes";
import { lowerFirst, relationValueKey } from "./ModelValues";
import type { QueryColumn } from "./QueryBuilder";

type RelationMetadataProvider = {
	[relationMetadata](): ModelRelationMetadata;
};

export type PreloadableModel = RelationValueSource & {
	relation(name: string): RelationMetadataProvider;
	[setLoadedRelation](name: string, value: unknown): void;
};

export async function preloadModelRelations(
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
	const ownerColumn = resolveColumnName(
		metadata.relatedModel,
		ownerKey,
		resolveModelBasePrototype(metadata.relatedModel),
	);
	const foreignKeyValues = collectRelationValues(models, foreignKey);
	const relatedModels =
		foreignKeyValues.length === 0
			? []
			: await queryRelatedModels(
					metadata.relatedModel,
					ownerColumn,
					foreignKeyValues,
				);
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
	const foreignColumn = resolveColumnName(
		metadata.relatedModel,
		foreignKey,
		resolveModelBasePrototype(metadata.relatedModel),
	);
	const localKeyValues = collectRelationValues(models, localKey);
	const relatedModels =
		localKeyValues.length === 0
			? []
			: await queryRelatedModels(
					metadata.relatedModel,
					foreignColumn,
					localKeyValues,
				);
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
			: await queryRelatedModels(
					metadata.relatedModel,
					resolveColumnName(
						metadata.relatedModel,
						options.relatedKey,
						resolveModelBasePrototype(metadata.relatedModel),
					),
					relatedValues,
				);
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

async function queryRelatedModels(
	model: AnyModelClass,
	column: string,
	values: readonly QueryPrimitive[],
): Promise<readonly RelationValueSource[]> {
	const rows = await createQueryBuilder(model)
		.where(column as QueryColumn<ModelAttributes>, "in", values)
		.all();

	return rows.map((row) => hydrateModel(model, row));
}

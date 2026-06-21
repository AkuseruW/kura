import type { QueryPrimitive, QueryRow } from "./Database";
import {
	type RelationValueSource,
	resolvePrimaryKey,
	resolveRelationValue,
} from "./ModelOperations";
import type {
	ModelRelationMetadata,
	ModelRelationType,
	ResolvedManyToManyOptions,
} from "./ModelTypes";
import { relationValueKey, resolvePivotValue } from "./ModelValues";

export function collectRelationValues(
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

export function collectPivotValues(
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

export function indexModelsByRelationKey<TModel extends RelationValueSource>(
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

export function groupModelsByRelationKey<TModel extends RelationValueSource>(
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

export function groupPivotRowsByKey(
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

export function collectRelatedModelsFromPivotRows<
	TModel extends RelationValueSource,
>(
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

export function resolveManyToManyOptions(
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

export function isCollectionRelation(type: ModelRelationType): boolean {
	return type === "hasMany" || type === "manyToMany";
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

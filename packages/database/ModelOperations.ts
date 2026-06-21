import type { BaseModel } from "./BaseModel";
import type { DatabaseManager, QueryPrimitive, QueryRow } from "./Database";
import {
	getColumnDefinitions,
	resolveColumnName as resolveStoredColumnName,
} from "./ModelMetadata";
import type { ModelAttributes, ModelClass } from "./ModelTypes";
import { isQueryPrimitive, toQueryPrimitive } from "./ModelValues";
import type { QueryBuilder, QueryMutationValues } from "./QueryBuilder";

export type RelationValueSource = {
	toObject(): object;
};

export function createQueryBuilder<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): QueryBuilder<TAttributes> {
	return resolveDatabase(model).table<TAttributes>(
		resolveTable(model),
		model.connection,
	);
}

export function createPivotQueryBuilder<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	table: string,
): QueryBuilder<QueryRow> {
	return resolveDatabase(model).table<QueryRow>(table, model.connection);
}

export function resolveDatabase<
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

export function resolveTable<
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

export function resolvePrimaryKey<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): string {
	return model.primaryKey ?? "id";
}

export function resolveCreatedAtColumn<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): string {
	return model.createdAtColumn ?? "createdAt";
}

export function resolveUpdatedAtColumn<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): string {
	return model.updatedAtColumn ?? "updatedAt";
}

export function usesTimestamps<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>): boolean {
	return model.timestamps ?? true;
}

export function resolveColumnName<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	key: string,
	basePrototype: object,
): string {
	return resolveStoredColumnName(model, key, basePrototype);
}

export function resolveRelationValue(
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

export function collectModelMutationValues<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	attributes: Partial<TAttributes>,
	basePrototype: object,
): QueryMutationValues<TAttributes> | null {
	const columns = new Map(
		getColumnDefinitions(model, basePrototype).map((definition) => [
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

export function normalizeHydratedAttributes<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(
	model: ModelClass<TModel, TAttributes>,
	attributes: TAttributes,
	basePrototype: object,
): Partial<TAttributes> {
	const definitions = getColumnDefinitions(model, basePrototype);
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

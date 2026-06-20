import type { QueryPrimitive, QueryRow } from "./Database";

export function lowerFirst(value: string): string {
	return value.length === 0
		? value
		: `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

export function toQueryPrimitive(
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

export function isQueryPrimitive(value: unknown): value is QueryPrimitive {
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

export function areAttributeValuesEqual(
	left: unknown,
	right: unknown,
): boolean {
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() === right.getTime();
	}

	if (left instanceof Uint8Array && right instanceof Uint8Array) {
		return areByteArraysEqual(left, right);
	}

	return Object.is(left, right);
}

export function relationValueKey(value: QueryPrimitive): string {
	if (value instanceof Date) {
		return `date:${value.getTime()}`;
	}

	if (value instanceof Uint8Array) {
		return `bytes:${Array.from(value).join(",")}`;
	}

	return `${typeof value}:${String(value)}`;
}

export function resolvePivotValue(
	row: QueryRow,
	key: string,
): QueryPrimitive | null {
	const value = row[key];
	if (value === undefined || value === null) {
		return null;
	}

	if (isQueryPrimitive(value)) {
		return value;
	}

	throw new Error(`Pivot key [${key}] must be a query primitive`);
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

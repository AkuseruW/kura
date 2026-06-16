import type { DatabaseManager, QueryPrimitive } from "../database/Database";

export type Infer<TSchema> =
	TSchema extends Schema<infer TValue> ? TValue : never;

type ObjectShape = Record<string, Schema<unknown>>;
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type OptionalShapeKeys<TShape extends ObjectShape> = {
	[K in keyof TShape]: undefined extends Infer<TShape[K]> ? K : never;
}[keyof TShape];
type RequiredShapeKeys<TShape extends ObjectShape> = Exclude<
	keyof TShape,
	OptionalShapeKeys<TShape>
>;
type InferObject<TShape extends ObjectShape> = Simplify<
	{
		[K in RequiredShapeKeys<TShape>]: Infer<TShape[K]>;
	} & {
		[K in OptionalShapeKeys<TShape>]?: Exclude<Infer<TShape[K]>, undefined>;
	}
>;
type AsyncValidationRule = (
	value: unknown,
	context: AsyncValidationContext,
) => Promise<boolean>;
type AsyncParser<T> = (
	value: unknown,
	context: AsyncValidationContext,
) => Promise<T>;
type ObjectField<T> = T extends object ? Extract<keyof T, string> : never;
type CrossFieldValidationRule = {
	readonly field: string;
	readonly validate: (value: Record<string, unknown>) => boolean;
};

export type AsyncValidationContext = {
	readonly database?: DatabaseManager;
};

export type DatabaseValidationOptions = {
	readonly database?: DatabaseManager;
	readonly connection?: string;
};

export class Schema<T = unknown> {
	private rules: ((value: unknown) => boolean)[] = [];
	private asyncRules: AsyncValidationRule[] = [];
	private _type: string = "unknown";
	private parser: (value: unknown) => T = (value) => value as T;
	private asyncParser?: AsyncParser<T>;
	private acceptsUndefined = false;
	private acceptsNull = false;
	private requiresAsyncRules = false;
	private crossFieldRules: CrossFieldValidationRule[] = [];

	string(): Schema<string> {
		const schema = new Schema<string>();
		schema._type = "string";
		schema.rules.push((v) => typeof v === "string");
		return schema;
	}

	email(this: Schema<string>): Schema<string> {
		this.rules.push(
			(v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
		);
		return this;
	}

	regex(this: Schema<string>, pattern: RegExp): Schema<string> {
		const expression = new RegExp(pattern.source, pattern.flags);

		this.rules.push((v) => {
			if (typeof v !== "string") {
				return false;
			}

			expression.lastIndex = 0;
			return expression.test(v);
		});
		return this;
	}

	url(this: Schema<string>): Schema<string> {
		this.rules.push((v) => {
			if (typeof v !== "string") {
				return false;
			}

			try {
				new URL(v);
				return true;
			} catch {
				return false;
			}
		});
		return this;
	}

	number(): Schema<number> {
		const schema = new Schema<number>();
		schema._type = "number";
		schema.rules.push((v) => typeof v === "number");
		return schema;
	}

	min(this: Schema<string>, value: number): Schema<string>;
	min(this: Schema<number>, value: number): Schema<number>;
	min<U>(this: Schema<U[]>, value: number): Schema<U[]>;
	min(
		this: Schema<string> | Schema<number> | Schema<unknown[]>,
		value: number,
	): Schema<string> | Schema<number> | Schema<unknown[]> {
		this.rules.push((v) => {
			if (typeof v === "string") {
				return v.length >= value;
			}

			if (typeof v === "number") {
				return v >= value;
			}

			if (Array.isArray(v)) {
				return v.length >= value;
			}

			return false;
		});
		return this;
	}

	max(this: Schema<string>, value: number): Schema<string>;
	max(this: Schema<number>, value: number): Schema<number>;
	max<U>(this: Schema<U[]>, value: number): Schema<U[]>;
	max(
		this: Schema<string> | Schema<number> | Schema<unknown[]>,
		value: number,
	): Schema<string> | Schema<number> | Schema<unknown[]> {
		this.rules.push((v) => {
			if (typeof v === "string") {
				return v.length <= value;
			}

			if (typeof v === "number") {
				return v <= value;
			}

			if (Array.isArray(v)) {
				return v.length <= value;
			}

			return false;
		});
		return this;
	}

	integer(this: Schema<number>): Schema<number> {
		this.rules.push((v) => typeof v === "number" && Number.isInteger(v));
		return this;
	}

	positive(this: Schema<number>): Schema<number> {
		this.rules.push((v) => typeof v === "number" && v > 0);
		return this;
	}

	optional(): Schema<T | undefined> {
		this.acceptsUndefined = true;
		return this as Schema<T | undefined>;
	}

	nullable(): Schema<T | null> {
		this.acceptsNull = true;
		return this as Schema<T | null>;
	}

	boolean(): Schema<boolean> {
		const schema = new Schema<boolean>();
		schema._type = "boolean";
		schema.rules.push((v) => typeof v === "boolean");
		return schema;
	}

	array<U>(itemSchema?: Schema<U>): Schema<U[]> {
		const schema = new Schema<U[]>();
		schema._type = "array";
		schema.rules.push((v) => Array.isArray(v));
		if (itemSchema) {
			schema.requiresAsyncRules = itemSchema.requiresAsyncValidation();
			if (!itemSchema.requiresAsyncValidation()) {
				schema.rules.push((v) =>
					(v as unknown[]).every((item) => {
						try {
							itemSchema.parse(item);
							return true;
						} catch {
							return false;
						}
					}),
				);
			}
			schema.parser = (v) =>
				(v as unknown[]).map((item) => itemSchema.parse(item));
			schema.asyncParser = async (v, context) =>
				Promise.all(
					(v as unknown[]).map((item) => itemSchema.parseAsync(item, context)),
				);
		}
		return schema;
	}

	distinct<U>(this: Schema<U[]>): Schema<U[]> {
		this.rules.push((v) => Array.isArray(v) && new Set(v).size === v.length);
		return this;
	}

	object<U extends ObjectShape>(shape: U): Schema<InferObject<U>> {
		type Result = InferObject<U>;
		const schema = new Schema<Result>();
		schema._type = "object";
		schema.requiresAsyncRules = Object.values(shape).some((fieldSchema) =>
			fieldSchema.requiresAsyncValidation(),
		);
		schema.rules.push((v) => typeof v === "object" && v !== null);
		schema.rules.push((v) => {
			const obj = v as Record<string, unknown>;
			for (const [key, fieldSchema] of Object.entries(shape)) {
				if (fieldSchema.requiresAsyncValidation()) {
					continue;
				}

				try {
					fieldSchema.parse(obj[key]);
				} catch {
					return false;
				}
			}
			return true;
		});
		schema.parser = (v) => {
			const obj = v as Record<string, unknown>;
			const result: Record<string, unknown> = { ...obj };
			for (const [key, fieldSchema] of Object.entries(shape)) {
				result[key] = fieldSchema.parse(obj[key]);
			}
			return result as Result;
		};
		schema.asyncParser = async (v, context) => {
			const obj = v as Record<string, unknown>;
			const result: Record<string, unknown> = { ...obj };
			for (const [key, fieldSchema] of Object.entries(shape)) {
				result[key] = await fieldSchema.parseAsync(obj[key], context);
			}
			return result as Result;
		};
		return schema;
	}

	file(): Schema<File> {
		const schema = new Schema<File>();
		schema._type = "file";
		schema.rules.push((v) => v instanceof File);
		return schema;
	}

	maxSize(this: Schema<File>, bytes: number): Schema<File> {
		const maxBytes = parseNonNegativeNumber(bytes, "maxSize");

		this.rules.push((v) => v instanceof File && v.size <= maxBytes);
		return this;
	}

	mimeTypes(this: Schema<File>, mimeTypes: string[]): Schema<File> {
		const allowed = new Set(mimeTypes.map((type) => type.toLowerCase()));

		this.rules.push(
			(v) => v instanceof File && allowed.has(v.type.toLowerCase()),
		);
		return this;
	}

	extensions(this: Schema<File>, extensions: string[]): Schema<File> {
		const allowed = new Set(extensions.map(normalizeExtension));

		this.rules.push((v) => {
			if (!(v instanceof File)) {
				return false;
			}

			const extension = getFileExtension(v.name);
			return extension !== null && allowed.has(extension);
		});
		return this;
	}

	enum<const U extends string>(values: readonly U[]): Schema<U> {
		const schema = new Schema<U>();
		schema._type = "enum";
		schema.rules.push((v) => typeof v === "string" && values.includes(v as U));
		return schema;
	}

	date(): Schema<Date> {
		const schema = new Schema<Date>();
		schema._type = "date";
		schema.rules.push(
			(v) =>
				isValidDate(v) ||
				(typeof v === "string" && !Number.isNaN(Date.parse(v))),
		);
		schema.parser = (v) => (v instanceof Date ? v : new Date(v as string));
		return schema;
	}

	before(this: Schema<Date>, date: Date | string): Schema<Date> {
		const boundary = parseDateRule(date, "before");

		this.rules.push((v) => isDateInputBefore(v, boundary));
		return this;
	}

	after(this: Schema<Date>, date: Date | string): Schema<Date> {
		const boundary = parseDateRule(date, "after");

		this.rules.push((v) => isDateInputAfter(v, boundary));
		return this;
	}

	unique(
		table: string,
		column: string,
		options: DatabaseValidationOptions = {},
	): this {
		this.addDatabaseRule(
			"unique",
			table,
			column,
			options,
			(count) => count === 0,
		);
		return this;
	}

	exists(
		table: string,
		column: string,
		options: DatabaseValidationOptions = {},
	): this {
		this.addDatabaseRule(
			"exists",
			table,
			column,
			options,
			(count) => count > 0,
		);
		return this;
	}

	same<TField extends ObjectField<T>>(
		field: TField,
		otherField: ObjectField<T>,
	): Schema<T> {
		const fieldName = String(field);
		const otherFieldName = String(otherField);

		return this.addCrossFieldRule(fieldName, (value) => {
			const fieldValue = value[fieldName];
			const otherValue = value[otherFieldName];

			if (!isPresent(fieldValue)) {
				return true;
			}

			return isPresent(otherValue) && valuesMatch(fieldValue, otherValue);
		});
	}

	different<TField extends ObjectField<T>>(
		field: TField,
		otherField: ObjectField<T>,
	): Schema<T> {
		const fieldName = String(field);
		const otherFieldName = String(otherField);

		return this.addCrossFieldRule(fieldName, (value) => {
			const fieldValue = value[fieldName];
			const otherValue = value[otherFieldName];

			if (!isPresent(fieldValue)) {
				return true;
			}

			return isPresent(otherValue) && !valuesMatch(fieldValue, otherValue);
		});
	}

	confirmed<TField extends ObjectField<T>>(
		field: TField,
		confirmationField?: ObjectField<T>,
	): Schema<T> {
		const fieldName = String(field);
		const targetField = confirmationField
			? String(confirmationField)
			: `${fieldName}Confirmation`;

		return this.addCrossFieldRule(targetField, (value) => {
			const fieldValue = value[fieldName];
			const targetValue = value[targetField];

			if (!isPresent(fieldValue)) {
				return true;
			}

			return isPresent(targetValue) && valuesMatch(fieldValue, targetValue);
		});
	}

	requiredIf<TField extends ObjectField<T>, TOtherField extends ObjectField<T>>(
		field: TField,
		otherField: TOtherField,
		expectedValue: T[TOtherField],
	): Schema<T> {
		const fieldName = String(field);
		const otherFieldName = String(otherField);

		return this.addCrossFieldRule(fieldName, (value) => {
			if (!valuesMatch(value[otherFieldName], expectedValue)) {
				return true;
			}

			return isPresent(value[fieldName]);
		});
	}

	requiredWith<TField extends ObjectField<T>>(
		field: TField,
		...otherFields: ObjectField<T>[]
	): Schema<T> {
		assertHasCompanionFields(otherFields, "requiredWith");
		const fieldName = String(field);
		const otherFieldNames = otherFields.map(String);

		return this.addCrossFieldRule(fieldName, (value) => {
			if (!otherFieldNames.some((otherField) => isPresent(value[otherField]))) {
				return true;
			}

			return isPresent(value[fieldName]);
		});
	}

	requiredWithout<TField extends ObjectField<T>>(
		field: TField,
		...otherFields: ObjectField<T>[]
	): Schema<T> {
		assertHasCompanionFields(otherFields, "requiredWithout");
		const fieldName = String(field);
		const otherFieldNames = otherFields.map(String);

		return this.addCrossFieldRule(fieldName, (value) => {
			if (
				!otherFieldNames.some((otherField) => !isPresent(value[otherField]))
			) {
				return true;
			}

			return isPresent(value[fieldName]);
		});
	}

	parse(value: unknown): T {
		if (value === undefined && this.acceptsUndefined) {
			return undefined as T;
		}

		if (value === null && this.acceptsNull) {
			return null as T;
		}

		if (this.requiresAsyncValidation()) {
			throw new Error("Async validation rules require parseAsync()");
		}

		for (const rule of this.rules) {
			if (!rule(value)) {
				throw new Error(`Validation failed for ${this._type}`);
			}
		}

		const parsed = this.parser(value);
		this.validateCrossFields(parsed);
		return parsed;
	}

	async parseAsync(
		value: unknown,
		context: AsyncValidationContext = {},
	): Promise<T> {
		if (value === undefined && this.acceptsUndefined) {
			return undefined as T;
		}

		if (value === null && this.acceptsNull) {
			return null as T;
		}

		for (const rule of this.rules) {
			if (!rule(value)) {
				throw new Error(`Validation failed for ${this._type}`);
			}
		}

		for (const rule of this.asyncRules) {
			if (!(await rule(value, context))) {
				throw new Error(`Validation failed for ${this._type}`);
			}
		}

		if (this.asyncParser) {
			const parsed = await this.asyncParser(value, context);
			this.validateCrossFields(parsed);
			return parsed;
		}

		const parsed = this.parser(value);
		this.validateCrossFields(parsed);
		return parsed;
	}

	async validateAsync(
		value: unknown,
		context: AsyncValidationContext = {},
	): Promise<boolean> {
		try {
			await this.parseAsync(value, context);
			return true;
		} catch {
			return false;
		}
	}

	private addDatabaseRule(
		ruleName: "unique" | "exists",
		table: string,
		column: string,
		options: DatabaseValidationOptions,
		predicate: (count: number) => boolean,
	): void {
		this.requiresAsyncRules = true;
		this.asyncRules.push(async (value, context) => {
			const database = options.database ?? context.database;
			if (!database) {
				throw new Error(
					`Database manager is required for ${ruleName} validation`,
				);
			}

			const count = await database
				.table(table, options.connection)
				.where(column, toQueryPrimitive(value))
				.count();
			return predicate(count);
		});
	}

	private addCrossFieldRule(
		field: string,
		validate: (value: Record<string, unknown>) => boolean,
	): this {
		this.crossFieldRules.push({ field, validate });
		return this;
	}

	private validateCrossFields(value: T): void {
		if (this.crossFieldRules.length === 0) {
			return;
		}

		if (!isRecord(value)) {
			throw new Error(`Validation failed for ${this._type}`);
		}

		for (const rule of this.crossFieldRules) {
			if (!rule.validate(value)) {
				throw new Error(`Validation failed for object field [${rule.field}]`);
			}
		}
	}

	private requiresAsyncValidation(): boolean {
		return this.requiresAsyncRules || this.asyncRules.length > 0;
	}
}

export const v = new Schema();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent(value: unknown): boolean {
	return value !== undefined && value !== null && value !== "";
}

function valuesMatch(left: unknown, right: unknown): boolean {
	if (left instanceof Date && right instanceof Date) {
		return left.getTime() === right.getTime();
	}

	return Object.is(left, right);
}

function assertHasCompanionFields(fields: string[], ruleName: string): void {
	if (fields.length === 0) {
		throw new Error(`${ruleName} requires at least one companion field`);
	}
}

function isValidDate(value: unknown): value is Date {
	return value instanceof Date && !Number.isNaN(value.getTime());
}

function parseDateRule(value: Date | string, ruleName: string): Date {
	const date = value instanceof Date ? value : new Date(value);

	if (!isValidDate(date)) {
		throw new Error(`Invalid date for ${ruleName} rule`);
	}

	return date;
}

function parseDateInput(value: unknown): Date | null {
	if (isValidDate(value)) {
		return value;
	}

	if (typeof value !== "string") {
		return null;
	}

	const date = new Date(value);
	return isValidDate(date) ? date : null;
}

function isDateInputBefore(value: unknown, boundary: Date): boolean {
	const date = parseDateInput(value);
	return date !== null && date.getTime() < boundary.getTime();
}

function isDateInputAfter(value: unknown, boundary: Date): boolean {
	const date = parseDateInput(value);
	return date !== null && date.getTime() > boundary.getTime();
}

function parseNonNegativeNumber(value: number, ruleName: string): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid number for ${ruleName} rule`);
	}

	return value;
}

function normalizeExtension(extension: string): string {
	return extension.replace(/^\./, "").toLowerCase();
}

function getFileExtension(filename: string): string | null {
	const extensionStart = filename.lastIndexOf(".");

	if (extensionStart < 0 || extensionStart === filename.length - 1) {
		return null;
	}

	return filename.slice(extensionStart + 1).toLowerCase();
}

function toQueryPrimitive(value: unknown): QueryPrimitive {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint" ||
		value === null ||
		value instanceof Date ||
		value instanceof Uint8Array
	) {
		return value;
	}

	throw new Error("Database validation value must be a query primitive");
}

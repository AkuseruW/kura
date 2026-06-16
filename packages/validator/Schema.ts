export class Schema<T = unknown> {
	private rules: ((value: unknown) => boolean)[] = [];
	private _type: string = "unknown";
	private parser: (value: unknown) => T = (value) => value as T;

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
			schema.parser = (v) =>
				(v as unknown[]).map((item) => itemSchema.parse(item));
		}
		return schema;
	}

	distinct<U>(this: Schema<U[]>): Schema<U[]> {
		this.rules.push((v) => Array.isArray(v) && new Set(v).size === v.length);
		return this;
	}

	object<U extends Record<string, Schema<unknown>>>(
		shape: U,
	): Schema<{ [K in keyof U]: U[K] extends Schema<infer V> ? V : never }> {
		type Result = { [K in keyof U]: U[K] extends Schema<infer V> ? V : never };
		const schema = new Schema<Result>();
		schema._type = "object";
		schema.rules.push((v) => typeof v === "object" && v !== null);
		schema.rules.push((v) => {
			const obj = v as Record<string, unknown>;
			for (const [key, fieldSchema] of Object.entries(shape)) {
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
		return schema;
	}

	file(): Schema<File> {
		const schema = new Schema<File>();
		schema._type = "file";
		schema.rules.push((v) => v instanceof File);
		return schema;
	}

	enum<U extends string>(values: U[]): Schema<U> {
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

	parse(value: unknown): T {
		for (const rule of this.rules) {
			if (!rule(value)) {
				throw new Error(`Validation failed for ${this._type}`);
			}
		}
		return this.parser(value);
	}
}

export const v = new Schema();

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

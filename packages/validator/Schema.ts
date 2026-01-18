export class Schema<T = unknown> {
	private rules: ((value: unknown) => boolean)[] = []
	private _type: string = 'unknown'

	string(): Schema<string> {
		const schema = new Schema<string>()
		schema._type = 'string'
		schema.rules.push((v) => typeof v === 'string')
		return schema
	}

	number(): Schema<number> {
		const schema = new Schema<number>()
		schema._type = 'number'
		schema.rules.push((v) => typeof v === 'number')
		return schema
	}

	boolean(): Schema<boolean> {
		const schema = new Schema<boolean>()
		schema._type = 'boolean'
		schema.rules.push((v) => typeof v === 'boolean')
		return schema
	}

	array<U>(itemSchema?: Schema<U>): Schema<U[]> {
		const schema = new Schema<U[]>()
		schema._type = 'array'
		schema.rules.push((v) => Array.isArray(v))
		if (itemSchema) {
			schema.rules.push((v) => (v as unknown[]).every((item) => {
				try {
					itemSchema.parse(item)
					return true
				} catch {
					return false
				}
			}))
		}
		return schema
	}

	object<U extends Record<string, Schema<any>>>(shape: U): Schema<{ [K in keyof U]: U[K] extends Schema<infer V> ? V : never }> {
		type Result = { [K in keyof U]: U[K] extends Schema<infer V> ? V : never }
		const schema = new Schema<Result>()
		schema._type = 'object'
		schema.rules.push((v) => typeof v === 'object' && v !== null)
		schema.rules.push((v) => {
			const obj = v as Record<string, unknown>
			for (const [key, fieldSchema] of Object.entries(shape)) {
				try {
					fieldSchema.parse(obj[key])
				} catch {
					return false
				}
			}
			return true
		})
		return schema
	}

	file(): Schema<File> {
		const schema = new Schema<File>()
		schema._type = 'file'
		schema.rules.push((v) => v instanceof File)
		return schema
	}

	enum<U extends string>(values: U[]): Schema<U> {
		const schema = new Schema<U>()
		schema._type = 'enum'
		schema.rules.push((v) => typeof v === 'string' && values.includes(v as U))
		return schema
	}

	date(): Schema<Date> {
		const schema = new Schema<Date>()
		schema._type = 'date'
		schema.rules.push((v) => v instanceof Date || (typeof v === 'string' && !isNaN(Date.parse(v))))
		return schema
	}

	parse(value: unknown): T {
		for (const rule of this.rules) {
			if (!rule(value)) {
				throw new Error(`Validation failed for ${this._type}`)
			}
		}
		return value as T
	}
}

export const v = new Schema()

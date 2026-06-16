import type { BaseModel, ModelAttributes, ModelClass } from "./BaseModel";

type Awaitable<T> = T | Promise<T>;

export type FactoryModelClass<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
> = ModelClass<TModel, TAttributes> & {
	create(attributes: Partial<TAttributes>): Promise<TModel>;
};

export type FactoryAttributes<TAttributes extends ModelAttributes> =
	Partial<TAttributes>;

export type FactoryContext = {
	readonly sequence: number;
	readonly index: number;
	readonly count: number;
};

export type FactoryDefinition<TAttributes extends ModelAttributes> = (
	context: FactoryContext,
) => Awaitable<FactoryAttributes<TAttributes>>;

export type FactoryState<TAttributes extends ModelAttributes> =
	| FactoryAttributes<TAttributes>
	| ((
			attributes: FactoryAttributes<TAttributes>,
			context: FactoryContext,
	  ) => Awaitable<FactoryAttributes<TAttributes>>);

export type SeederContext = {
	readonly index: number;
	readonly count: number;
};

export type SeederConstructor = new () => Seeder;
export type SeederSource = Seeder | SeederConstructor;

export type SeederRunResult = {
	readonly seeders: readonly string[];
};

type FactorySequence = {
	value: number;
};

const makeFactoryModel = Symbol("makeFactoryModel");
const createFactoryModel = Symbol("createFactoryModel");

export function defineFactory<
	TAttributes extends ModelAttributes,
	TModel extends BaseModel<TAttributes>,
>(
	model: FactoryModelClass<TModel, TAttributes>,
	definition: FactoryDefinition<TAttributes>,
): Factory<TModel, TAttributes> {
	return new Factory(model, definition);
}

export class Factory<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
> {
	constructor(
		private readonly model: FactoryModelClass<TModel, TAttributes>,
		private readonly definition: FactoryDefinition<TAttributes>,
		private readonly states: ReadonlyMap<
			string,
			FactoryState<TAttributes>
		> = new Map(),
		private readonly activeStates: readonly string[] = [],
		private readonly sequence: FactorySequence = { value: 0 },
	) {}

	state(
		name: string,
		state: FactoryState<TAttributes>,
	): Factory<TModel, TAttributes> {
		const stateName = normalizeStateName(name);
		const states = new Map(this.states);
		states.set(stateName, state);

		return new Factory(
			this.model,
			this.definition,
			states,
			this.activeStates,
			this.sequence,
		);
	}

	apply(...stateNames: readonly string[]): Factory<TModel, TAttributes> {
		const normalizedStateNames = stateNames.map(normalizeStateName);

		for (const stateName of normalizedStateNames) {
			if (!this.states.has(stateName)) {
				throw new Error(`Factory state [${stateName}] is not defined`);
			}
		}

		return new Factory(
			this.model,
			this.definition,
			this.states,
			[...this.activeStates, ...normalizedStateNames],
			this.sequence,
		);
	}

	count(amount: number): FactoryBatch<TModel, TAttributes> {
		return new FactoryBatch(this, parseNonNegativeInteger(amount, "count()"));
	}

	async make(overrides?: FactoryState<TAttributes>): Promise<TModel> {
		return this[makeFactoryModel](0, 1, overrides);
	}

	async create(overrides?: FactoryState<TAttributes>): Promise<TModel> {
		return this[createFactoryModel](0, 1, overrides);
	}

	private async buildAttributes(
		index: number,
		count: number,
		overrides?: FactoryState<TAttributes>,
	): Promise<FactoryAttributes<TAttributes>> {
		const context: FactoryContext = {
			sequence: this.nextSequence(),
			index,
			count,
		};
		let attributes = await this.definition(context);

		for (const stateName of this.activeStates) {
			const state = this.states.get(stateName);
			if (!state) {
				throw new Error(`Factory state [${stateName}] is not defined`);
			}

			attributes = {
				...attributes,
				...(await resolveFactoryState(state, attributes, context)),
			};
		}

		if (overrides) {
			attributes = {
				...attributes,
				...(await resolveFactoryState(overrides, attributes, context)),
			};
		}

		return attributes;
	}

	private nextSequence(): number {
		this.sequence.value += 1;
		return this.sequence.value;
	}

	async [makeFactoryModel](
		index: number,
		count: number,
		overrides?: FactoryState<TAttributes>,
	): Promise<TModel> {
		return new this.model(await this.buildAttributes(index, count, overrides));
	}

	async [createFactoryModel](
		index: number,
		count: number,
		overrides?: FactoryState<TAttributes>,
	): Promise<TModel> {
		return this.model.create(
			await this.buildAttributes(index, count, overrides),
		);
	}
}

export class FactoryBatch<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
> {
	constructor(
		private readonly factory: Factory<TModel, TAttributes>,
		private readonly amount: number,
	) {}

	async make(
		overrides?: FactoryState<TAttributes>,
	): Promise<readonly TModel[]> {
		const models: TModel[] = [];

		for (let index = 0; index < this.amount; index += 1) {
			models.push(
				await this.factory[makeFactoryModel](index, this.amount, overrides),
			);
		}

		return models;
	}

	async create(
		overrides?: FactoryState<TAttributes>,
	): Promise<readonly TModel[]> {
		const models: TModel[] = [];

		for (let index = 0; index < this.amount; index += 1) {
			models.push(
				await this.factory[createFactoryModel](index, this.amount, overrides),
			);
		}

		return models;
	}
}

export abstract class Seeder {
	abstract run(context: SeederContext): void | Promise<void>;
}

export class SeederRunner {
	async run(seeders: readonly SeederSource[]): Promise<SeederRunResult> {
		const ranSeeders: string[] = [];

		for (let index = 0; index < seeders.length; index += 1) {
			const source = seeders[index];
			if (!source) {
				continue;
			}

			const seeder = resolveSeeder(source);
			await seeder.run({
				index,
				count: seeders.length,
			});
			ranSeeders.push(resolveSeederName(source, seeder));
		}

		return {
			seeders: ranSeeders,
		};
	}
}

export function runSeeders(
	seeders: readonly SeederSource[],
): Promise<SeederRunResult> {
	return new SeederRunner().run(seeders);
}

async function resolveFactoryState<TAttributes extends ModelAttributes>(
	state: FactoryState<TAttributes>,
	attributes: FactoryAttributes<TAttributes>,
	context: FactoryContext,
): Promise<FactoryAttributes<TAttributes>> {
	if (typeof state === "function") {
		return state(attributes, context);
	}

	return state;
}

function resolveSeeder(source: SeederSource): Seeder {
	if (typeof source === "function") {
		return new source();
	}

	return source;
}

function resolveSeederName(source: SeederSource, seeder: Seeder): string {
	if (typeof source === "function") {
		return source.name || "AnonymousSeeder";
	}

	return seeder.constructor.name || "AnonymousSeeder";
}

function normalizeStateName(name: string): string {
	const stateName = name.trim();
	if (stateName.length === 0) {
		throw new Error("Factory state name cannot be empty");
	}

	return stateName;
}

function parseNonNegativeInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}

	return value;
}

import type { BaseModel } from "./BaseModel";
import { resolveModelBasePrototype } from "./ModelMetadata";
import { normalizeHydratedAttributes } from "./ModelOperations";
import { markPersisted } from "./ModelSymbols";
import type { ModelAttributes, ModelClass } from "./ModelTypes";

export function hydrateModel<
	TModel extends BaseModel<TAttributes>,
	TAttributes extends ModelAttributes,
>(model: ModelClass<TModel, TAttributes>, attributes: TAttributes): TModel {
	const instance = new model();
	instance.fill(
		normalizeHydratedAttributes(
			model,
			attributes,
			resolveModelBasePrototype(model),
		),
	);
	instance[markPersisted]();
	return instance;
}

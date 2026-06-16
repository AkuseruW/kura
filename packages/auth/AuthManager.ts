import type { Middleware } from "../http/Middleware";
import { type GuardInput, guard } from "./Guard";

export class AuthManager {
	private guards: Map<string, GuardInput> = new Map();

	register(name: string, input: GuardInput): this {
		this.guards.set(name, input);
		return this;
	}

	use(name: string): GuardAuthenticator {
		const input = this.guards.get(name);
		if (!input) {
			throw new Error(`Auth guard [${name}] is not registered`);
		}
		return new GuardAuthenticator(name, input);
	}
}

export class GuardAuthenticator {
	constructor(
		private name: string,
		private input: GuardInput,
	) {}

	authenticate(): Middleware {
		return guard(this.input, { guardName: this.name });
	}
}

export const auth = new AuthManager();

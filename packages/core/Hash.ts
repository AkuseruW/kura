export type HashMakeOptions = Parameters<typeof Bun.password.hash>[1];
export type HashVerifyOptions = Parameters<typeof Bun.password.verify>[2];

export class Hash {
	private constructor() {}

	static async make(
		password: string,
		options?: HashMakeOptions,
	): Promise<string> {
		return Bun.password.hash(password, options);
	}

	static async verify(
		hash: string,
		password: string,
		options?: HashVerifyOptions,
	): Promise<boolean> {
		return Bun.password.verify(password, hash, options);
	}
}

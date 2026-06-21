import { describe, expect, test } from "bun:test";
import { createHttpErrorHandler } from "./ErrorHandler";
import { defineHttpKernel } from "./Kernel";
import type { Middleware } from "./Middleware";

describe("defineHttpKernel", () => {
	test("returns empty middleware stacks by default", () => {
		const kernel = defineHttpKernel();

		expect(kernel.server).toEqual([]);
		expect(kernel.router).toEqual([]);
		expect(kernel.named).toEqual({});
		expect(kernel.errorHandler).toBeUndefined();
	});

	test("preserves server, router, named middleware, and error handlers", () => {
		const first: Middleware = (_ctx, next) => next();
		const second: Middleware = (_ctx, next) => next();
		const auth: Middleware = (_ctx, next) => next();
		const errorHandler = createHttpErrorHandler();

		const kernel = defineHttpKernel({
			errorHandler,
			server: [first],
			router: [second],
			named: {
				auth,
			},
		});

		expect(kernel.server).toEqual([first]);
		expect(kernel.router).toEqual([second]);
		expect(kernel.named.auth).toBe(auth);
		expect(kernel.errorHandler).toBe(errorHandler);
	});
});

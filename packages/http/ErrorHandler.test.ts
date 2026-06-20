import { describe, expect, test } from "bun:test";
import { BaseException } from "../core/BaseException";
import {
	createHttpErrorHandler,
	ForbiddenException,
	HttpException,
	handleHttpError,
	httpStatusFromError,
	InternalServerErrorException,
	NotFoundException,
	normalizeHttpError,
} from "./ErrorHandler";

describe("HTTP error handler", () => {
	test("renders framework exceptions with the standard JSON envelope", async () => {
		const response = await handleHttpError(
			new BaseException("Policy denied", "E_POLICY_DENIED", 403),
			{ request: new Request("http://localhost/admin") },
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "E_POLICY_DENIED",
				message: "Policy denied",
				status: 403,
			},
		});
	});

	test("supports first-party HTTP exceptions with details and headers", async () => {
		const response = await handleHttpError(
			new NotFoundException("User not found", {
				details: { resource: "users", id: "42" },
				headers: { "X-Error": "missing-user" },
			}),
			{ request: new Request("http://localhost/users/42") },
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("x-error")).toBe("missing-user");
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "E_NOT_FOUND",
				details: { resource: "users", id: "42" },
				message: "User not found",
				status: 404,
			},
		});
	});

	test("hides internal HTTP exception messages unless exposed or debugged", () => {
		const error = new InternalServerErrorException("Database password leaked");

		expect(
			normalizeHttpError(error, {
				request: new Request("http://localhost/fail"),
			}),
		).toEqual({
			code: "E_INTERNAL_SERVER_ERROR",
			details: undefined,
			headers: undefined,
			message: "Internal Server Error",
			status: 500,
		});

		expect(
			normalizeHttpError(
				error,
				{
					environment: "development",
					request: new Request("http://localhost/fail"),
				},
				{ includeStack: false },
			),
		).toEqual({
			code: "E_INTERNAL_SERVER_ERROR",
			details: undefined,
			headers: undefined,
			message: "Database password leaked",
			status: 500,
		});
	});

	test("hides unknown errors by default and exposes debug details explicitly", () => {
		const error = new Error("boom");

		expect(
			normalizeHttpError(error, {
				request: new Request("http://localhost/fail"),
			}),
		).toEqual({
			code: "E_INTERNAL_SERVER_ERROR",
			details: undefined,
			message: "Internal Server Error",
			status: 500,
		});

		expect(
			normalizeHttpError(
				error,
				{ request: new Request("http://localhost/fail") },
				{ debug: true, includeStack: false },
			),
		).toEqual({
			code: "E_INTERNAL_SERVER_ERROR",
			details: { name: "Error" },
			message: "boom",
			status: 500,
		});
	});

	test("supports custom renderers", async () => {
		const handler = createHttpErrorHandler({
			render: (_error, normalized) =>
				Response.json(
					{ code: normalized.code, status: normalized.status },
					{ status: normalized.status },
				),
		});
		const response = await handler(new ForbiddenException(), {
			request: new Request("http://localhost/admin"),
		});

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			code: "E_FORBIDDEN",
			status: 403,
		});
	});

	test("normalizes status values for request logging", () => {
		expect(httpStatusFromError(new HttpException("Bad", { status: 418 }))).toBe(
			418,
		);
		expect(httpStatusFromError(new Error("boom"))).toBe(500);
	});
});

import { describe, expect, test } from "bun:test";
import { KuraResponse } from "./Response";

describe("KuraResponse", () => {
	test("creates JSON success responses", async () => {
		const response = KuraResponse.created(
			{ id: 1 },
			{ headers: { "X-Resource": "user" } },
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.get("x-resource")).toBe("user");
		expect(await response.json()).toEqual({ id: 1 });
	});

	test("creates standardized JSON error responses", async () => {
		const response = KuraResponse.error({
			code: "E_RATE_LIMITED",
			details: { retryAfter: 30 },
			message: "Too many requests",
			status: 429,
		});

		expect(response.status).toBe(429);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(await response.json()).toEqual({
			error: {
				code: "E_RATE_LIMITED",
				details: { retryAfter: 30 },
				message: "Too many requests",
				status: 429,
			},
		});
	});

	test("creates validation, problem, redirect, no-content, and download responses", async () => {
		const validation = KuraResponse.validation({
			email: ["Email is required."],
		});
		const problem = KuraResponse.problem({
			detail: "The selected account is locked.",
			status: 403,
			title: "Forbidden",
			type: "https://kura.dev/problems/forbidden",
		});
		const redirect = KuraResponse.redirect("/login");
		const noContent = KuraResponse.noContent();
		const file = Bun.file(import.meta.path);
		const download = KuraResponse.download(file, "response-test.ts");

		expect(validation.status).toBe(422);
		expect(await validation.json()).toEqual({
			error: {
				code: "E_VALIDATION_FAILED",
				details: { email: ["Email is required."] },
				message: "Validation failed",
				status: 422,
			},
		});
		expect(problem.status).toBe(403);
		expect(problem.headers.get("content-type")).toBe(
			"application/problem+json",
		);
		expect(await problem.json()).toEqual({
			detail: "The selected account is locked.",
			status: 403,
			title: "Forbidden",
			type: "https://kura.dev/problems/forbidden",
		});
		expect(redirect.status).toBe(302);
		expect(redirect.headers.get("location")).toBe("/login");
		expect(noContent.status).toBe(204);
		expect(await noContent.text()).toBe("");
		expect(download.headers.get("content-disposition")).toBe(
			'attachment; filename="response-test.ts"',
		);
	});

	test("keeps fluent instance helpers compatible", async () => {
		const response = new KuraResponse()
			.status(202)
			.header("X-Job", "queued")
			.json({ accepted: true });

		expect(response.status).toBe(202);
		expect(response.headers.get("x-job")).toBe("queued");
		expect(await response.json()).toEqual({ accepted: true });
	});
});

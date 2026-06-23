import { describe, expect, test } from "bun:test";
import { KuraRequest } from "./Request";

describe("KuraRequest", () => {
	test("parses JSON bodies through the shared body parser", async () => {
		const request = new KuraRequest(
			new Request("http://localhost/users?debug=true", {
				body: JSON.stringify({ name: "Ada" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		await request.parse();

		expect(request.type()).toBe("json");
		expect(request.raw()).toBe(JSON.stringify({ name: "Ada" }));
		expect(request.input<string>("name")).toBe("Ada");
		expect(request.input<string>("debug")).toBe("true");
		expect(request.all()).toEqual({ debug: "true", name: "Ada" });
	});

	test("parses urlencoded bodies without multipart form parsing", async () => {
		const request = new KuraRequest(
			new Request("http://localhost/users", {
				body: "name=Ada",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
			}),
		);

		await request.parse();

		expect(request.type()).toBe("urlencoded");
		expect(request.raw()).toBe("name=Ada");
		expect(request.input<string>("name")).toBe("Ada");
	});

	test("exposes native and wrapped uploaded files", async () => {
		const formData = new FormData();
		formData.append("avatar", new File(["avatar"], "avatar.png"));
		formData.append("photos", new File(["one"], "one.png"));
		formData.append("photos", new File(["two"], "two.png"));
		const request = new KuraRequest(
			new Request("http://localhost/users", {
				body: formData,
				method: "POST",
			}),
		);

		await request.parse();

		expect(request.file("avatar")?.name).toBe("avatar.png");
		expect(request.files("photos").map((file) => file.name)).toEqual([
			"one.png",
			"two.png",
		]);
		expect(request.uploadedFile("avatar")?.clientName).toBe("avatar.png");
		expect(
			request.uploadedFiles("photos").map((file) => file.clientName),
		).toEqual(["one.png", "two.png"]);
	});
});

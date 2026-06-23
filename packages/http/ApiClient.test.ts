import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { k } from "../validation/Schema";
import {
	ApiClientError,
	createApiClient,
	generateTypedApiClient,
} from "./ApiClient";
import { Router } from "./Router";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { force: true, recursive: true });
	}
});

describe("ApiClient", () => {
	test("builds requests with params, query, headers, and JSON bodies", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		const client = createApiClient({
			baseUrl: "https://api.kura.test",
			fetch: async (input, init) => {
				capturedUrl = String(input);
				capturedInit = init;

				return Response.json({ id: 1, email: "dev@kura.dev" });
			},
			headers: {
				"x-client": "kura",
			},
		});

		const payload = await client.request<{ id: number; email: string }>(
			{ method: "POST", path: "/teams/:teamId/users", bodyKind: "json" },
			{
				params: { teamId: 42 },
				query: { invite: true, tag: ["core", undefined, "http"] },
				headers: { "x-request-source": "test" },
				body: { email: "dev@kura.dev" },
			},
		);

		expect(payload).toEqual({ id: 1, email: "dev@kura.dev" });
		expect(capturedUrl).toBe(
			"https://api.kura.test/teams/42/users?invite=true&tag=core&tag=http",
		);
		expect(capturedInit?.method).toBe("POST");
		expect(new Headers(capturedInit?.headers).get("x-client")).toBe("kura");
		expect(new Headers(capturedInit?.headers).get("x-request-source")).toBe(
			"test",
		);
		expect(new Headers(capturedInit?.headers).get("content-type")).toBe(
			"application/json",
		);
		expect(capturedInit?.body).toBe(JSON.stringify({ email: "dev@kura.dev" }));
	});

	test("serializes object multipart bodies into form data", async () => {
		let capturedBody: unknown;
		const avatar = new File(["avatar"], "avatar.png", { type: "image/png" });
		const gallery = new File(["gallery"], "gallery.png", {
			type: "image/png",
		});
		const client = createApiClient({
			baseUrl: "https://api.kura.test",
			fetch: async (_input, init) => {
				capturedBody = init?.body;

				return Response.json({ ok: true });
			},
		});

		await client.request<{ ok: boolean }>(
			{ method: "POST", path: "/uploads", bodyKind: "multipart" },
			{
				body: {
					avatar,
					gallery: [gallery],
					title: "Profile",
				},
			},
		);

		expect(capturedBody).toBeInstanceOf(FormData);
		const formData = capturedBody as FormData;
		const avatarEntry = formData.get("avatar");
		const galleryEntry = formData.get("gallery");
		expect(avatarEntry).toBeInstanceOf(File);
		expect(galleryEntry).toBeInstanceOf(File);
		expect((avatarEntry as File).name).toBe("avatar.png");
		expect((galleryEntry as File).name).toBe("gallery.png");
		expect(await (avatarEntry as File).text()).toBe("avatar");
		expect(await (galleryEntry as File).text()).toBe("gallery");
		expect(formData.get("title")).toBe("Profile");
	});

	test("throws ApiClientError for non-2xx responses", async () => {
		const client = createApiClient({
			fetch: async () =>
				Response.json({ error: { code: "E_INVALID" } }, { status: 422 }),
		});

		await expect(
			client.request({ method: "GET", path: "/users" }),
		).rejects.toThrow(ApiClientError);

		try {
			await client.request({ method: "GET", path: "/users" });
			throw new Error("Expected request to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiClientError);
			expect((error as ApiClientError).status).toBe(422);
			expect((error as ApiClientError).data).toEqual({
				error: { code: "E_INVALID" },
			});
		}
	});

	test("generates typed client methods from route schemas", () => {
		const router = createDemoRouter();
		router
			.get("/teams/:teamId/members/:memberId", () => Response.json({}))
			.as("teams.members.show")
			.schema({
				params: k.object({ teamId: k.string() }),
			});
		const source = generateTypedApiClient(router, {
			importPath: "/repo/client.ts",
		});

		expect(source).toContain('from "/repo/client.ts"');
		expect(source).toContain("export function createApi");
		expect(source).toContain("teamsUsersStore:");
		expect(source).toContain("export type TeamsUsersStoreParams");
		expect(source).toContain("teamId: string");
		expect(source).toContain("avatar: File");
		expect(source).toContain("gallery?: (File)[]");
		expect(source).toContain("createdAt: string");
		expect(source).toContain('bodyKind":"multipart"');
		expect(source).toContain("memberId: string");
	});

	test("generated clients catch invalid request types during typecheck", async () => {
		const root = await makeRoot();
		const repoRoot = process.cwd();
		const router = createDemoRouter();
		const generatedPath = join(root, "api_client.ts");
		const fixturePath = join(root, "fixture.ts");

		await writeFile(
			generatedPath,
			generateTypedApiClient(router, {
				importPath: `${repoRoot}/client.ts`,
			}),
		);
		await writeFile(
			fixturePath,
			`import { createApi, type TeamsUsersStoreBody } from "./api_client.ts";

const api = createApi({
\tfetch: async () => Response.json({
\t\tid: 1,
\t\temail: "dev@kura.dev",
\t\tcreatedAt: "2026-01-01T00:00:00.000Z",
\t}),
});

const created = await api.teamsUsersStore({
\tparams: { teamId: "team_1" },
\tquery: { invite: "1" },
\theaders: { "x-request-source": "test" },
\tbody: {
\t\temail: "dev@kura.dev",
\t\tavatar: new File(["avatar"], "avatar.png", { type: "image/png" }),
\t\tgallery: [new File(["gallery"], "gallery.png", { type: "image/png" })],
\t},
});
created.id.toFixed();
created.createdAt.toUpperCase();

// @ts-expect-error body is required for this route
api.teamsUsersStore({ params: { teamId: "team_1" } });

// @ts-expect-error route params must include teamId
api.teamsUsersStore({
\tbody: {
\t\temail: "dev@kura.dev",
\t\tavatar: new File(["avatar"], "avatar.png", { type: "image/png" }),
\t},
});

const invalidAvatarBody: TeamsUsersStoreBody = {
\temail: "dev@kura.dev",
\t// @ts-expect-error avatar must be a File
\tavatar: "avatar.png",
};
void invalidAvatarBody;
`,
		);

		const result = Bun.spawnSync({
			cmd: [
				process.execPath,
				"x",
				"tsc",
				"--noEmit",
				"--strict",
				"--target",
				"ESNext",
				"--module",
				"Preserve",
				"--moduleResolution",
				"bundler",
				"--allowImportingTsExtensions",
				"--types",
				"bun",
				"--lib",
				"ESNext",
				fixturePath,
			],
			stderr: "pipe",
			stdout: "pipe",
		});

		if (result.exitCode !== 0) {
			throw new Error(
				`Generated client fixture failed typecheck\n${result.stdout.toString()}\n${result.stderr.toString()}\n${await readFile(generatedPath, "utf8")}`,
			);
		}
	});
});

function createDemoRouter(): Router {
	const router = new Router();
	const request = k.object({
		email: k.string().email(),
		avatar: k.file(),
		gallery: k.files(k.file()).optional(),
	});
	const response = k.object({
		id: k.number(),
		email: k.string(),
		createdAt: k.date(),
	});

	router
		.post("/teams/:teamId/users", () => Response.json({}))
		.as("teams.users.store")
		.schema({
			params: k.object({ teamId: k.string() }),
			query: k.object({ invite: k.string().optional() }),
			headers: k.object({ "x-request-source": k.string().optional() }),
			body: request,
			responses: {
				201: response,
			},
		});

	return router;
}

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-api-client-test-"));
	roots.push(root);
	return root;
}

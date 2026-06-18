import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KuraViewEngine, renderKuraTemplate, renderView, view } from "./View";

const roots: string[] = [];

async function makeViewsRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kura-views-"));
	roots.push(root);
	return root;
}

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { force: true, recursive: true });
	}
});

describe("Kura views", () => {
	test("renders escaped .kura.html templates", async () => {
		const root = await makeViewsRoot();
		await writeFile(
			join(root, "home.kura.html"),
			"<h1>{{ title }}</h1><p>{{ user.name }}</p><small>{{ missing }}</small>",
		);
		const engine = new KuraViewEngine({ root });

		const html = await engine.render("home", {
			title: "<Kura>",
			user: {
				name: "Ada & Grace",
			},
		});

		expect(html).toBe(
			"<h1>&lt;Kura&gt;</h1><p>Ada &amp; Grace</p><small></small>",
		);
	});

	test("renders nested view names and explicit extensions", async () => {
		const root = await makeViewsRoot();
		await mkdir(join(root, "pages"), { recursive: true });
		await writeFile(join(root, "pages/show.kura.html"), "{{ page.title }}");

		const html = await renderView(
			"pages/show.kura.html",
			{
				page: {
					title: "Docs",
				},
			},
			{ root },
		);

		expect(html).toBe("Docs");
	});

	test("returns an HTML response", async () => {
		const root = await makeViewsRoot();
		await writeFile(join(root, "home.kura.html"), "Hello {{ name }}");

		const response = await view(
			"home",
			{ name: "Kura" },
			{
				root,
				status: 201,
			},
		);

		expect(response.status).toBe(201);
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(await response.text()).toBe("Hello Kura");
	});

	test("rejects invalid view names and expressions", async () => {
		const root = await makeViewsRoot();
		const engine = new KuraViewEngine({ root });

		await expect(engine.render("../secret")).rejects.toThrow(
			"View name [../secret] is invalid",
		);
		expect(() => renderKuraTemplate("{{ user['name'] }}", {})).toThrow(
			"Invalid Kura template expression [user['name']]",
		);
	});
});

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export type ViewData = Record<string, unknown>;

export interface ViewEngine {
	render(name: string, data?: ViewData): Promise<string>;
}

export type KuraViewEngineOptions = {
	readonly root?: string;
	readonly extension?: string;
	readonly cache?: boolean;
};

export type ViewHeadersInit =
	| Headers
	| [string, string][]
	| Record<string, string>;

export type ViewResponseOptions = KuraViewEngineOptions & {
	readonly engine?: ViewEngine;
	readonly headers?: ViewHeadersInit;
	readonly status?: number;
};

const expressionPattern =
	/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

export class KuraViewEngine implements ViewEngine {
	private readonly cache = new Map<string, string>();
	private readonly extension: string;
	private readonly root: string;
	private readonly shouldCache: boolean;

	constructor(options: KuraViewEngineOptions = {}) {
		this.root = resolve(options.root ?? "resources/views");
		this.extension = normalizeExtension(options.extension ?? ".kura.html");
		this.shouldCache = options.cache ?? false;
	}

	async render(name: string, data: ViewData = {}): Promise<string> {
		const path = this.resolve(name);
		const template = await this.load(path);

		return renderKuraTemplate(template, data);
	}

	private resolve(name: string): string {
		const normalized = normalizeViewName(name);
		const path = resolve(
			this.root,
			normalized.endsWith(this.extension)
				? normalized
				: `${normalized}${this.extension}`,
		);
		const pathFromRoot = relative(this.root, path);

		if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
			throw new Error(`View [${name}] resolves outside of the views root`);
		}

		return path;
	}

	private async load(path: string): Promise<string> {
		if (this.shouldCache) {
			const cached = this.cache.get(path);
			if (cached !== undefined) {
				return cached;
			}
		}

		const template = await readFile(path, "utf8");

		if (this.shouldCache) {
			this.cache.set(path, template);
		}

		return template;
	}
}

const defaultViewEngine = new KuraViewEngine();

export async function renderView(
	name: string,
	data: ViewData = {},
	options: ViewResponseOptions = {},
): Promise<string> {
	const engine =
		options.engine ??
		(options.root || options.extension || options.cache !== undefined
			? new KuraViewEngine(options)
			: defaultViewEngine);

	return engine.render(name, data);
}

export async function view(
	name: string,
	data: ViewData = {},
	options: ViewResponseOptions = {},
): Promise<Response> {
	const headers = new Headers(options.headers);
	if (!headers.has("Content-Type")) {
		headers.set("Content-Type", "text/html; charset=utf-8");
	}

	return new Response(await renderView(name, data, options), {
		headers,
		status: options.status ?? 200,
	});
}

export function renderKuraTemplate(
	template: string,
	data: ViewData = {},
): string {
	return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, expression) => {
		const path = String(expression).trim();

		if (!expressionPattern.test(path)) {
			throw new Error(`Invalid Kura template expression [${path}]`);
		}

		return escapeHtml(resolveDataPath(data, path));
	});
}

function resolveDataPath(data: ViewData, path: string): unknown {
	let current: unknown = data;

	for (const segment of path.split(".")) {
		if (!isRecord(current)) {
			return undefined;
		}

		current = current[segment];
	}

	return current;
}

function escapeHtml(value: unknown): string {
	if (value === undefined || value === null) {
		return "";
	}

	return String(value).replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&#39;";
			default:
				return character;
		}
	});
}

function normalizeExtension(extension: string): string {
	if (!extension) {
		throw new Error("View extension cannot be empty");
	}

	return extension.startsWith(".") ? extension : `.${extension}`;
}

function normalizeViewName(name: string): string {
	const normalized = name.replaceAll("\\", "/").trim();

	if (
		!normalized ||
		normalized.startsWith("/") ||
		normalized
			.split("/")
			.some((segment) => segment === "." || segment === ".." || !segment)
	) {
		throw new Error(`View name [${name}] is invalid`);
	}

	return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

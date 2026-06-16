export class KuraResponse {
	private headers: Headers = new Headers();
	private statusCode: number = 200;

	status(code: number): this {
		this.statusCode = code;
		return this;
	}

	header(name: string, value: string): this {
		this.headers.set(name, value);
		return this;
	}

	json(data: unknown): Response {
		this.headers.set("Content-Type", "application/json");
		return new Response(JSON.stringify(data), {
			status: this.statusCode,
			headers: this.headers,
		});
	}

	ok(data: unknown): Response {
		this.statusCode = 200;
		return this.json(data);
	}

	created(data: unknown): Response {
		this.statusCode = 201;
		return this.json(data);
	}

	notFound(message = "Not Found"): Response {
		this.statusCode = 404;
		return this.json({ error: message });
	}

	unauthorized(message = "Unauthorized"): Response {
		this.statusCode = 401;
		return this.json({ error: message });
	}

	forbidden(message = "Forbidden"): Response {
		this.statusCode = 403;
		return this.json({ error: message });
	}

	redirect(url: string, status = 302): Response {
		return new Response(null, {
			status,
			headers: { Location: url },
		});
	}

	download(file: Bun.BunFile, filename?: string): Response {
		const name = filename ?? file.name ?? "download";
		this.headers.set("Content-Disposition", `attachment; filename="${name}"`);
		return new Response(file, { headers: this.headers });
	}
}

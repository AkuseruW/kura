const hostname = Bun.env.HOST ?? "127.0.0.1";
const port = readPort(Bun.env.PORT ?? "4300");

const jsonHeaders = {
	"Content-Type": "application/json",
} as const;

const htmlHeaders = {
	"Content-Type": "text/html; charset=utf-8",
} as const;

const server = Bun.serve({
	hostname,
	port,
	fetch(request) {
		const path = new URL(request.url).pathname;

		if (path === "/" || path === "/api") {
			return Response.json({
				framework: "bun",
				ok: true,
			});
		}

		if (path === "/html") {
			return new Response("<h1>Kura benchmark</h1>", {
				headers: htmlHeaders,
			});
		}

		if (path === "/health" || path === "/api/health") {
			return new Response('{"status":"up"}', {
				headers: jsonHeaders,
			});
		}

		return new Response("Not Found", { status: 404 });
	},
});

console.log(`bun-raw listening on ${server.url}`);

function readPort(value: string): number {
	const port = Number(value);

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT [${value}]`);
	}

	return port;
}

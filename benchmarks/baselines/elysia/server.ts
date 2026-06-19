import { Elysia } from "elysia";

const hostname = Bun.env.HOST ?? "127.0.0.1";
const port = readPort(Bun.env.PORT ?? "4300");

const jsonHeaders = {
	"Content-Type": "application/json",
} as const;

const htmlHeaders = {
	"Content-Type": "text/html; charset=utf-8",
} as const;

const app = new Elysia()
	.get(
		"/",
		() =>
			new Response('{"framework":"elysia","ok":true}', {
				headers: jsonHeaders,
			}),
	)
	.get(
		"/api",
		() =>
			new Response('{"framework":"elysia","ok":true}', {
				headers: jsonHeaders,
			}),
	)
	.get(
		"/html",
		() =>
			new Response("<h1>Kura benchmark</h1>", {
				headers: htmlHeaders,
			}),
	)
	.get(
		"/health",
		() =>
			new Response('{"status":"up"}', {
				headers: jsonHeaders,
			}),
	)
	.get(
		"/api/health",
		() =>
			new Response('{"status":"up"}', {
				headers: jsonHeaders,
			}),
	)
	.listen({ hostname, port });

console.log(`elysia listening on ${app.server?.url}`);

function readPort(value: string): number {
	const port = Number(value);

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT [${value}]`);
	}

	return port;
}

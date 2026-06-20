import { Router } from "../../../packages/http/Router";
import { Server } from "../../../packages/http/Server";

const hostname = Bun.env.HOST ?? "127.0.0.1";
const port = readPort(Bun.env.PORT ?? "4300");

const jsonHeaders = {
	"Content-Type": "application/json",
} as const;

const router = new Router();

router.get(
	"/health",
	() =>
		new Response('{"status":"up"}', {
			headers: jsonHeaders,
		}),
);

for (let index = 0; index < 1_000; index += 1) {
	router.get(`/tenants/:tenant/resource-${index}/items/:id`, (ctx) => {
		return new Response(
			`{"tenant":"${ctx.param("tenant")}","id":"${ctx.param("id")}","resource":${index}}`,
			{ headers: jsonHeaders },
		);
	});
}

const server = new Server({ hostname, port });
server.setRouter(router);
server.start();

console.log(`kura-dynamic listening on http://${hostname}:${port}`);

function readPort(value: string): number {
	const port = Number(value);

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT [${value}]`);
	}

	return port;
}

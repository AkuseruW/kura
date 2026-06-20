import { Router } from "../../../packages/http/Router";
import { Server } from "../../../packages/http/Server";
import { v } from "../../../packages/validation/Schema";

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

router
	.get("/users/:id", (ctx) => {
		const params = ctx.validatedParams<{ id: string }>();
		const query = ctx.validatedQuery<{ tab?: string }>();

		return new Response(
			`{"id":"${params?.id ?? ""}","tab":"${query?.tab ?? ""}"}`,
			{ headers: jsonHeaders },
		);
	})
	.schema({
		params: v.object({ id: v.string() }),
		query: v.object({ tab: v.string().optional() }),
	});

const server = new Server({ hostname, port });
server.setRouter(router);
server.start();

console.log(`kura-validation-heavy listening on http://${hostname}:${port}`);

function readPort(value: string): number {
	const port = Number(value);

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT [${value}]`);
	}

	return port;
}

import type { Middleware } from "../../../packages/http/Middleware";
import { Router } from "../../../packages/http/Router";
import { Server } from "../../../packages/http/Server";

const hostname = Bun.env.HOST ?? "127.0.0.1";
const port = readPort(Bun.env.PORT ?? "4300");

const jsonHeaders = {
	"Content-Type": "application/json",
} as const;

const router = new Router();
const middleware: Middleware[] = Array.from({ length: 10 }, () => {
	return async (ctx, next) => {
		ctx.setState(
			"middleware-count",
			(ctx.getState<number>("middleware-count") ?? 0) + 1,
		);
		return next();
	};
});

router.get(
	"/health",
	() =>
		new Response('{"status":"up"}', {
			headers: jsonHeaders,
		}),
);

const group = router.group();
for (const layer of middleware) {
	group.middleware(layer);
}

group.routes((routes) => {
	routes.get("/middleware", (ctx) => {
		return new Response(
			`{"ok":true,"middleware":${ctx.getState<number>("middleware-count", 0)}}`,
			{ headers: jsonHeaders },
		);
	});
});

const server = new Server({ hostname, port });
server.setRouter(router);
server.start();

console.log(`kura-middleware-heavy listening on http://${hostname}:${port}`);

function readPort(value: string): number {
	const port = Number(value);

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT [${value}]`);
	}

	return port;
}

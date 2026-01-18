export type Context = {
	request: Request;
};

type Handler = (ctx: Context) => Response | Promise<Response>;

export class Server {
	private server: ReturnType<typeof Bun.serve> | null = null;
	private handler: Handler = () => new Response("Not Found", { status: 404 });

	constructor(private options: { port: number }) {}

	setHandler(handler: Handler): void {
		this.handler = handler;
	}

	start(): void {
		this.server = Bun.serve({
			port: this.options.port,
			fetch: async (request) => {
				try {
					const ctx: Context = { request };
					return await this.handler(ctx);
				} catch (error) {
					return new Response("Internal Server Error", { status: 500 });
				}
			},
		});
	}

	stop(): void {
		this.server?.stop();
	}
}

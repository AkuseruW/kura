# Kura

Kura is a Bun-native TypeScript web framework for building HTTP applications with
a conventional project structure, typed primitives, and a first-party CLI.

It gives you the foundation of a full-stack framework without hiding the Bun
runtime: routing, middleware, configuration, validation, console commands,
testing tools, cache, queue, auth primitives, and database building blocks.

## Requirements

- Bun 1.3 or newer
- TypeScript 5 when type-checking applications

## License

Kura is open source software licensed under the MIT license.

## Create An Application

Create a new project with the application starter.

```sh
bun create kura-app my-app
cd my-app
bun install
bun run dev
```

The development server starts on http://localhost:3333.

You can also scaffold without prompts.

```sh
bun create kura-app my-api -- --yes --preset=api
```

Available starter choices include:

- `preset`: `api`, `web`, or `full`
- `architecture`: `standard`, `modular`, or `domain`
- `database`: `none`, `sqlite`, `postgres`, or `mysql`
- `auth`: `none`, `session`, or `access-token`
- `cache`: `memory`, `file`, or `redis`
- `queue`: `none`, `memory`, `sqlite`, or `redis`
- `module`: `mail`, `storage`, `i18n`, or `websockets`

## Application Code

Generated applications install the framework runtime under the local `kura`
alias, while the published package remains `@akuseru_w/kura` on npm.

```ts
import type { Context } from "kura/http";
import { view } from "kura/view";

export class HomeController {
	async index(_ctx: Context): Promise<Response> {
		return view("home", {
			preset: "web",
		});
	}
}
```

Routes are usually declared in `start/routes.ts` and point to controllers.

```ts
import { Router } from "kura/http";
import { HomeController } from "#controllers/home_controller";

export const router = new Router();

const homeController = new HomeController();

router.get("/", (ctx) => homeController.index(ctx)).as("home");
router.get("/health", () => Response.json({ status: "up" })).as("health");
```

Kura keeps the root import stable for compatibility and recommends domain
entrypoints for smaller, clearer imports.

```ts
import { Router } from "kura/http";
import { BaseModel, column } from "kura/database";
import { v } from "kura/validation";
import { SQLiteQueueDriver } from "kura/queue/sqlite";
```

## Request Context

Route handlers receive a typed context. `ctx.request` stays the native
`Request`, and Kura adds small helpers for the data apps read most often.

```ts
router.get("/users/:id", (ctx) => {
	ctx.setState("startedAt", Date.now());

	return Response.json({
		id: ctx.param("id"),
		tab: ctx.query("tab", "overview"),
		tags: ctx.queries("tag"),
		tenant: ctx.header("x-tenant"),
		session: ctx.cookie("session"),
		startedAt: ctx.getState<number>("startedAt"),
	});
});
```

- `ctx.param()` returns all route params, and `ctx.param("id")` returns
  `string | null`.
- `ctx.query()` preserves repeated query values as arrays, while
  `ctx.query("page")` returns the first value.
- `ctx.queries("tag")` always returns `string[]`.
- `ctx.header()` and `ctx.cookie()` read request headers and cookies with
  predictable `null` or default-value fallbacks.
- `ctx.bodyValue()`, `ctx.validatedData()`, `ctx.validatedParams()`,
  `ctx.validatedQuery()`, and `ctx.validatedBody()` expose parsed and validated
  request input when middleware or route schemas populate it.
- `ctx.setState()` and `ctx.getState()` store request-local values without
  touching globals.

API and full-stack starters expose OpenAPI docs from the route table.

```ts
import { Router } from "kura/http";
import { registerOpenApiRoutes } from "kura/openapi";
import { v } from "kura/validation";

export const router = new Router();

const userResponse = v.object({
	id: v.number(),
	email: v.string().email(),
});

router.get("/users/:id", (ctx) => Response.json({ id: ctx.params?.id })).openapi({
	tags: ["Users"],
	summary: "Get a user",
	responses: {
		200: userResponse,
	},
});

registerOpenApiRoutes(router, {
	title: "My API",
	version: "1.0.0",
	specVersion: "3.1.2",
	ui: "scalar",
});
```

The generated app serves `/openapi.json` and `/docs`. Set `ui: "swagger"` when
you prefer Swagger UI. Kura defaults to OpenAPI `3.1.2`; use
`specVersion: "3.2.0"` when you need the latest OpenAPI spec.

Route schemas also validate requests before handlers run. Invalid input returns
the standard `422` JSON error response, and handlers can read parsed values from
the validated helpers.

```ts
const createUserRequest = v.object({
	email: v.string().email(),
	password: v.string().min(8),
});

router.post("/users", (ctx) => {
	const input = ctx.validatedBody<{ email: string; password: string }>();

	return Response.json({ email: input?.email });
}).schema({
	body: createUserRequest,
});
```

## Response Helpers

Route handlers can always return a native `Response`. For common JSON responses,
Kura also exposes `KuraResponse`.

```ts
import { KuraResponse } from "kura/http";

router.post("/users", async () => {
	return KuraResponse.created({ id: 1 });
});

router.get("/me", () => {
	return KuraResponse.unauthenticated();
});
```

Framework-generated JSON errors use a stable shape.

```json
{
	"error": {
		"code": "E_UNAUTHENTICATED",
		"message": "Unauthenticated",
		"status": 401
	}
}
```

Helpers also cover `noContent()`, `redirect()`, `download()`, `validation()`,
and `problem()` for `application/problem+json` responses.

Expected HTTP failures can be raised with first-party exceptions and rendered by
the same pipeline used by `Server`, `kura serve`, and the test client.

```ts
import { NotFoundException } from "kura/http";

router.get("/users/:id", () => {
	throw new NotFoundException("User not found", {
		details: { resource: "users" },
	});
});
```

Use `createHttpErrorHandler()` when an app needs a custom renderer while keeping
Kura's normalization for status codes and framework exceptions.

For web apps, views live in `resources/views` and use the `.kura.html`
extension.

```html
<h1>Kura</h1>
<p>{{ preset }} app</p>
```

Full-stack apps use Bun's native HTML routes for the browser entrypoint. The
generated `resources/pages/home.html` imports TypeScript and CSS directly, and
Kura continues to handle the API, middleware, controllers, and validation.

```ts
import home from "../resources/pages/home.html";
import { type BunStaticRouteMap } from "kura/http";

export const staticRoutes = {
	"/": home,
} satisfies BunStaticRouteMap;
```

## Generated Structure

A new application uses the `standard` structure by default.

```txt
app/
  controllers/
bin/
  console.ts
  server.ts
  test.ts
config/
start/
  env.ts
  kernel.ts
  routes.ts
kura.config.ts
package.json
tsconfig.json
```

- `app/` contains application code.
- `bin/` contains executable entrypoints for the console, server, and tests.
- `config/` contains typed configuration files.
- `start/` contains boot files loaded during application startup.
- `kura.config.ts` is the application manifest used by Kura tooling.
- `database/` is added when database or auth features need schema files.

For larger applications, choose the feature-based `modular` structure.

```sh
bun create kura-app my-app -- --architecture=modular
```

```txt
app/
  modules/
    api/
      api_controller.ts
    auth/
      auth_controller.ts
      user.ts
    web/
      home_controller.ts
config/
resources/
start/
```

For domain-heavy applications, choose the clean `domain` structure.

```sh
bun create kura-app my-app -- --architecture=domain
```

```txt
app/
  domains/
    auth/
      domain/
        user.ts
        user_repository.ts
      application/
        register_user.ts
      infrastructure/
        persistence/
          user_record.ts
          sql_user_repository.ts
      http/
        auth_controller.ts
config/
database/
start/
```

In the `domain` structure, domain entities stay framework-free. Database models
and other adapters live under `infrastructure/`.

## Console Commands

Generated applications expose a local Kura console.

```sh
bun kura
bun kura routes
bun kura doctor
bun kura env
bun kura config app.starter
bun kura make:controller Home
bun kura serve --watch
```

Common package scripts are also generated.

```sh
bun run dev
bun run build
bun run typecheck
bun run test
```

## Framework Primitives

Kura currently includes:

- Application lifecycle and service container
- Configuration and environment loading
- HTTP server, router, middleware pipeline, and controllers
- Standard JSON response helpers and framework error responses
- OpenAPI generation with Scalar or Swagger UI docs
- `.kura.html` view rendering with escaped interpolation
- Bun fullstack HTML route support for generated browser entrypoints
- Body parsing, CORS, request IDs, request logging, and metrics helpers
- Schema validation with type inference
- Console kernel and generator commands
- Cache manager with memory, file, and Redis drivers
- Queue manager with memory driver and explicit SQLite or Redis driver
  entrypoints
- Auth guards, access token guard, session guard, JWT guard, and policy helpers
- Database manager, query builder, migrations, models, factories, and seeders
- Test client and framework fakes

## Example Validation

```ts
import { Schema, v } from "kura/validation";

const createUser = Schema.object({
	email: v.string().email(),
	name: v.string().min(2),
	birthdate: v.date(),
});

const payload = createUser.parse({
	email: "ada@example.com",
	name: "Ada",
	birthdate: "1815-12-10",
});
```

## Example Test

```ts
import { describe, expect, test } from "bun:test";
import { createTestClient } from "kura/testing";
import { router } from "#start/routes";

describe("home", () => {
	test("returns the home payload", async () => {
		const client = createTestClient(router);
		const response = await client.get("/");

		expect(response.status).toBe(200);
	});
});
```

## Working On Kura

Clone the repository and install dependencies.

```sh
bun install
```

Build, test, and check the framework.

```sh
bun run build
bun test
bun run typecheck
bun run lint
```

## Release

The npm packages are published by GitHub Actions when a semver tag is pushed.

```sh
git tag v0.1.7
git push origin v0.1.7
```

Before tagging, make sure `package.json`,
`packages/create-kura-app/package.json`, and the `@akuseru_w/kura` dependency
range inside `create-kura-app` all use the same version. The release workflow
checks this before publishing.

Publishing uses npm trusted publishing, so both npm packages must allow the
`publish.yml` GitHub Actions workflow as a trusted publisher:

- `@akuseru_w/kura`
- `create-kura-app`

## Project Status

Kura is early-stage. The public API is taking shape around the generated
application structure, the local `kura` import alias, and the Bun runtime.
Expect fast iteration before a stable 1.0 release.

# Kura

Kura is a Bun-native TypeScript web framework for building HTTP applications with
a conventional project structure, typed primitives, and a first-party CLI.

It gives you the foundation of a full-stack framework without hiding the Bun
runtime: routing, middleware, configuration, validation, console commands,
testing tools, cache, queue, auth primitives, and database building blocks.

## Requirements

- Bun 1.3 or newer
- TypeScript 5 when type-checking applications

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
- `auth`: `none`, `session`, or `jwt`
- `cache`: `memory`, `file`, or `redis`
- `queue`: `none`, `memory`, `sqlite`, or `redis`
- `module`: `mail`, `storage`, `i18n`, or `websockets`

## Application Code

Generated applications install the framework runtime under the local `kura`
alias, so app code imports from `"kura"` while the published package remains
scoped on npm.

```ts
import { type Context, view } from "kura";

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
import { Router } from "kura";
import { HomeController } from "#controllers/home_controller";

export const router = new Router();

const homeController = new HomeController();

router.get("/", (ctx) => homeController.index(ctx)).as("home");
router.get("/health", () => Response.json({ status: "up" })).as("health");
```

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
import { type BunStaticRouteMap } from "kura";

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
- `.kura.html` view rendering with escaped interpolation
- Bun fullstack HTML route support for generated browser entrypoints
- Body parsing, CORS, request IDs, request logging, and metrics helpers
- Schema validation with type inference
- Console kernel and generator commands
- Cache manager with memory, file, and Redis drivers
- Queue manager with memory, SQLite, and Redis drivers
- Auth guards, session guard, JWT guard, and policy helpers
- Database manager, query builder, migrations, models, factories, and seeders
- Test client and framework fakes

## Example Validation

```ts
import { Schema, v } from "kura";

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
import { createTestClient } from "kura";
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
git tag v0.1.6
git push origin v0.1.6
```

Before tagging, make sure `package.json`,
`packages/create-kura-app/package.json`, and the `@akuseru_w/kura` dependency
range inside `create-kura-app` all use the same version. The release workflow
checks this before publishing.

Publishing uses npm trusted publishing, so both npm packages must allow the
`publish.yml` GitHub Actions workflow as a trusted publisher.

## Project Status

Kura is early-stage. The public API is taking shape around the generated
application structure, the local `kura` import alias, and the Bun runtime.
Expect fast iteration before a stable 1.0 release.

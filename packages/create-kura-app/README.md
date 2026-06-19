# create-kura-app

Create a new [Kura](https://github.com/AkuseruW/kura) application with Bun.

```sh
bun create kura-app my-app
cd my-app
bun install
bun run dev
```

The application starts on http://localhost:3333.

## What It Creates

The starter generates a TypeScript Kura app with:

- Bun runtime configuration
- HTTP server and router entrypoints
- Environment, middleware, and route boot files
- `.kura.html` view files for web and full-stack apps
- Optional auth, database, cache, queue, mail, storage, i18n, and WebSocket files
- A local `kura` import alias, so application code imports from `"kura"`

The generated app aliases the runtime dependency to `kura`, while the published
framework package is `@kurajs/core`.

```ts
import { Router } from "kura";
```

## Interactive Setup

Run the command and choose the app shape from the prompts.

```sh
bun create kura-app my-app
```

You can choose:

| Prompt | Choices |
| --- | --- |
| Application type | `API`, `Web`, `Full` |
| Project structure | `Standard`, `Modular`, `Domain` |
| Features | Database, Auth, Cache, Queue, Mail, Storage, i18n, WebSockets |
| Install dependencies | Yes or No |

## Project Structures

Use the default `standard` structure for conventional apps.

```sh
bun create kura-app my-app -- --architecture=standard
```

Use `modular` when you want feature folders.

```sh
bun create kura-app my-app -- --architecture=modular
```

Use `domain` when you want Clean Architecture style boundaries.

```sh
bun create kura-app my-app -- --architecture=domain
```

The domain structure keeps domain entities framework-free and places adapters
under `infrastructure/`.

```txt
app/domains/auth/
  domain/
    user.ts
    user_repository.ts
  application/
    register_user.ts
  infrastructure/
    persistence/
      user_record.ts
      Sqluser_repository.ts
  http/
    auth_controller.ts
```

## Non-Interactive Usage

Skip prompts with `--yes` and pass the options you want.

```sh
bun create kura-app my-api -- --yes --preset=api
bun create kura-app my-web -- --yes --preset=web --auth=session
bun create kura-app my-api -- --yes --architecture=domain --database=sqlite
```

Available options:

```txt
--preset api|web|full
--architecture standard|modular|domain
--database none|sqlite|postgres|mysql
--auth none|session|jwt
--cache memory|file|redis
--queue none|memory|sqlite|redis
--module mail,storage,i18n,websockets
--install
```

## Generated Commands

Inside the generated app:

```sh
bun kura
bun kura routes
bun kura doctor
bun kura env
bun kura config app.starter
bun run dev
bun run build
bun run typecheck
```

## Requirements

- Bun 1.3 or newer
- TypeScript 5 for type-checking generated apps

# Kura

Kura is a Bun-native TypeScript web framework.

## Install

```sh
bun add kura@npm:kurajs
```

The package published on npm is `kurajs`, but Kura applications install it
under the local dependency alias `kura` so application code can import from
`"kura"`.

## Create An App

```sh
bun create kurajs my-app
cd my-app
bun install
bun kura
bun run dev
```

The npm package is named `kurajs` because the unscoped `kura` package name is already used by an unrelated package.

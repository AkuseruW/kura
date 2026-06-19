# Kura Benchmarks

This directory contains a reproducible local benchmark kit for Kura starter
setups. It is intended to measure framework overhead and scaffold behavior
before making public performance claims.

## Matrix

The benchmark matrix covers the generated Kura starter shapes:

- `api-standard`, `api-modular`, `api-domain`
- `web-standard`, `web-modular`, `web-domain`
- `full-standard`, `full-modular`, `full-domain`

It also includes baseline servers under `benchmarks/baselines`:

- `bun-raw`: direct `Bun.serve`
- `elysia`: a minimal Elysia app with matching routes

API apps primarily benchmark `/health`, web apps primarily benchmark `/`, and
full apps primarily benchmark `/health`. Full apps still include `/` in
`--endpoints all`, but it is kept out of default runs while Bun HTML bundle
serving is validated separately.

Generated apps are written to `benchmarks/apps` and reports are written to
`benchmarks/results`. Both directories are ignored by git and can be recreated
at any time.

## Scaffold Apps

```sh
bun run bench:scaffold
```

This command builds the local Kura runtime, generates every matrix app from the
local CLI, installs dependencies, and builds each app for production. The build
step is kept as a validation pass so benchmark fixtures catch scaffold
regressions before the runner starts.

To scaffold a subset:

```sh
bun run bench:scaffold -- --apps api-standard,full-standard
```

Useful flags:

- `--apps`: comma-separated app names, or omitted for all Kura apps.
- `--no-build-runtime`: skip rebuilding `dist`.
- `--no-install`: skip `bun install` inside generated apps.
- `--no-build-apps`: skip generated app production builds.

## Run Benchmarks

```sh
bun run bench:run
```

By default the runner:

- uses every installed external tool it can find from `oha`, `bombardier`,
  `wrk`, `hey`, and `autocannon`
- falls back to an internal Bun fetch loop when none are installed
- starts generated Kura apps from `bin/server.ts` with `NODE_ENV=production`
- benchmarks the primary endpoint for each app
- uses 128 connections, 3 seconds warmup, and 10 seconds measurement

Examples:

```sh
bun run bench:run -- --tools oha,bombardier --duration 20s --connections 256
bun run bench:run -- --tools oha --apps bun-raw,elysia,api-standard
bun run bench:run -- --tools bun --apps bun-raw,elysia,api-standard --endpoints all
bun run bench:run -- --tools wrk --threads 10 --port-base 4500
```

Useful flags:

- `--tools`: `auto`, `bun`, `oha`, `bombardier`, `wrk`, `hey`, or `autocannon`.
- `--apps`: comma-separated app names, or omitted for all apps including
  `bun-raw` and `elysia`.
- `--endpoints`: `primary` or `all`.
- `--duration`: measurement duration in seconds, such as `10s`.
- `--warmup`: warmup duration in seconds.
- `--connections`: concurrent connections.
- `--threads`: wrk thread count.
- `--port-base`: first port used by the runner.
- `--out`: output directory.

## Tool Notes

Bun's benchmarking documentation recommends using native HTTP load tools for
serious measurements and warns that Node-based clients can become the bottleneck.
Prefer `oha`, `bombardier`, or `wrk` for local comparison runs. `autocannon` is
supported for convenience, but do not use it alone for public claims.

Install examples:

```sh
brew install oha
brew install bombardier
brew install wrk
brew install hey
npm install -g autocannon
```

The internal `bun` tool is only a fallback smoke benchmark. It runs the client
inside Bun on the same machine and is useful for quick local regressions, not
for marketing numbers.

## Public Claim Checklist

Before publishing a chart, keep these fixed and documented:

- machine model, CPU, memory, power mode, OS, and kernel
- Bun version and framework commit SHA
- benchmark tool name and version
- endpoint payload, duration, warmup, connections, and threads
- at least three runs with median and variance
- raw JSON results committed or attached

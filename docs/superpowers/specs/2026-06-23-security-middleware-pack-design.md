# Security Middleware Pack Design

## Goal

Add a first-party security middleware pack that gives generated Kura apps safer production defaults without forcing application code to adopt a separate security package. The first slice covers security headers, in-memory rate limiting, generated app config, and tests.

## Scope

- Add `SecurityHeaders(options)` in `kura/http`.
- Add `RateLimit(options)` in `kura/http` with an in-memory fixed-window store.
- Add generated `config/security.ts` for new applications.
- Wire generated `start/kernel.ts` to use security headers and rate limiting from config.
- Keep CSRF as the browser-session-specific middleware already wired separately.
- Add unit tests and generated app tests.

## Out Of Scope

- Redis or distributed rate-limit stores.
- Per-user/authenticated rate-limit keys.
- Security dashboards or metrics.
- File upload hardening.
- Full content security policy generation for frontend assets beyond a conservative default interface.

## API Design

`SecurityHeaders` should set common defensive headers on every response. Defaults should avoid surprising local development behavior while still being production-oriented:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Opener-Policy: same-origin`
- optional HSTS when enabled
- optional Content Security Policy when configured

`RateLimit` should reject excess requests with `429` and include standard rate-limit headers. The default key should be the best available client IP from forwarding headers, falling back to URL origin. The initial store is memory-only and explicitly process-local.

## Generated App Integration

Generated apps should include `config/security.ts` by default. `start/kernel.ts` should import the config and wire:

- `SecurityHeaders(securityConfig.headers)`
- `RateLimit(securityConfig.rateLimit)`

Rate limiting should be enabled by default with a moderate per-minute limit. Tests should confirm minimal apps get security config without enabling unselected feature configs like cache or queue.

## Error Handling

Rate-limit failures should throw a first-party `TooManyRequestsException` extending `BaseException`, with a stable error code. Headers should be attached before returning the error response where possible, and regular error rendering should remain compatible with the existing HTTP error handler.

## Testing

- Unit tests for default security headers.
- Unit tests for optional HSTS and CSP.
- Unit tests for rate-limit pass/fail and reset headers.
- Generated app tests for `config/security.ts` and kernel wiring.
- Full verification: `bun test`, `bun run typecheck`, `bun run lint`, and `bun run build`.

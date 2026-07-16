import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * Rate-limit window in milliseconds. `@nestjs/throttler` (v6, NestJS 11) expresses each limit's `ttl`
 * in milliseconds, so the per-minute windows below are `60 * 1000`.
 */
export const THROTTLE_WINDOW_MS = 60_000;

/**
 * Name of the single registered throttler.
 *
 * WHY ONE THROTTLER, NOT A NAMED ONE PER CATEGORY. In `@nestjs/throttler` v6 the global `ThrottlerGuard`
 * applies the **logical AND of every registered throttler to every route** — registering N named
 * throttlers means each route is simultaneously subject to all N, and the effective cap is the most
 * restrictive one. `@Throttle({ [name]: { limit } })` only *overrides* that name's limit for the route;
 * it does **not** deselect the other throttlers (that would need `@SkipThrottle` for each of them). Every
 * route in this service belongs to exactly one category (read / write / photo / search) — no route needs
 * layered burst+sustained limits — so the correct model is a single throttler whose limit is the generous
 * read default, with per-route `@Throttle` overrides ({@link WriteRateLimit}/{@link PhotoRateLimit}/
 * {@link SearchRateLimit}) for the tighter categories and `@SkipThrottle()` for health probes. A route
 * that forgets its override then fails **safe** (inherits the generous read limit) rather than silently
 * inheriting the most restrictive one.
 */
export const DEFAULT_THROTTLER_NAME = 'default';

/**
 * Resolve a per-window request limit from an env var, falling back to a default. This keeps the throttle
 * limits configurable via the same `RATE_LIMIT_*` vars the config schema declares (they were previously
 * hardcoded and ignored the env — so a load test or a higher-traffic stage could not raise them).
 * A missing/blank/non-positive-integer value falls back, so a bad override can never disable throttling.
 * Pure aside from reading `process.env`.
 *
 * @param envVar - The env var name (e.g. `RATE_LIMIT_WRITE`).
 * @param fallback - The default limit when the env var is unset or invalid.
 * @returns The resolved positive-integer limit.
 */
export function throttleLimitFromEnv(envVar: string, fallback: number): number {
    const raw = process.env[envVar];

    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }

    const parsed = Number(raw);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read endpoints — the common path (list/detail/get, the Home widget's reads). The most generous limit,
 * and the default any route inherits when it carries no category override. `RATE_LIMIT_READ` req/min
 * (default 120).
 */
export const readLimit = throttleLimitFromEnv('RATE_LIMIT_READ', 120);

/** Mutating endpoints (create/update/delete/clone/visibility/restore/erasure). `RATE_LIMIT_WRITE` req/min (default 30). */
export const writeLimit = throttleLimitFromEnv('RATE_LIMIT_WRITE', 30);

/** Photo-upload endpoints (presign + finalize). `RATE_LIMIT_PHOTO_UPLOAD` req/min (default 10). */
export const photoLimit = throttleLimitFromEnv('RATE_LIMIT_PHOTO_UPLOAD', 10);

/** Full-text/autocomplete search endpoints. `RATE_LIMIT_SEARCH` req/min (default 60). */
export const searchLimit = throttleLimitFromEnv('RATE_LIMIT_SEARCH', 60);

/**
 * The `ThrottlerModule.forRoot(...)` registration: a single throttler whose limit is the generous read
 * default. Category-specific tighter limits are applied per route via the `@Throttle` overrides in
 * `throttle.decorators.ts`. See {@link DEFAULT_THROTTLER_NAME} for why this is one throttler, not many.
 */
export const throttlerModuleOptions: ThrottlerOptions[] = [
    { name: DEFAULT_THROTTLER_NAME, ttl: THROTTLE_WINDOW_MS, limit: readLimit },
];

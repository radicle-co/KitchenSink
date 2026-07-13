/**
 * Rate-limit window in milliseconds. `@nestjs/throttler` (v6, NestJS 11) expresses each named
 * limit's `ttl` in milliseconds, so the per-minute windows below are `60 * 1000`.
 */
export const THROTTLE_WINDOW_MS = 60_000;

/**
 * Route groups the API rate-limits independently. The `@Throttle({ [group]: {} })` decorator on a
 * controller/handler selects which named limit applies.
 */
export const ThrottleGroup = {
    /** Mutating recipe/collection endpoints (create, update, delete). */
    WRITES: 'writes',
    /** Photo-upload endpoints (presign + finalize). */
    PHOTOS: 'photos',
    /** Full-text recipe search endpoints. */
    SEARCH: 'search',
} as const;

/**
 * Name of a rate-limit route group.
 */
export type ThrottleGroup = (typeof ThrottleGroup)[keyof typeof ThrottleGroup];

/**
 * A single named throttle definition, shaped for `ThrottlerModule.forRoot([...])`: `ttl` is the
 * window in milliseconds and `limit` is the max requests per window.
 */
export interface ThrottleGroupDefinition {
    readonly name: ThrottleGroup;
    readonly limit: number;
    readonly ttl: number;
}

/**
 * Resolve a per-window request limit from an env var, falling back to a default. This keeps the throttle
 * limits configurable via the same `RATE_LIMIT_*` vars the config schema declares (they were previously
 * hardcoded here and ignored the env — so a load test or a higher-traffic stage could not raise them).
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
 * Write endpoints: `RATE_LIMIT_WRITE` requests/minute (default 30).
 */
export const writeThrottle: ThrottleGroupDefinition = {
    name: ThrottleGroup.WRITES,
    limit: throttleLimitFromEnv('RATE_LIMIT_WRITE', 30),
    ttl: THROTTLE_WINDOW_MS,
};

/**
 * Photo-upload endpoints: `RATE_LIMIT_PHOTO_UPLOAD` requests/minute (default 10).
 */
export const photoThrottle: ThrottleGroupDefinition = {
    name: ThrottleGroup.PHOTOS,
    limit: throttleLimitFromEnv('RATE_LIMIT_PHOTO_UPLOAD', 10),
    ttl: THROTTLE_WINDOW_MS,
};

/**
 * Search endpoints: `RATE_LIMIT_SEARCH` requests/minute (default 60).
 */
export const searchThrottle: ThrottleGroupDefinition = {
    name: ThrottleGroup.SEARCH,
    limit: throttleLimitFromEnv('RATE_LIMIT_SEARCH', 60),
    ttl: THROTTLE_WINDOW_MS,
};

/**
 * All throttle groups, ready to hand to `ThrottlerModule.forRoot(throttleGroups)`.
 */
export const throttleGroups: readonly ThrottleGroupDefinition[] = [writeThrottle, photoThrottle, searchThrottle];

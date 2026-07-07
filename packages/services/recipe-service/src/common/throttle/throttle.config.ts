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
 * Write endpoints: 30 requests/minute.
 */
export const writeThrottle: ThrottleGroupDefinition = {
    name: ThrottleGroup.WRITES,
    limit: 30,
    ttl: THROTTLE_WINDOW_MS,
};

/**
 * Photo-upload endpoints: 10 requests/minute.
 */
export const photoThrottle: ThrottleGroupDefinition = {
    name: ThrottleGroup.PHOTOS,
    limit: 10,
    ttl: THROTTLE_WINDOW_MS,
};

/**
 * Search endpoints: 60 requests/minute.
 */
export const searchThrottle: ThrottleGroupDefinition = {
    name: ThrottleGroup.SEARCH,
    limit: 60,
    ttl: THROTTLE_WINDOW_MS,
};

/**
 * All throttle groups, ready to hand to `ThrottlerModule.forRoot(throttleGroups)`.
 */
export const throttleGroups: readonly ThrottleGroupDefinition[] = [writeThrottle, photoThrottle, searchThrottle];

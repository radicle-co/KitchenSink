import { Throttle } from '@nestjs/throttler';

import {
    DEFAULT_THROTTLER_NAME,
    THROTTLE_WINDOW_MS,
    exportLimit,
    photoLimit,
    searchLimit,
    writeLimit,
} from './throttle.config.js';

/**
 * Per-category rate-limit overrides for controllers/handlers.
 *
 * Each override targets the single registered throttler ({@link DEFAULT_THROTTLER_NAME}), tightening its
 * limit for the decorated route from the generous read default down to the category's limit. Reads carry
 * NO decorator — they inherit the default read limit (see `throttle.config.ts`). Health probes use
 * `@SkipThrottle()` (imported directly from `@nestjs/throttler`) so a load balancer / ECS probe is never
 * rate-limited into a false "unhealthy".
 *
 * These are thin wrappers over `@Throttle` so the limit-to-category mapping lives in exactly one place;
 * `throttle.config.ts` owns the numeric limits.
 */

/** Cap a mutating route (create/update/delete/clone/visibility/restore/erasure) at the write limit. */
export const WriteRateLimit = (): MethodDecorator & ClassDecorator =>
    Throttle({ [DEFAULT_THROTTLER_NAME]: { limit: writeLimit, ttl: THROTTLE_WINDOW_MS } });

/** Cap a photo-upload route (presign / finalize) at the photo-upload limit. */
export const PhotoRateLimit = (): MethodDecorator & ClassDecorator =>
    Throttle({ [DEFAULT_THROTTLER_NAME]: { limit: photoLimit, ttl: THROTTLE_WINDOW_MS } });

/** Cap a full-text/autocomplete search route at the search limit. */
export const SearchRateLimit = (): MethodDecorator & ClassDecorator =>
    Throttle({ [DEFAULT_THROTTLER_NAME]: { limit: searchLimit, ttl: THROTTLE_WINDOW_MS } });

/** Cap the GDPR account-export route at the (tightest) export limit. */
export const ExportRateLimit = (): MethodDecorator & ClassDecorator =>
    Throttle({ [DEFAULT_THROTTLER_NAME]: { limit: exportLimit, ttl: THROTTLE_WINDOW_MS } });

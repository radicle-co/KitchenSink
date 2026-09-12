/**
 * The decorators that put a per-user cap on a route (plan 002 S3, R42).
 *
 * Each one binds the guard AND the limit together. Apart, each is a silent no-op: `@Throttle` with no guard is
 * metadata nobody reads, and the guard with no `@Throttle` takes the module default. The cap is route-scoped on
 * purpose, because food's other routes serve the recipe service, and a cap there would throttle every cook behind one
 * service principal. `__tests__/throttle.decorators.test.ts` holds the list of capped routes.
 *
 * @pattern Decorator — composes `UseGuards` and `Throttle` into one route annotation
 * @module
 */
import { UseGuards, applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { DEFAULT_THROTTLER_NAME, LIVE_SEARCH_PER_USER_LIMIT, THROTTLE_WINDOW_MS } from './throttle.config.js';
import { UserThrottlerGuard } from './userThrottler.guard.js';

/**
 * Cap the live source search per caller at {@link LIVE_SEARCH_PER_USER_LIMIT} per window.
 *
 * @returns The composed route decorator.
 */
export function LiveSearchRateLimit(): MethodDecorator & ClassDecorator {
    return applyDecorators(
        UseGuards(UserThrottlerGuard),
        Throttle({ [DEFAULT_THROTTLER_NAME]: { limit: LIVE_SEARCH_PER_USER_LIMIT, ttl: THROTTLE_WINDOW_MS } }),
    );
}

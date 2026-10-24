/**
 * The decorators that put a per-user cap on a route (plan 002 S3, R42; security review C2), and the hourly source
 * budget behind it (plan 002, owed before S6).
 *
 * Each one binds the per-minute guard, its limit, the budget's interceptor and the source-call cost together. Apart,
 * each is a silent no-op or a wiring bug: `@Throttle` with no guard is metadata nobody reads, the throttler guard with
 * no `@Throttle` takes the module default, and the budget with no cost fails every request. Nest runs every guard
 * before any interceptor, so the in-memory per-minute cap cuts a burst before the budget reaches the database.
 *
 * The caps sit on the routes a cook calls that make source calls (resolve and the remote pick), and on the food
 * searches. Add and batch stay uncapped by decision: spec 003 FR-043 and FR-043b put no intake cap on add-by-name
 * (owner, 2026-09-15).
 * `__tests__/throttle.decorators.test.ts` holds the list of capped routes.
 *
 * @pattern Decorator — composes `UseGuards`, `Throttle`, `UseInterceptors` and the cost metadata into one annotation
 * @module
 */
import { SetMetadata, UseGuards, UseInterceptors, applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { RequesterSourceBudgetInterceptor } from './requesterSourceBudget.interceptor.js';
import { SearchThrottlerGuard } from './searchThrottler.guard.js';
import { adoptCost, resolveCost, SOURCE_CALL_COST_METADATA } from './sourceCallCost.js';
import {
    ADOPT_PER_USER_LIMIT,
    DEFAULT_THROTTLER_NAME,
    RESOLVE_PER_USER_LIMIT,
    SEARCH_PER_USER_LIMIT,
    THROTTLE_WINDOW_MS,
} from './throttle.config.js';
import { UserThrottlerGuard } from './userThrottler.guard.js';

/**
 * Cap the candidate resolve per caller at {@link RESOLVE_PER_USER_LIMIT} per window, and charge each resolve one call
 * per pick to the caller's hourly source budget, refunding the picks it did not fetch. The recipe service forwards the
 * cook's own bearer on this route and has no fallback credential, so both count each cook, not the service.
 *
 * @returns The composed route decorator.
 */
export function ResolveRateLimit(): MethodDecorator & ClassDecorator {
    return applyDecorators(
        UseGuards(UserThrottlerGuard),
        Throttle({ [DEFAULT_THROTTLER_NAME]: { limit: RESOLVE_PER_USER_LIMIT, ttl: THROTTLE_WINDOW_MS } }),
        UseInterceptors(RequesterSourceBudgetInterceptor),
        SetMetadata(SOURCE_CALL_COST_METADATA, resolveCost),
    );
}

/**
 * Cap the remote pick per caller at {@link ADOPT_PER_USER_LIMIT} per window, and charge each pick the one source call
 * it can make to the caller's hourly source budget, refunding it when the catalog already stood for the item.
 *
 * @returns The composed route decorator.
 */
export function AdoptRateLimit(): MethodDecorator & ClassDecorator {
    return applyDecorators(
        UseGuards(UserThrottlerGuard),
        Throttle({ [DEFAULT_THROTTLER_NAME]: { limit: ADOPT_PER_USER_LIMIT, ttl: THROTTLE_WINDOW_MS } }),
        UseInterceptors(RequesterSourceBudgetInterceptor),
        SetMetadata(SOURCE_CALL_COST_METADATA, adoptCost),
    );
}

/**
 * Cap the split search per caller at {@link SEARCH_PER_USER_LIMIT} per window, refused as `SEARCH_RATE_LIMITED` with
 * no rate-limit headers ({@link SearchThrottlerGuard}). No source budget: the search makes no source call.
 *
 * @returns The composed route decorator.
 */
export function SearchRateLimit(): MethodDecorator & ClassDecorator {
    return applyDecorators(
        UseGuards(SearchThrottlerGuard),
        Throttle({ [DEFAULT_THROTTLER_NAME]: { limit: SEARCH_PER_USER_LIMIT, ttl: THROTTLE_WINDOW_MS } }),
    );
}

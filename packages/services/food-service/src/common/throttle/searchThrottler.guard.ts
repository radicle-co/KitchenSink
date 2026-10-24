/**
 * The per-user throttler for the split food search (plan 002 S3, R42): {@link UserThrottlerGuard}'s per-caller key,
 * with two steps changed.
 *
 * 1. Its refusal is {@link SearchRateLimitedError} (`429 SEARCH_RATE_LIMITED`). The stock per-user refusal means the
 *    cook's source lookups, and the search makes none (property 5b).
 * 2. It writes no rate-limit header. `@nestjs/throttler` puts the caller's own `X-RateLimit-Limit/Remaining/Reset` on
 *    every response it lets through, and the catalog route's `200` is cached at the edge and served to every caller
 *    (ADR-0020), so one caller's counter would reach the rest. The refusal still carries `Retry-After`, which
 *    `ApiExceptionFilter` derives from the error's own window.
 *
 * Bound to a route only through `SearchRateLimit()` in `throttle.decorators.ts`.
 *
 * @pattern Template Method — overrides the stock guard's `handleRequest` and `throwThrottlingException` steps
 * @module
 */
import { Injectable, type ExecutionContext } from '@nestjs/common';
import type { ThrottlerLimitDetail, ThrottlerRequest } from '@nestjs/throttler';

import { SearchRateLimitedError } from '../../foods/foods.errors.js';
import { UserThrottlerGuard } from './userThrottler.guard.js';

/** The per-caller throttler for the split search. */
@Injectable()
export class SearchThrottlerGuard extends UserThrottlerGuard {
    /**
     * Count the request exactly as the stock guard does, with its headers switched off.
     *
     * @param requestProps - The throttler's request, for one named throttler.
     * @returns Whether the request is admitted.
     */
    protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
        return super.handleRequest({ ...requestProps, throttler: { ...requestProps.throttler, setHeaders: false } });
    }

    /**
     * Refuse a caller over its search limit.
     *
     * @param _context - The request's execution context.
     * @param detail - The throttler's record of the refusal; `timeToBlockExpire` is whole seconds, at least 1.
     * @throws {SearchRateLimitedError} always, carrying the block's remaining seconds.
     */
    protected override async throwThrottlingException(
        _context: ExecutionContext,
        detail: ThrottlerLimitDetail,
    ): Promise<void> {
        throw new SearchRateLimitedError(detail.timeToBlockExpire);
    }
}

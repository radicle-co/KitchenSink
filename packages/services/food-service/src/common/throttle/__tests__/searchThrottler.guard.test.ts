/**
 * The split search's per-user limit (plan 002 S3, R42): refused in its OWN code, and with no rate-limit headers.
 *
 * Property 5b: the stock refusal of {@link UserThrottlerGuard} is `REQUESTER_LIMIT_REACHED`, which means the cook's
 * source lookups; the search makes none, so its refusal is `SEARCH_RATE_LIMITED`.
 *
 * Why no headers: the shared catalog route's `200` is cached at the edge and served to every caller (ADR-0020), and
 * `@nestjs/throttler` writes the CALLER's own `X-RateLimit-Remaining` onto every response it lets through. A body
 * shared across callers must not carry one caller's counter.
 *
 * That the limit holds per user over HTTP, and that a refused request never reaches the database, is
 * `tests/catalogSearchApi.integration.test.ts`.
 *
 * @module
 */
import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isRequesterLimitReachedError, isSearchRateLimitedError } from '../../../foods/foods.errors.js';
import { SearchThrottlerGuard } from '../searchThrottler.guard.js';
import { UserThrottlerGuard } from '../userThrottler.guard.js';

/** A route class with one handler and no throttle metadata, so the module options decide the limit. */
class Routes {
    public searchCatalog(): void {}
}

describe('SearchThrottlerGuard', () => {
    const storages: ThrottlerStorageService[] = [];

    afterEach(() => {
        for (const storage of storages.splice(0)) {
            storage.onApplicationShutdown();
        }
    });

    /**
     * One guard over a one-request limit, and a context maker whose response records every header written.
     *
     * @param Guard - The guard class under test.
     * @returns The guard, a context maker and the recorded headers.
     */
    async function makeGuard(Guard: typeof UserThrottlerGuard): Promise<{
        guard: UserThrottlerGuard;
        context: () => ExecutionContextHost;
        header: ReturnType<typeof vi.fn>;
    }> {
        // A fresh store per guard: the counters outlive a case, and each case starts from an unused caller.
        const storage = new ThrottlerStorageService();
        const guard = new Guard([{ name: 'default', ttl: 60_000, limit: 1 }], storage, new Reflector());

        storages.push(storage);
        const request = { user: { sub: 'user_a' }, ip: '10.0.0.1', headers: {} };
        const header = vi.fn();

        await guard.onModuleInit();

        return {
            guard,
            context: () => new ExecutionContextHost([request, { header }], Routes, Routes.prototype.searchCatalog),
            header,
        };
    }

    it('keys on the verified caller, as every food cap does', () => {
        expect(SearchThrottlerGuard.prototype).toBeInstanceOf(UserThrottlerGuard);
    });

    it('⛔ refuses past the limit with SEARCH_RATE_LIMITED, never the source-call limit, carrying the block', async () => {
        const { guard, context } = await makeGuard(SearchThrottlerGuard);

        await expect(guard.canActivate(context())).resolves.toBe(true);

        const refusal: unknown = await guard.canActivate(context()).catch((error: unknown) => error);

        expect(isSearchRateLimitedError(refusal)).toBe(true);
        expect(isRequesterLimitReachedError(refusal)).toBe(false);
        expect(isSearchRateLimitedError(refusal) && refusal.retryAfterSeconds).toBe(60);
    });

    it('⛔ writes no header on a request it lets through, or on one it refuses', async () => {
        const { guard, context, header } = await makeGuard(SearchThrottlerGuard);

        await guard.canActivate(context());
        await guard.canActivate(context()).catch(() => undefined);

        expect(header).not.toHaveBeenCalled();
    });

    // Positive control: without the override the same throttler writes its counters, so the case above can fail.
    it('is the override that stops the headers: the stock per-user guard writes them', async () => {
        const { guard, context, header } = await makeGuard(UserThrottlerGuard);

        await guard.canActivate(context());

        expect(header).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });
});

import 'reflect-metadata';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerGuard, ThrottlerStorageService } from '@nestjs/throttler';

import { photoLimit, readLimit, searchLimit, throttlerModuleOptions, writeLimit } from '../throttle.config.js';
import { UserThrottlerGuard } from '../user-throttler.guard.js';
import { AccountController } from '../../../account/account.controller.js';
import { CollectionsController } from '../../../collections/collections.controller.js';
import { HealthController } from '../../../health/health.controller.js';
import { IngredientsController } from '../../../ingredients/ingredients.controller.js';
import { PhotosController } from '../../../photos/photos.controller.js';
import { RecipesController } from '../../../recipes/recipes.controller.js';
import { SearchController } from '../../../search/search.controller.js';
import { VersionsController } from '../../../versions/versions.controller.js';

/**
 * Behavioural wiring test for the recipe-service rate limiting.
 *
 * It drives the REAL `@nestjs/throttler` v6 `ThrottlerGuard` (with the real in-memory
 * `ThrottlerStorageService` and the service's actual {@link throttlerModuleOptions} registration) against
 * the REAL controller handlers, so it proves the deployed behaviour end-to-end minus the HTTP transport:
 * how many requests each route allows before the guard blocks it. This is the mutation-sensitive pin for
 * the fix — remove a `@WriteRateLimit()`/`@PhotoRateLimit()`/`@SearchRateLimit()` from a handler and its
 * effective cap reverts to the generous read default, breaking the exact-boundary assertion below; remove
 * `@SkipThrottle()` from health and the "never throttled" assertion breaks; re-introduce a second
 * registered throttler (the original defect) and every read route collapses to the photo (10/min) cap.
 *
 * Fake timers keep the sliding window fixed (the storage schedules a per-hit decrement timer and reads
 * `Date.now()` for the window) so counts accumulate deterministically without real timers leaking.
 */

type ControllerClass = new (...args: never[]) => object;
type Handler = (...args: never[]) => unknown;

/** A minimal `ExecutionContext` exposing only what `ThrottlerGuard` reads: the handler, class, and req/res. */
function contextFor(controllerClass: ControllerClass, handler: Handler): ExecutionContext {
    const req = { ip: '203.0.113.7', headers: {} as Record<string, string | undefined> };
    const res = { header: (): void => undefined };

    return {
        getHandler: () => handler,
        getClass: () => controllerClass,
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
}

/** Build a fresh guard + isolated storage so each case counts from zero. */
async function buildGuard(): Promise<ThrottlerGuard> {
    const guard = new ThrottlerGuard(throttlerModuleOptions, new ThrottlerStorageService(), new Reflector());
    await guard.onModuleInit();

    return guard;
}

/**
 * Call `canActivate` up to `max` times and return how many calls were allowed before the guard first
 * threw a `ThrottlerException`. Returns `max` when the route is never throttled within `max` calls.
 */
async function allowedBeforeThrottle(guard: ThrottlerGuard, ctx: ExecutionContext, max: number): Promise<number> {
    for (let attempt = 1; attempt <= max; attempt += 1) {
        try {
            await guard.canActivate(ctx);
        } catch (error) {
            if (error instanceof ThrottlerException) {
                return attempt - 1;
            }

            throw error;
        }
    }

    return max;
}

describe('throttle wiring — effective per-route limits enforced by the real ThrottlerGuard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Every controller handler and the category limit it MUST enforce. Reads carry no decorator and
    // therefore inherit the default (read) limit; this table asserts that inheritance is the generous
    // read limit, not the photo limit the original defect produced.
    const cases: ReadonlyArray<readonly [string, ControllerClass, Handler, number]> = [
        // Reads (inherit the default read limit).
        ['recipes.list (read)', RecipesController, RecipesController.prototype.list, readLimit],
        ['recipes.getById (read)', RecipesController, RecipesController.prototype.getById, readLimit],
        ['collections.list (read)', CollectionsController, CollectionsController.prototype.list, readLimit],
        ['collections.getById (read)', CollectionsController, CollectionsController.prototype.getById, readLimit],
        ['photos.list (read)', PhotosController, PhotosController.prototype.list, readLimit],
        ['versions.list (read)', VersionsController, VersionsController.prototype.list, readLimit],
        [
            'versions.getByVersionNumber (read)',
            VersionsController,
            VersionsController.prototype.getByVersionNumber,
            readLimit,
        ],

        // Writes.
        ['recipes.create (write)', RecipesController, RecipesController.prototype.create, writeLimit],
        ['recipes.update (write)', RecipesController, RecipesController.prototype.update, writeLimit],
        ['recipes.remove (write)', RecipesController, RecipesController.prototype.remove, writeLimit],
        ['recipes.clone (write)', RecipesController, RecipesController.prototype.clone, writeLimit],
        ['recipes.setVisibility (write)', RecipesController, RecipesController.prototype.setVisibility, writeLimit],
        ['collections.create (write)', CollectionsController, CollectionsController.prototype.create, writeLimit],
        ['collections.update (write)', CollectionsController, CollectionsController.prototype.update, writeLimit],
        ['collections.remove (write)', CollectionsController, CollectionsController.prototype.remove, writeLimit],
        ['collections.addRecipe (write)', CollectionsController, CollectionsController.prototype.addRecipe, writeLimit],
        ['collections.clone (write)', CollectionsController, CollectionsController.prototype.clone, writeLimit],
        [
            'collections.pullFromSource (write)',
            CollectionsController,
            CollectionsController.prototype.pullFromSource,
            writeLimit,
        ],
        [
            'collections.removeRecipe (write)',
            CollectionsController,
            CollectionsController.prototype.removeRecipe,
            writeLimit,
        ],
        ['account.requestErasure (write)', AccountController, AccountController.prototype.requestErasure, writeLimit],
        ['ingredients.create (write)', IngredientsController, IngredientsController.prototype.create, writeLimit],
        ['photos.reorder (write)', PhotosController, PhotosController.prototype.reorder, writeLimit],
        ['photos.remove (write)', PhotosController, PhotosController.prototype.remove, writeLimit],
        ['versions.restore (write)', VersionsController, VersionsController.prototype.restore, writeLimit],

        // Photo uploads (the tight cap).
        ['photos.createUploadUrl (photo)', PhotosController, PhotosController.prototype.createUploadUrl, photoLimit],
        ['photos.confirm (photo)', PhotosController, PhotosController.prototype.confirm, photoLimit],

        // Search.
        ['ingredients.search (search)', IngredientsController, IngredientsController.prototype.search, searchLimit],
        ['search.searchRecipes (search)', SearchController, SearchController.prototype.searchRecipes, searchLimit],
    ];

    it.each(cases)(
        'allows exactly the category limit for %s, then blocks',
        async (_label, controller, handler, limit) => {
            const guard = await buildGuard();
            const ctx = contextFor(controller, handler);

            // limit requests pass; the (limit + 1)th is blocked.
            expect(await allowedBeforeThrottle(guard, ctx, limit + 1)).toBe(limit);
        },
    );

    it('allows read endpoints far more than the 10/min the original defect imposed', async () => {
        const guard = await buildGuard();
        const ctx = contextFor(RecipesController, RecipesController.prototype.list);

        // The headline regression: 11 reads used to 429. Prove 11 now sail through unthrottled.
        for (let i = 0; i < 11; i += 1) {
            expect(await guard.canActivate(ctx)).toBe(true);
        }
    });

    it.each([
        ['health.getHealth', HealthController.prototype.getHealth],
        ['health.getReadiness', HealthController.prototype.getReadiness],
    ])('never throttles %s (probes must not be rate-limited into a false unhealthy)', async (_label, handler) => {
        const guard = await buildGuard();
        const ctx = contextFor(HealthController, handler as Handler);

        // Far more than any category limit — a load balancer / ECS probe hammers this continuously.
        expect(await allowedBeforeThrottle(guard, ctx, writeLimit * 5)).toBe(writeLimit * 5);
    });
});

/**
 * Per-authenticated-user tracking — the headline defect this change fixes.
 *
 * The stock guard keys on `req.ip`; behind the shared, internet-facing ALB (no `trust proxy`) that IP is
 * the ALB node for EVERY caller, so the "per-user" limits were in fact ONE global counter. These cases
 * drive the REAL {@link UserThrottlerGuard} to prove the tracker is now the authenticated app-user ULID:
 *
 *   - Two DIFFERENT users on the SAME route (and, deliberately, the SAME source IP) keep INDEPENDENT
 *     counters — user A exhausting the write limit does NOT throttle user B. This is the whole point, and
 *     the mutation pin: revert `getTracker` to `req.ip` and, because both users share one IP, B collapses
 *     into A's exhausted bucket and this test FAILS.
 *   - The SAME user is still limited across requests (the limit is not defeated per-user).
 *   - An UNAUTHENTICATED request falls back to the client IP: two no-principal requests from the same IP
 *     share a bucket, and distinct IPs stay independent.
 */
describe('per-user throttle tracking — UserThrottlerGuard keys on the app-user ULID, not the ALB IP', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** Build a fresh UserThrottlerGuard + isolated storage so each case counts from zero. */
    async function buildUserGuard(): Promise<UserThrottlerGuard> {
        const guard = new UserThrottlerGuard(throttlerModuleOptions, new ThrottlerStorageService(), new Reflector());
        await guard.onModuleInit();

        return guard;
    }

    /** An `ExecutionContext` whose request carries an optional authenticated `principal` and a source IP. */
    function contextForPrincipal(
        controllerClass: ControllerClass,
        handler: Handler,
        options: { userId?: string; ip?: string },
    ): ExecutionContext {
        const req = {
            ip: options.ip ?? '203.0.113.7',
            headers: {} as Record<string, string | undefined>,
            ...(options.userId !== undefined ? { principal: { userId: options.userId } } : {}),
        };
        const res = { header: (): void => undefined };

        return {
            getHandler: () => handler,
            getClass: () => controllerClass,
            switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
        } as unknown as ExecutionContext;
    }

    it('gives two different authenticated users INDEPENDENT write counters (A exhausting does not throttle B)', async () => {
        const guard = await buildUserGuard();
        // SAME route, SAME source IP — so the ONLY thing that can separate their counters is the user ULID.
        const sharedIp = '198.51.100.42';
        const ctxA = contextForPrincipal(RecipesController, RecipesController.prototype.create, {
            userId: '01JUSERAAAAAAAAAAAAAAAAAAA0',
            ip: sharedIp,
        });
        const ctxB = contextForPrincipal(RecipesController, RecipesController.prototype.create, {
            userId: '01JUSERBBBBBBBBBBBBBBBBBBB0',
            ip: sharedIp,
        });

        // User A spends their ENTIRE write budget.
        expect(await allowedBeforeThrottle(guard, ctxA, writeLimit + 1)).toBe(writeLimit);
        // User B — same IP, same route — is untouched: their first request still passes.
        expect(await guard.canActivate(ctxB)).toBe(true);
    });

    it('still limits the SAME authenticated user across requests (per-user limit is enforced, not bypassed)', async () => {
        const guard = await buildUserGuard();
        const ctx = contextForPrincipal(RecipesController, RecipesController.prototype.create, {
            userId: '01JUSERSAMEAAAAAAAAAAAAAAA0',
        });

        // Exactly writeLimit pass, then the same user is blocked.
        expect(await allowedBeforeThrottle(guard, ctx, writeLimit + 1)).toBe(writeLimit);
    });

    it('falls back to the client IP for an UNAUTHENTICATED request (same IP shares a bucket)', async () => {
        const guard = await buildUserGuard();
        // No principal on either request; both share one source IP → one shared counter.
        const ctx1 = contextForPrincipal(RecipesController, RecipesController.prototype.create, { ip: '192.0.2.10' });
        const ctx2 = contextForPrincipal(RecipesController, RecipesController.prototype.create, { ip: '192.0.2.10' });

        // Spend the whole budget across the two contexts (same IP bucket), then the next call is blocked.
        expect(await allowedBeforeThrottle(guard, ctx1, writeLimit)).toBe(writeLimit);
        await expect(guard.canActivate(ctx2)).rejects.toBeInstanceOf(ThrottlerException);
    });

    it('keeps UNAUTHENTICATED requests from DISTINCT IPs on independent counters', async () => {
        const guard = await buildUserGuard();
        const ctxX = contextForPrincipal(RecipesController, RecipesController.prototype.create, { ip: '192.0.2.20' });
        const ctxY = contextForPrincipal(RecipesController, RecipesController.prototype.create, { ip: '192.0.2.21' });

        // IP X spends its whole budget; IP Y is a different bucket and still passes.
        expect(await allowedBeforeThrottle(guard, ctxX, writeLimit + 1)).toBe(writeLimit);
        expect(await guard.canActivate(ctxY)).toBe(true);
    });
});

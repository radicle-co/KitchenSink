/**
 * WHICH food routes carry the per-user cap (plan 002 S3, R42), read off the controller's own metadata.
 *
 * The cap is scoped on purpose: it sits on the routes a cook calls that make source calls, and on the split search a
 * cook calls per keystroke; add-by-name stays uncapped by decision (spec 003 FR-043, FR-043b). So this is a closed list
 * over every route method on `FoodsController`. A route that gains or loses a cap changes this test in the same change.
 *
 * The guard and the limit travel together in one decorator, so neither can be applied without the other: a
 * `@Throttle` with no guard does nothing, and a guard with no `@Throttle` takes whatever the module default is. The
 * same decorator binds the per-requester source budget's interceptor and the cost it charges, for the same reason.
 * That the limits are enforced is `tests/requesterRateLimit.integration.test.ts` and
 * `tests/requesterSourceBudget.integration.test.ts`.
 *
 * @module
 */
import 'reflect-metadata';

import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';

import { FoodsController } from '../../../foods/foods.controller.js';
import { RequesterSourceBudgetInterceptor } from '../requesterSourceBudget.interceptor.js';
import { SearchThrottlerGuard } from '../searchThrottler.guard.js';
import { adoptCost, resolveCost, SOURCE_CALL_COST_METADATA } from '../sourceCallCost.js';
import {
    ADOPT_PER_USER_LIMIT,
    DEFAULT_THROTTLER_NAME,
    SEARCH_PER_USER_LIMIT,
    THROTTLE_WINDOW_MS,
} from '../throttle.config.js';
import { UserThrottlerGuard } from '../userThrottler.guard.js';

/**
 * The guards or interceptors a controller method carries, in the order Nest runs them.
 *
 * @param key - `GUARDS_METADATA` or `INTERCEPTORS_METADATA`.
 * @param name - The method name.
 * @returns The classes, or an empty list.
 */
function boundOn(key: string, name: string): readonly unknown[] {
    const handler: unknown = Reflect.get(FoodsController.prototype, name);
    const bound: unknown = typeof handler === 'function' ? Reflect.getMetadata(key, handler) : [];

    return Array.isArray(bound) ? bound : [];
}

/**
 * Every route method on the controller that carries `unit` under `key`.
 *
 * @param key - `GUARDS_METADATA` or `INTERCEPTORS_METADATA`.
 * @param unit - The guard or interceptor class.
 * @returns The method names, sorted.
 */
function routesBoundTo(key: string, unit: unknown): string[] {
    return Object.getOwnPropertyNames(FoodsController.prototype)
        .filter((name) => name !== 'constructor')
        .filter((name) => boundOn(key, name).includes(unit))
        .sort();
}

/** Every method on the controller's prototype that carries the per-user throttler guard. */
function cappedRoutes(): string[] {
    return routesBoundTo(GUARDS_METADATA, UserThrottlerGuard);
}

describe('the per-user cap on FoodsController', () => {
    it('sits on exactly the routes a cook calls that spend the source window: resolve and the remote pick', () => {
        expect(cappedRoutes()).toEqual(['adoptRemoteFood', 'patchResolve']);
    });

    it('is not on the controller as a whole, which would cap every server-to-server route', () => {
        const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, FoodsController);
        const interceptors: unknown = Reflect.getMetadata(INTERCEPTORS_METADATA, FoodsController);

        expect(Array.isArray(guards) && guards.includes(UserThrottlerGuard)).toBe(false);
        expect(Array.isArray(interceptors) && interceptors.includes(RequesterSourceBudgetInterceptor)).toBe(false);
    });
});

describe('the per-requester source budget on FoodsController', () => {
    it('sits on exactly the capped routes', () => {
        expect(routesBoundTo(INTERCEPTORS_METADATA, RequesterSourceBudgetInterceptor)).toEqual(cappedRoutes());
    });

    // Nest runs every guard before any interceptor, so the in-memory per-minute cap refuses a flood before the budget
    // reaches the database.
    it.each(['adoptRemoteFood', 'patchResolve'])('is an interceptor behind the per-minute guard on %s', (name) => {
        expect(boundOn(GUARDS_METADATA, name)).toEqual([UserThrottlerGuard]);
        expect(boundOn(INTERCEPTORS_METADATA, name)).toEqual([RequesterSourceBudgetInterceptor]);
    });

    it.each([
        ['patchResolve', resolveCost],
        ['adoptRemoteFood', adoptCost],
    ])('charges %s the source calls its handler can make', (name, cost) => {
        const handler: unknown = Reflect.get(FoodsController.prototype, name);

        expect(typeof handler === 'function' && Reflect.getMetadata(SOURCE_CALL_COST_METADATA, handler)).toBe(cost);
    });
});

describe('the remote pick’s per-minute cap (ADR-0055 point 10)', () => {
    it('states its limit and window itself', () => {
        const handler: unknown = Reflect.get(FoodsController.prototype, 'adoptRemoteFood');

        expect(
            typeof handler === 'function' && Reflect.getMetadata(`THROTTLER:LIMIT${DEFAULT_THROTTLER_NAME}`, handler),
        ).toBe(ADOPT_PER_USER_LIMIT);
        expect(
            typeof handler === 'function' && Reflect.getMetadata(`THROTTLER:TTL${DEFAULT_THROTTLER_NAME}`, handler),
        ).toBe(THROTTLE_WINDOW_MS);
    });
});

/**
 * The split search's cap (plan 002 S3, R42): its own guard, its own limit, and NO source budget, because neither
 * search route calls a source. The proxy route it replaces (`/ingredients/suggest`) was on recipe's search budget, and
 * `packages/infra/global/__tests__/proxyCapParity.test.ts` holds food's limit to it.
 */
describe('the per-user search cap on FoodsController (plan 002 S3)', () => {
    it('sits on exactly the search routes: the split pair and the progressive search', () => {
        expect(routesBoundTo(GUARDS_METADATA, SearchThrottlerGuard)).toEqual([
            'searchAuthored',
            'searchCatalog',
            'searchProgressive',
        ]);
    });

    // The progressive search charges the cook's budget per source, at admission (ADR-0055 point 6), never per request.
    it.each(['searchAuthored', 'searchCatalog', 'searchProgressive'])(
        '%s carries the search guard alone, and no source budget',
        (name) => {
            expect(boundOn(GUARDS_METADATA, name)).toEqual([SearchThrottlerGuard]);
            expect(boundOn(INTERCEPTORS_METADATA, name)).toEqual([]);
        },
    );

    it.each(['searchAuthored', 'searchCatalog', 'searchProgressive'])(
        '%s states the search limit and window itself',
        (name) => {
            const handler: unknown = Reflect.get(FoodsController.prototype, name);

            expect(
                typeof handler === 'function' &&
                    Reflect.getMetadata(`THROTTLER:LIMIT${DEFAULT_THROTTLER_NAME}`, handler),
            ).toBe(SEARCH_PER_USER_LIMIT);
            expect(
                typeof handler === 'function' && Reflect.getMetadata(`THROTTLER:TTL${DEFAULT_THROTTLER_NAME}`, handler),
            ).toBe(THROTTLE_WINDOW_MS);
        },
    );
});

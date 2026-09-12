/**
 * WHICH food routes carry the per-user cap (plan 002 S3, R42), read off the controller's own metadata.
 *
 * The cap is scoped on purpose: food's other routes serve the recipe service server to server, and a per-user cap
 * there would throttle every cook behind one service principal. So this is a closed list over every route method
 * on `FoodsController`. A route that gains or loses the cap changes this test in the same change, and S3's
 * cacheable search will add its row here when it lands.
 *
 * The guard and the limit travel together in one decorator, so neither can be applied without the other: a
 * `@Throttle` with no guard does nothing, and a guard with no `@Throttle` takes whatever the module default is.
 * That the limit is enforced is `tests/liveSearchRateLimit.integration.test.ts`.
 *
 * @module
 */
import 'reflect-metadata';

import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';

import { FoodsController } from '../../../foods/foods.controller.js';
import { UserThrottlerGuard } from '../userThrottler.guard.js';

/** Every method on the controller's prototype that carries the per-user throttler guard. */
function cappedRoutes(): string[] {
    const prototype: object = FoodsController.prototype;

    return Object.getOwnPropertyNames(prototype)
        .filter((name) => name !== 'constructor')
        .filter((name) => {
            const handler: unknown = Reflect.get(prototype, name);
            const guards: unknown = typeof handler === 'function' ? Reflect.getMetadata(GUARDS_METADATA, handler) : [];

            return Array.isArray(guards) && guards.includes(UserThrottlerGuard);
        })
        .sort();
}

describe('the per-user cap on FoodsController', () => {
    it('sits on exactly the live source search', () => {
        expect(cappedRoutes()).toEqual(['searchLive']);
    });

    it('is not on the controller as a whole, which would cap every server-to-server route', () => {
        const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, FoodsController);

        expect(Array.isArray(guards) && guards.includes(UserThrottlerGuard)).toBe(false);
    });
});

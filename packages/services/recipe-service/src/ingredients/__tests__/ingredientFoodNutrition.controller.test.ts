/**
 * Route-level contract for `POST /api/v1/ingredients/food-nutrition` (plan 002 U9): what Nest's own metadata says
 * about the handler. That the handler hands the verified caller, the forwarded credential and the refs to the reader
 * is proved over real HTTP by `ingredientFoodNutrition.integration.test.ts`.
 *
 * - Declared BEFORE every `:id` route, or `food-nutrition` binds as an ingredient id.
 * - `200`, not Nest's `201` default: it creates nothing.
 * - ⛔ `@SkipErasureLock()`: the guard keys on the HTTP method, and a POST-shaped read must not answer `423`.
 * - No throttle decorator: a read inherits the default read limit (the census row lives in `throttleWiring`).
 * - `Cache-Control: private, no-store`: the answer varies by caller, so no shared cache may keep it.
 */
import { HEADERS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { SKIP_ERASURE_LOCK } from '../../account/skipErasureLock.decorator.js';
import { IngredientsController } from '../ingredients.controller.js';

/** Handler names in DECLARATION order — the order Nest registers, and therefore matches, routes in. */
function handlerNames(): string[] {
    return Object.getOwnPropertyNames(IngredientsController.prototype).filter((name) => name !== 'constructor');
}

/** The path a handler's method decorator registered. */
function pathOf(handler: string): string | undefined {
    return Reflect.getMetadata(PATH_METADATA, IngredientsController.prototype[handler as never]) as string | undefined;
}

describe('POST /api/v1/ingredients/food-nutrition — routing metadata', () => {
    const handler = IngredientsController.prototype.getFoodNutrition;

    it('⛔ is declared BEFORE every parameterized `:id` route, so nothing can swallow it', () => {
        const names = handlerNames();
        const routeIndex = names.findIndex((name) => pathOf(name) === 'food-nutrition');
        const firstParameterized = names.findIndex((name) => pathOf(name)?.includes(':') === true);

        expect(routeIndex).toBeGreaterThanOrEqual(0);
        expect(firstParameterized).toBeGreaterThanOrEqual(0);
        expect(routeIndex).toBeLessThan(firstParameterized);
    });

    it('is a POST that answers 200', () => {
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    });

    it('⛔ is exempt from the erasure write-lock — a POST-shaped READ must not answer 423', () => {
        expect(Reflect.getMetadata(SKIP_ERASURE_LOCK, handler)).toBe(true);
    });

    it('carries no throttle decorator, so it inherits the read limit', () => {
        const throttleKeys = (target: unknown): string[] =>
            Reflect.getMetadataKeys(target as object).filter((key) => String(key).startsWith('THROTTLER:'));

        // Positive control: a route that DOES carry one.
        expect(throttleKeys(IngredientsController.prototype.create).length).toBeGreaterThan(0);
        expect(throttleKeys(handler)).toStrictEqual([]);
    });

    it('tells every cache not to keep the answer', () => {
        expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toStrictEqual([
            { name: 'Cache-Control', value: 'private, no-store' },
        ]);
    });
});

/**
 * Route-level contract for `POST /api/v1/recipes/nutrition-batch` — the four things about this handler
 * that are invisible in review and only observable in Nest's own metadata.
 *
 *  1. **It is declared BEFORE every `:id` route.** Nest matches in DECLARATION order, so a route added
 *     after a same-shape `:id` pattern is swallowed by it and 404s (or worse, binds `nutrition-batch` as a
 *     recipe id) with nothing in the code to point at. `foods.controller.ts` carries the same warning on
 *     its own `nutrition` route, where the collision is live.
 *  2. **It answers `200`, not `201`.** Nest defaults every `@Post` to `201 Created`, and this endpoint
 *     creates nothing — a `201` on a read would be a lie a client may branch on.
 *  3. **⛔ It is `@SkipErasureLock()`-exempt.** `ErasureLockGuard` keys on the HTTP METHOD
 *     (`MUTATING_METHODS` contains `POST`), so without the exemption a caller with an in-flight account
 *     erasure would get `423` on the calorie badges of a list page that otherwise renders — and EVERY call
 *     would pay an `account_erasure_jobs` round trip on a hot read path. The guard's own docstring says
 *     "HAZ-052 rejects MUTATIONS, not visibility"; this is that rule, on a POST-shaped read.
 *  4. **It carries no `@WriteRateLimit()`.** Reads inherit the default read limit by carrying NO throttle
 *     decorator; tightening this one to the write limit would throttle a viewer for scrolling.
 */
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { HTTP_CODE_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { RecipesController } from '../recipes.controller.js';
import type { RecipesService } from '../recipes.service.js';
import type { AnalyticsService } from '../../analytics/analytics.service.js';
import type { RecipeNutritionRequestDto } from '../dto/recipeNutrition.dto.js';
import { SKIP_ERASURE_LOCK } from '../../account/skipErasureLock.decorator.js';

/** The caller's opaque bearer, forwarded to the food service so it authorizes the read AS this user. */
const CALLER = { kind: 'caller-token' } as never;
const OWNER = '01J000000000000000000FREE0';

/** Handler names in DECLARATION order — the order Nest registers, and therefore matches, routes in. */
function handlerNames(): string[] {
    return Object.getOwnPropertyNames(RecipesController.prototype).filter((name) => name !== 'constructor');
}

/** The path a handler's method decorator registered. */
function pathOf(handler: string): string {
    return Reflect.getMetadata(PATH_METADATA, RecipesController.prototype[handler as never]) as string;
}

describe('POST /api/v1/recipes/nutrition-batch — routing metadata', () => {
    it('⛔ is declared BEFORE every parameterized `:id` route, so nothing can swallow it', () => {
        const names = handlerNames();
        const batchIndex = names.findIndex((name) => pathOf(name) === 'nutrition-batch');
        const firstParameterized = names.findIndex((name) => pathOf(name)?.includes(':'));

        expect(batchIndex).toBeGreaterThanOrEqual(0);
        expect(firstParameterized).toBeGreaterThanOrEqual(0);
        expect(batchIndex).toBeLessThan(firstParameterized);
    });

    it('is a POST that answers 200 — it creates nothing, and Nest would default a POST to 201', () => {
        const handler = RecipesController.prototype.getNutritionBatch;

        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    });

    it('⛔ is exempt from the erasure write-lock — a POST-shaped READ must not answer 423', () => {
        expect(Reflect.getMetadata(SKIP_ERASURE_LOCK, RecipesController.prototype.getNutritionBatch)).toBe(true);
    });

    it('carries no write rate limit — a read inherits the default read limit', () => {
        // Asserted against a route that DOES carry one, so this cannot pass by the metadata key having moved.
        const throttleKeys = (handler: unknown): string[] =>
            Reflect.getMetadataKeys(handler as object).filter((key) => String(key).startsWith('THROTTLER:'));

        expect(throttleKeys(RecipesController.prototype.create).length).toBeGreaterThan(0);
        expect(throttleKeys(RecipesController.prototype.getNutritionBatch)).toStrictEqual([]);
    });
});

describe('RecipesController.getNutritionBatch', () => {
    it('delegates the owner key, the requested ids and the caller bearer, and returns the result verbatim', async () => {
        const response = { nutrition: {} };
        const getNutritionForRecipes = vi.fn().mockResolvedValue(response);
        const controller = new RecipesController(
            { getNutritionForRecipes } as unknown as RecipesService,
            { capture: vi.fn() } as unknown as AnalyticsService,
        );
        const body = { recipeIds: ['00000000-0000-4000-8000-000000000001'] } as RecipeNutritionRequestDto;

        const result = await controller.getNutritionBatch(OWNER, CALLER, body);

        // The owner key (never the Clerk `sub`) scopes the read; the bearer is forwarded so FOOD authorizes
        // the nutrition lookup as this user — dropping it degrades every recipe to nutrition-absent.
        expect(getNutritionForRecipes).toHaveBeenCalledWith(OWNER, body.recipeIds, CALLER);
        expect(result).toBe(response);
    });
});

/**
 * Route-level contract for `GET /api/v1/recipes/private-slots` (ADR-0073): the cook's own private-slot standing, for the
 * editor and the visibility control to show "N of 50 private slots left".
 *
 * Written before the route existed. It pins what review cannot see: the route is declared BEFORE every `:id` route (Nest
 * matches in declaration order, so after `GET :id` it would be a failed UUID parse), it is a plain read on the default read
 * limit, and it hands the service the VERIFIED principal and nothing from the request.
 */
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { Principal } from '../../auth/principal.js';
import type { AnalyticsService } from '../../analytics/analytics.service.js';
import type { IngredientRebindService } from '../ingredientRebind.service.js';
import type { RecipeDetailAssembler } from '../recipeDetail.assembler.js';
import { RecipesController } from '../recipes.controller.js';
import type { RecipesService } from '../recipes.service.js';

const PRINCIPAL: Principal = {
    userId: '01J000000000000000000FREE0',
    sub: 'clerk_sub',
    scopes: [],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
};

function handlerNames(): string[] {
    return Object.getOwnPropertyNames(RecipesController.prototype).filter((name) => name !== 'constructor');
}

function pathOf(handler: string): string {
    return Reflect.getMetadata(PATH_METADATA, RecipesController.prototype[handler as never]) as string;
}

describe('GET /api/v1/recipes/private-slots - routing metadata', () => {
    it('is declared BEFORE every parameterized `:id` route, so `GET :id` cannot swallow it', () => {
        const names = handlerNames();
        const slotsIndex = names.findIndex((name) => pathOf(name) === 'private-slots');
        const firstParameterized = names.findIndex((name) => pathOf(name)?.includes(':'));

        expect(slotsIndex).toBeGreaterThanOrEqual(0);
        expect(slotsIndex).toBeLessThan(firstParameterized);
    });

    it('is a GET with no write rate limit', () => {
        const handler = RecipesController.prototype.getPrivateSlots;
        const throttleKeys = Reflect.getMetadataKeys(handler as object).filter((key) =>
            String(key).startsWith('THROTTLER:'),
        );

        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
        expect(throttleKeys).toStrictEqual([]);
    });
});

describe('RecipesController.getPrivateSlots', () => {
    it('delegates the verified principal to the service and returns its answer verbatim', async () => {
        const usage = { kind: 'limited', used: 12, limit: 50 } as const;
        const getPrivateSlotUsage = vi.fn().mockResolvedValue(usage);
        const controller = new RecipesController(
            { getPrivateSlotUsage } as unknown as RecipesService,
            {} as RecipeDetailAssembler,
            {} as AnalyticsService,
            {} as IngredientRebindService,
        );

        await expect(controller.getPrivateSlots(PRINCIPAL)).resolves.toBe(usage);
        expect(getPrivateSlotUsage).toHaveBeenCalledWith(PRINCIPAL);
    });
});

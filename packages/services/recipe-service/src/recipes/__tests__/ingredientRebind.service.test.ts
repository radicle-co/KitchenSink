/**
 * `IngredientRebindService` — move ONE recipe line to another food (plan 002 U5, R17, AE3, AE6, AE9, AE11).
 *
 * The command owns the line's intent and delegates the write to the recipe update path. What this file pins, over
 * doubles, is the ORDER of its effects and which of them happen:
 *
 * 1. ownership and version are checked before anything is written;
 * 2. the target is bound before the correction, so the privacy fact exists when the correction's reach is decided;
 * 3. the correction is recorded BEFORE the line is repointed (R17), and only when the line moved to a food;
 * 4. the line is repointed through the update path, every other line unchanged;
 * 5. the binding the line left is deleted AFTER the update commits, and only if nothing else uses it (AE9).
 */
import { describe, expect, it, vi } from 'vitest';
import { RecipeErrorCode, type Ingredient } from '@kitchensink/recipe-core';
import { HttpException } from '@nestjs/common';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import type { Principal } from '../../auth/principal.js';
import {
    fakeFoodLookupsDal,
    makeRootArm,
    makeUnresolvedArm,
} from '../../ingredients/__fixtures__/foodLookups.fixture.js';
import type { FoodLookupArm } from '../../database/schema/foodLookupArm.js';
import type { IngredientsService } from '../../ingredients/ingredients.service.js';
import type { ResolutionMappingsService } from '../../ingredients/resolution/resolutionMappings.service.js';
import type { RecipeAggregate } from '../dal/recipes.dal.js';
import { IngredientRebindService } from '../ingredientRebind.service.js';
import { isRecipeDomainError, versionConflict } from '../recipe.error.js';
import type { RecipesService } from '../recipes.service.js';

const OWNER = '01JREBIND0000000000000OWNER';
const PRINCIPAL: Principal = {
    userId: OWNER,
    sub: 'user_clerk',
    scopes: [],
    permissions: [],
    principalKind: 'real',
    containment: 'enforce',
};
const CALLER = { kind: 'caller-token' } as never;
const DETAIL = { id: 'r-1', currentVersion: 4 } as never;

const UNMATCHED = makeUnresolvedArm({
    lookupId: 'l-unmatched',
    failure: { name: 'flibbertigibbet', reasonCode: 'no_source_has_it', status: 'NOT_FOUND' },
});
const BOUND = makeRootArm({ lookupId: 'l-bound', foodId: 'food-a' });

/** A three-line recipe at version 3; the middle line (position 1) is bound to `middle`. */
function aggregateWith(middle: FoodLookupArm, sourcePhrase: string | null = null): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, currentVersion: 3 });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [
            makeIngredientLineRow({ id: 'line-0', foodLookupId: 'l-first', unit: 'g', sortOrder: 0 }),
            makeIngredientLineRow({
                id: 'line-1',
                foodLookupId: middle.lookupId,
                quantity: '2',
                unit: 'cup',
                preparation: 'minced',
                groupLabel: 'Sauce',
                sourcePhrase,
                sortOrder: 1,
            }),
            makeIngredientLineRow({ id: 'line-2', foodLookupId: 'l-last', unit: '', sortOrder: 2 }),
        ],
    };
}

const bound = (id: string, foodId: string | undefined): Ingredient =>
    ({ id, ...(foodId === undefined ? {} : { foodId }) }) as Ingredient;

function build(aggregate: RecipeAggregate, arms: readonly FoodLookupArm[], target: Ingredient) {
    const recipes = {
        findEditableAggregate: vi.fn().mockResolvedValue(aggregate),
        update: vi.fn().mockResolvedValue(DETAIL),
        getById: vi.fn().mockResolvedValue(DETAIL),
    };
    const ingredients = {
        addByFoodId: vi.fn().mockResolvedValue(target),
        addByName: vi.fn().mockResolvedValue(target),
    };
    const corrections = { recordCorrection: vi.fn().mockResolvedValue({ written: true }) };
    const lookups = fakeFoodLookupsDal(...arms);
    const deleteIfOrphanedFailure = vi.fn().mockResolvedValue(true);

    Object.assign(lookups, { deleteIfOrphanedFailure });

    return {
        service: new IngredientRebindService(
            recipes as unknown as RecipesService,
            ingredients as unknown as IngredientsService,
            corrections as unknown as ResolutionMappingsService,
            lookups,
        ),
        recipes,
        ingredients,
        corrections,
        deleteIfOrphanedFailure,
    };
}

const byFood = { expectedVersion: 3, target: { kind: 'catalogFood', foodId: 'food-b' } } as const;

describe('IngredientRebindService.rebind — the order of its effects', () => {
    it('checks, binds, corrects, repoints, THEN deletes the binding it left — in that order', async () => {
        const { service, recipes, ingredients, corrections, deleteIfOrphanedFailure } = build(
            aggregateWith(UNMATCHED),
            [UNMATCHED],
            bound('l-new', 'food-b'),
        );

        const response = await service.rebind(PRINCIPAL, 'r-1', 1, byFood, CALLER);

        expect(response).toBe(DETAIL);
        expect(recipes.findEditableAggregate).toHaveBeenCalledWith(OWNER, 'r-1', 3, CALLER);
        expect(ingredients.addByFoodId).toHaveBeenCalledWith(CALLER, 'food-b', OWNER);
        expect(corrections.recordCorrection).toHaveBeenCalledWith({
            principal: PRINCIPAL,
            phrase: 'flibbertigibbet',
            foodId: 'food-b',
            surfacing: 'row_rebind',
            caller: CALLER,
        });
        expect(deleteIfOrphanedFailure).toHaveBeenCalledWith('l-unmatched');

        const order = [
            recipes.findEditableAggregate,
            ingredients.addByFoodId,
            corrections.recordCorrection,
            recipes.update,
            deleteIfOrphanedFailure,
        ].map((spy) => spy.mock.invocationCallOrder[0] ?? Number.NaN);
        expect(order).toStrictEqual([...order].sort((a, b) => a - b));
    });

    it('repoints ONLY the line at the position, keeping its amount, unit, preparation and section (AE11)', async () => {
        const { service, recipes } = build(aggregateWith(UNMATCHED), [UNMATCHED], bound('l-new', 'food-b'));

        await service.rebind(PRINCIPAL, 'r-1', 1, byFood, CALLER);

        expect(recipes.update).toHaveBeenCalledWith(
            PRINCIPAL,
            'r-1',
            {
                expectedVersion: 3,
                ingredients: [
                    { ingredientId: 'l-first', quantity: { kind: 'exact', value: 1 }, unit: 'g' },
                    {
                        ingredientId: 'l-new',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'cup',
                        preparation: 'minced',
                        groupLabel: 'Sauce',
                    },
                    { ingredientId: 'l-last', quantity: { kind: 'exact', value: 1 } },
                ],
            },
            CALLER,
            { snapshot: { changeSummary: 'Changed ingredient' } },
        );
    });

    it('⛔ records NO correction when the name did not resolve to a food — the line shows its new reason (AE6)', async () => {
        const { service, ingredients, corrections, recipes } = build(
            aggregateWith(UNMATCHED),
            [UNMATCHED],
            bound('l-still-unmatched', undefined),
        );

        await service.rebind(
            PRINCIPAL,
            'r-1',
            1,
            { expectedVersion: 3, target: { kind: 'name', name: 'flibber' } },
            CALLER,
        );

        expect(ingredients.addByName).toHaveBeenCalledWith(CALLER, 'flibber', OWNER);
        expect(corrections.recordCorrection).not.toHaveBeenCalled();
        expect(recipes.update).toHaveBeenCalled();
    });

    it.each([
        ['food could not be asked', 'sources_errored'],
        ['a cascade tier was down', 'cascade_unavailable'],
    ] as const)(
        '⛔ refuses a name target with 502 when %s — no recipe write, no correction (the by-food rule)',
        async (_label, reasonCode) => {
            const couldNotLook = makeUnresolvedArm({
                lookupId: 'l-could-not-look',
                failure: {
                    name: 'yuzu kosho',
                    reasonCode,
                    status: 'FAILED',
                    ...(reasonCode === 'cascade_unavailable'
                        ? { tiersConsulted: ['curated'], tiersUnavailable: ['curated'] }
                        : {}),
                },
            });
            const { service, corrections, recipes } = build(
                aggregateWith(UNMATCHED),
                [UNMATCHED, couldNotLook],
                bound('l-could-not-look', undefined),
            );

            const outcome = await service
                .rebind(
                    PRINCIPAL,
                    'r-1',
                    1,
                    { expectedVersion: 3, target: { kind: 'name', name: 'yuzu kosho' } },
                    CALLER,
                )
                .then(
                    () => 'rebound',
                    (error: unknown) => error,
                );

            expect(outcome).toMatchObject({ response: { code: 'SOURCE_UNAVAILABLE' } });
            expect(corrections.recordCorrection).not.toHaveBeenCalled();
            expect(recipes.update).not.toHaveBeenCalled();
        },
    );

    it('⛔ records NO correction for a bound line with no phrase — a catalog name is not an unmatched name', async () => {
        const { service, corrections, recipes } = build(aggregateWith(BOUND), [BOUND], bound('l-new', 'food-b'));

        await service.rebind(PRINCIPAL, 'r-1', 1, byFood, CALLER);

        expect(corrections.recordCorrection).not.toHaveBeenCalled();
        expect(recipes.update).toHaveBeenCalled();
    });

    it('teaches the line’s parsed phrase when it has one, even for a bound line', async () => {
        const { service, corrections } = build(aggregateWith(BOUND, 'plain flour'), [BOUND], bound('l-new', 'food-b'));

        await service.rebind(PRINCIPAL, 'r-1', 1, byFood, CALLER);

        expect(corrections.recordCorrection).toHaveBeenCalledWith(expect.objectContaining({ phrase: 'plain flour' }));
    });
});

describe('IngredientRebindService.rebind — what it refuses to write', () => {
    it('⛔ writes nothing when the version is stale — the check comes before the bind and the correction', async () => {
        const { service, recipes, ingredients, corrections } = build(
            aggregateWith(UNMATCHED),
            [UNMATCHED],
            bound('l-new', 'food-b'),
        );
        recipes.findEditableAggregate.mockRejectedValue(versionConflict(4, 3));

        const error = await service.rebind(PRINCIPAL, 'r-1', 1, byFood, CALLER).catch((caught: unknown) => caught);

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.VERSION_CONFLICT);
        expect(ingredients.addByFoodId).not.toHaveBeenCalled();
        expect(corrections.recordCorrection).not.toHaveBeenCalled();
        expect(recipes.update).not.toHaveBeenCalled();
    });

    it('⛔ refuses a position with no line as a validation failure, before any write', async () => {
        const { service, ingredients, recipes } = build(
            aggregateWith(UNMATCHED),
            [UNMATCHED],
            bound('l-new', 'food-b'),
        );

        const error = await service.rebind(PRINCIPAL, 'r-1', 7, byFood, CALLER).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getResponse()).toMatchObject({
            code: 'VALIDATION_FAILED',
            details: { fields: ['position: no ingredient line at position 7'] },
        });
        expect(ingredients.addByFoodId).not.toHaveBeenCalled();
        expect(recipes.update).not.toHaveBeenCalled();
    });

    it('⛔ does NOT repoint when the correction write fails — the correction comes first or not at all (R17)', async () => {
        const { service, corrections, recipes } = build(
            aggregateWith(UNMATCHED),
            [UNMATCHED],
            bound('l-new', 'food-b'),
        );
        corrections.recordCorrection.mockRejectedValue(new Error('mappings unavailable'));

        await expect(service.rebind(PRINCIPAL, 'r-1', 1, byFood, CALLER)).rejects.toThrow('mappings unavailable');
        expect(recipes.update).not.toHaveBeenCalled();
    });

    it('⛔ mints no version when the target IS the line’s current binding — it answers the current detail', async () => {
        const { service, corrections, recipes, deleteIfOrphanedFailure } = build(
            aggregateWith(BOUND),
            [BOUND],
            bound('l-bound', 'food-a'),
        );

        const response = await service.rebind(PRINCIPAL, 'r-1', 1, byFood, CALLER);

        expect(response).toBe(DETAIL);
        expect(recipes.getById).toHaveBeenCalledWith({ viewerId: OWNER, id: 'r-1', caller: CALLER, budget: 'read' });
        expect(recipes.update).not.toHaveBeenCalled();
        expect(corrections.recordCorrection).not.toHaveBeenCalled();
        expect(deleteIfOrphanedFailure).not.toHaveBeenCalled();
    });

    it('still answers the committed rebind when deleting the left binding fails — an orphan waits for the reaper', async () => {
        const { service, deleteIfOrphanedFailure } = build(
            aggregateWith(UNMATCHED),
            [UNMATCHED],
            bound('l-new', 'food-b'),
        );
        deleteIfOrphanedFailure.mockRejectedValue(new Error('connection reset'));

        await expect(service.rebind(PRINCIPAL, 'r-1', 1, byFood, CALLER)).resolves.toBe(DETAIL);
    });
});

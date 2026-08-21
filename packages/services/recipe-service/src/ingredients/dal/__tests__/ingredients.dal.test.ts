import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../../database/database.module.js';
import { makeCanonicalName, makeRawIngredientRow } from '../../__fixtures__/ingredients.fixtures.js';
import {
    IngredientsDal,
    rowToIngredient,
    clampLimit,
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT,
} from '../ingredients.dal.js';

/** A minimal `db.execute` mock returning a fixed `{ rows }` result. */
function makeDb(): { db: RecipeDrizzle; execute: ReturnType<typeof vi.fn> } {
    const execute = vi.fn();
    const db = { execute } as unknown as RecipeDrizzle;

    return { db, execute };
}

describe('rowToIngredient', () => {
    it('maps a raw snake_case row to the domain shape — REFERENCE fields only (U10)', () => {
        const ingredient = rowToIngredient(
            makeRawIngredientRow({
                id: 'id-1',
                name: 'Butter',
                food_id: '01J0FOOD',
                food_resolution_status: 'RESOLVED',
                is_user_entered: false,
                created_at: '2026-07-01T00:00:00.000Z',
            }) as never,
        );

        expect(ingredient).toEqual({
            id: 'id-1',
            name: 'Butter',
            foodId: '01J0FOOD',
            foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            isUserEntered: false,
            // ⛔ No nutrition. The row carries the food REFERENCE; the numbers live in the food service and
            // are read at request time (U10) — a projection that returned them here would be reading columns
            // migration 0019 dropped.
            createdAt: '2026-07-01T00:00:00.000Z',
        });
    });

    it('maps null food + nutrition columns to undefined (freeform ingredient)', () => {
        const ingredient = rowToIngredient(makeRawIngredientRow({ is_user_entered: true }) as never);

        expect(ingredient.foodId).toBeUndefined();
        expect(ingredient.foodResolutionStatus).toBeUndefined();
        expect(ingredient.caloriesPer100g).toBeUndefined();
        expect(ingredient.isUserEntered).toBe(true);
    });

    it('normalizes a Date created_at to an ISO-8601 string', () => {
        const ingredient = rowToIngredient(
            makeRawIngredientRow({ created_at: new Date('2026-07-01T12:00:00.000Z') }) as never,
        );

        expect(ingredient.createdAt).toBe('2026-07-01T12:00:00.000Z');
    });
});

describe('IngredientsDal', () => {
    let db: RecipeDrizzle;
    let execute: ReturnType<typeof vi.fn>;
    let dal: IngredientsDal;

    beforeEach(() => {
        ({ db, execute } = makeDb());
        dal = new IngredientsDal(db);
    });

    describe('search', () => {
        it('short-circuits an empty query without touching the database', async () => {
            const results = await dal.search('');

            expect(results).toEqual([]);
            expect(execute).not.toHaveBeenCalled();
        });

        it('returns the mapped rows for a non-empty query (fuzzy + FTS single read)', async () => {
            execute.mockResolvedValue({
                rows: [
                    makeRawIngredientRow({ id: 'a', name: 'flour' }),
                    makeRawIngredientRow({ id: 'b', name: 'flower' }),
                ],
            });

            const results = await dal.search('flour', 5);

            expect(execute).toHaveBeenCalledTimes(1);
            expect(results.map((r) => r.id)).toEqual(['a', 'b']);
            expect(results[0]!.name).toBe('flour');
        });

        it('issues a single ranked read for a non-empty query', async () => {
            execute.mockResolvedValue({ rows: [] });

            await dal.search('flour', 5);

            expect(execute).toHaveBeenCalledTimes(1);
        });
    });

    describe('clampLimit', () => {
        it('defaults an absent or non-finite limit', () => {
            expect(clampLimit(undefined)).toBe(DEFAULT_SEARCH_LIMIT);
            expect(clampLimit(Number.NaN)).toBe(DEFAULT_SEARCH_LIMIT);
        });

        it('clamps into [1, MAX_SEARCH_LIMIT] and truncates fractional values', () => {
            expect(clampLimit(0)).toBe(1);
            expect(clampLimit(-5)).toBe(1);
            expect(clampLimit(999)).toBe(MAX_SEARCH_LIMIT);
            expect(clampLimit(7.9)).toBe(7);
        });
    });

    describe('findById / findByFoodId / findFreeformByName', () => {
        it('findById returns the mapped row when present', async () => {
            execute.mockResolvedValue({ rows: [makeRawIngredientRow({ id: 'x' })] });

            const found = await dal.findById('x');

            expect(found?.id).toBe('x');
        });

        it('findById returns undefined when absent', async () => {
            execute.mockResolvedValue({ rows: [] });

            expect(await dal.findById('missing')).toBeUndefined();
        });

        it('findByFoodId returns the mapped row', async () => {
            execute.mockResolvedValue({ rows: [makeRawIngredientRow({ id: 'y', food_id: 'F1' })] });

            const found = await dal.findByFoodId('F1');

            expect(found?.foodId).toBe('F1');
        });

        it('findFreeformByName returns undefined when no freeform match', async () => {
            execute.mockResolvedValue({ rows: [] });

            expect(await dal.findFreeformByName('nope')).toBeUndefined();
        });
    });

    // Stage 2 — the batch crosswalk the blended typeahead deduplicates on.
    describe('findByFoodIds', () => {
        it('short-circuits an empty id list without touching the database', async () => {
            expect(await dal.findByFoodIds([])).toEqual([]);
            expect(execute).not.toHaveBeenCalled();
        });

        it('returns the mapped rows for the requested food ids in ONE read', async () => {
            execute.mockResolvedValue({
                rows: [
                    makeRawIngredientRow({ id: 'ing-1', food_id: 'F1' }),
                    makeRawIngredientRow({ id: 'ing-2', food_id: 'F2' }),
                ],
            });

            const found = await dal.findByFoodIds(['F1', 'F2', 'F3']);

            expect(execute).toHaveBeenCalledTimes(1);
            expect(found.map((ingredient) => ingredient.foodId)).toEqual(['F1', 'F2']);
        });

        it('returns an empty array when no requested food has a catalog row', async () => {
            execute.mockResolvedValue({ rows: [] });

            expect(await dal.findByFoodIds(['F9'])).toEqual([]);
        });
    });

    describe('createFreeform', () => {
        it('dedups: returns the existing freeform row without inserting', async () => {
            execute.mockResolvedValueOnce({ rows: [makeRawIngredientRow({ id: 'dup', is_user_entered: true })] });

            const result = await dal.createFreeform(makeCanonicalName('All-purpose flour'));

            expect(result.id).toBe('dup');
            expect(execute).toHaveBeenCalledTimes(1); // dedup lookup only, no insert
        });

        it('inserts a new user-entered row when none exists', async () => {
            execute
                .mockResolvedValueOnce({ rows: [] }) // dedup lookup: miss
                .mockResolvedValueOnce({ rows: [makeRawIngredientRow({ id: 'new', is_user_entered: true })] });

            const result = await dal.createFreeform(makeCanonicalName('Nonna secret spice'));

            expect(execute).toHaveBeenCalledTimes(2);
            expect(result.id).toBe('new');
            expect(result.isUserEntered).toBe(true);
        });

        it('lost the insert race (ON CONFLICT no-op) → re-reads and returns the winner row', async () => {
            execute
                .mockResolvedValueOnce({ rows: [] }) // dedup lookup: miss (a concurrent txn inserts here)
                .mockResolvedValueOnce({ rows: [] }) // INSERT … ON CONFLICT DO NOTHING → conflicted, no row
                .mockResolvedValueOnce({ rows: [makeRawIngredientRow({ id: 'winner', is_user_entered: true })] });

            const result = await dal.createFreeform(makeCanonicalName('Contested name'));

            expect(execute).toHaveBeenCalledTimes(3); // dedup miss → insert no-op → re-read winner
            expect(result.id).toBe('winner');
        });
    });

    describe('createFoodBacked', () => {
        it('dedups on food_id: returns the existing row without inserting', async () => {
            execute.mockResolvedValueOnce({ rows: [makeRawIngredientRow({ id: 'dup', food_id: 'F9' })] });

            const result = await dal.createFoodBacked({
                name: makeCanonicalName('Flour'),
                foodId: 'F9',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });

            expect(result.id).toBe('dup');
            expect(execute).toHaveBeenCalledTimes(1);
        });

        it('inserts a new food-backed row (is_user_entered = false) when the food is new', async () => {
            execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
                rows: [makeRawIngredientRow({ id: 'fb', food_id: 'F9', food_resolution_status: 'PENDING' })],
            });

            const result = await dal.createFoodBacked({
                name: makeCanonicalName('Flour'),
                foodId: 'F9',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });

            expect(execute).toHaveBeenCalledTimes(2);
            expect(result.foodId).toBe('F9');
            expect(result.foodResolutionStatus).toBe(FoodResolutionStatus.PENDING);
            expect(result.isUserEntered).toBe(false);
        });

        it('lost the food_id insert race (ON CONFLICT no-op) → re-reads and returns the winner row', async () => {
            execute
                .mockResolvedValueOnce({ rows: [] }) // dedup lookup on food_id: miss
                .mockResolvedValueOnce({ rows: [] }) // INSERT … ON CONFLICT DO NOTHING → conflicted, no row
                .mockResolvedValueOnce({ rows: [makeRawIngredientRow({ id: 'winner', food_id: 'F9' })] });

            const result = await dal.createFoodBacked({
                name: makeCanonicalName('Flour'),
                foodId: 'F9',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });

            expect(execute).toHaveBeenCalledTimes(3);
            expect(result.id).toBe('winner');
            expect(result.foodId).toBe('F9');
        });
    });

    describe('updateResolution', () => {
        it('returns the updated row with resolved status + nutrition', async () => {
            execute.mockResolvedValue({
                rows: [
                    makeRawIngredientRow({
                        id: 'u',
                        food_id: 'F1',
                        food_resolution_status: 'RESOLVED',
                    }),
                ],
            });

            // U10: `updateResolution` persists the STATUS only. Nutrition is food's, read live.
            const result = await dal.updateResolution('u', {
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });

            expect(result?.foodResolutionStatus).toBe(FoodResolutionStatus.RESOLVED);
            expect(result).not.toHaveProperty('caloriesPer100g');
        });

        it('returns undefined when the id does not exist', async () => {
            execute.mockResolvedValue({ rows: [] });

            const result = await dal.updateResolution('missing', {
                foodResolutionStatus: FoodResolutionStatus.FAILED,
            });

            expect(result).toBeUndefined();
        });
    });
});

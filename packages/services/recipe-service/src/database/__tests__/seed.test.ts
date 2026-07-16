/**
 * Unit coverage for the deterministic seed data (T096): the ingredient/recipe/collection ids must be
 * valid, unique UUIDs (they target `uuid` columns) and the collection's members must reference real seed
 * recipes — so a re-seed is a no-op and the fixture can never insert a dangling membership.
 */
import { describe, expect, it } from 'vitest';

import { SEED_COLLECTION, SEED_INGREDIENTS, SEED_OWNER_FREE, SEED_OWNER_PRO, SEED_RECIPES } from '../seed.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('recipe seed data', () => {
    it('seeds exactly 5 recipes with valid, unique UUID ids', () => {
        expect(SEED_RECIPES).toHaveLength(5);

        for (const r of SEED_RECIPES) {
            expect(r.id).toMatch(UUID);
        }

        expect(new Set(SEED_RECIPES.map((r) => r.id)).size).toBe(5);
    });

    it('honors the recipe CHECK constraints (positive servings, non-negative + consistent times)', () => {
        for (const r of SEED_RECIPES) {
            expect(r.servings).toBeGreaterThan(0);
            expect(r.prepTimeMinutes).toBeGreaterThanOrEqual(0);
            expect(r.cookTimeMinutes).toBeGreaterThanOrEqual(0);
            expect(r.totalTimeMinutes).toBe(r.prepTimeMinutes + r.cookTimeMinutes);
            expect(['public', 'private']).toContain(r.visibility);
        }
    });

    it('assigns recipes across the two stable owners', () => {
        const owners = new Set(SEED_RECIPES.map((r) => r.ownerId));
        expect(owners).toEqual(new Set([SEED_OWNER_FREE, SEED_OWNER_PRO]));
    });

    it('seeds the ingredient catalog as [Flour, Sugar, Butter] with valid, unique UUID ids', () => {
        // Order AND names are load-bearing: the composition integration spec destructures
        // `[FLOUR, SUGAR] = SEED_INGREDIENTS` and asserts the catalog names on read-back, and the catalog
        // is what recipe create/update validates each line's `ingredientId` against (T043b).
        expect(SEED_INGREDIENTS.map((i) => i.name)).toEqual(['Flour', 'Sugar', 'Butter']);

        for (const ingredient of SEED_INGREDIENTS) {
            expect(ingredient.id).toMatch(UUID);
        }

        expect(new Set(SEED_INGREDIENTS.map((i) => i.id)).size).toBe(SEED_INGREDIENTS.length);
    });

    it('collection has a valid UUID and references only real seed recipes owned by its owner', () => {
        expect(SEED_COLLECTION.id).toMatch(UUID);
        const byId = new Map(SEED_RECIPES.map((r) => [r.id, r]));

        for (const recipeId of SEED_COLLECTION.recipeIds) {
            const recipe = byId.get(recipeId);
            expect(recipe).toBeDefined();
            expect(recipe?.ownerId).toBe(SEED_COLLECTION.ownerId);
        }
    });
});

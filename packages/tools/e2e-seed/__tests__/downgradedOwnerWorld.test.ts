/**
 * The downgraded owner's world (plan 2026-10-14-009 T2): ONE private recipe and ONE private collection with fixed titles,
 * written once while the lane is premium and never reset. The decision is pure, so what must hold is asserted without a
 * network: a missing item is created, a standing private one is kept, and anything else under the same name is removed
 * so the flow can match exactly one row.
 */
import { describe, expect, it } from 'vitest';

import { planDowngradedOwnerWorld, type DowngradedOwnerSnapshot } from '../src/downgradedOwnerWorld.js';
import { DOWNGRADED_OWNER_WORLD } from '../src/fixtureManifest.js';

const empty: DowngradedOwnerSnapshot = { recipes: [], collections: [] };
const recipe = (id: string, visibility: 'public' | 'private', title = DOWNGRADED_OWNER_WORLD.recipe.title) => ({
    id,
    title,
    visibility,
});
const collection = (id: string, visibility: 'public' | 'private', name = DOWNGRADED_OWNER_WORLD.collectionName) => ({
    id,
    name,
    visibility,
});

describe('the downgraded owner’s world', () => {
    it('is PRIVATE and has fixed names — never run-scoped, because nothing resets it', () => {
        expect(DOWNGRADED_OWNER_WORLD.recipe.visibility).toBe('private');
        expect(DOWNGRADED_OWNER_WORLD.recipe.title).toBe(DOWNGRADED_OWNER_WORLD.recipe.baseTitle);
        expect(DOWNGRADED_OWNER_WORLD.collectionName).not.toBe('');
    });

    it('creates both from nothing', () => {
        expect(planDowngradedOwnerWorld(empty)).toEqual({
            createRecipe: true,
            deleteRecipeIds: [],
            createCollection: true,
            deleteCollectionIds: [],
        });
    });

    it('⛔ changes nothing when both stand private — a run twice is a run once', () => {
        expect(
            planDowngradedOwnerWorld({
                recipes: [recipe('r1', 'private')],
                collections: [collection('c1', 'private')],
            }),
        ).toEqual({ createRecipe: false, deleteRecipeIds: [], createCollection: false, deleteCollectionIds: [] });
    });

    it('replaces a recipe or collection under the name that is PUBLIC, because the flow needs a private one', () => {
        expect(
            planDowngradedOwnerWorld({ recipes: [recipe('r1', 'public')], collections: [collection('c1', 'public')] }),
        ).toEqual({ createRecipe: true, deleteRecipeIds: ['r1'], createCollection: true, deleteCollectionIds: ['c1'] });
    });

    it('keeps the first private duplicate and removes the rest, so one row matches', () => {
        const plan = planDowngradedOwnerWorld({
            recipes: [recipe('r1', 'private'), recipe('r2', 'private')],
            collections: [collection('c1', 'private'), collection('c2', 'public'), collection('c3', 'private')],
        });

        expect(plan.deleteRecipeIds).toEqual(['r2']);
        expect(plan.deleteCollectionIds).toEqual(['c2', 'c3']);
        expect(plan.createRecipe).toBe(false);
        expect(plan.createCollection).toBe(false);
    });

    it('⛔ never touches a row under another name', () => {
        const plan = planDowngradedOwnerWorld({
            recipes: [recipe('other', 'private', 'My own stew')],
            collections: [collection('other', 'private', 'My own list')],
        });

        expect(plan.deleteRecipeIds).toEqual([]);
        expect(plan.deleteCollectionIds).toEqual([]);
        expect(plan.createRecipe).toBe(true);
        expect(plan.createCollection).toBe(true);
    });
});

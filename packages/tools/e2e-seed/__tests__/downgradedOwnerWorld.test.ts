/**
 * The downgraded owner's world (plan 2026-10-14-009 T2): ONE private recipe and ONE private collection with fixed titles,
 * written while the lane is premium (rebuilt by CI when found missing) and never reset. The decision is pure, so what must hold is asserted without a
 * network: a missing item is created, a standing private one is kept, and anything else under the same name is removed
 * so the flow can match exactly one row.
 */
import { describe, expect, it, vi } from 'vitest';

import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import {
    planDowngradedOwnerWorld,
    planDowngradedWorldRun,
    readDowngradedOwnerSnapshot,
    type DowngradedOwnerSnapshot,
} from '../src/downgradedOwnerWorld.js';
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

/**
 * What a CI run does about the world (2026-10-18). The decision is pure so every branch is held without a network:
 * a run that leaves a standing, settled world alone never raises the owner, and one that raises it does so for exactly
 * the cases the recipe service would otherwise refuse.
 */
describe('planDowngradedWorldRun', () => {
    const standing: DowngradedOwnerSnapshot = {
        recipes: [recipe('r1', 'private')],
        collections: [collection('c1', 'private')],
    };

    it('⛔ is READY when the world stands and the lane is settled — the common path never raises the owner', () => {
        expect(planDowngradedWorldRun(standing, 'settled')).toBe('ready');
    });

    it('only SETTLES when the world stands but the lane is still raised (a run killed before its finally)', () => {
        expect(planDowngradedWorldRun(standing, 'unsettled')).toBe('settleOnly');
    });

    it.each(['settled', 'unsettled'] as const)('RESEEDS when the world is missing (lane %s)', (lane) => {
        expect(planDowngradedWorldRun(empty, lane)).toBe('reseed');
    });

    it('RESEEDS when only the collection is missing', () => {
        expect(planDowngradedWorldRun({ recipes: standing.recipes, collections: [] }, 'settled')).toBe('reseed');
    });

    it('RESEEDS when only the recipe is missing', () => {
        expect(planDowngradedWorldRun({ recipes: [], collections: standing.collections }, 'settled')).toBe('reseed');
    });

    it('RESEEDS when the world stands but a stale duplicate must be removed', () => {
        expect(
            planDowngradedWorldRun(
                { recipes: [recipe('r1', 'private'), recipe('r2', 'private')], collections: standing.collections },
                'settled',
            ),
        ).toBe('reseed');
    });

    it('RESEEDS when the recipe under the name is PUBLIC — the flow needs a private one', () => {
        expect(
            planDowngradedWorldRun({ recipes: [recipe('r1', 'public')], collections: standing.collections }, 'settled'),
        ).toBe('reseed');
    });

    it('is READY even with rows under other names — they are not this world’s to judge', () => {
        expect(
            planDowngradedWorldRun(
                {
                    recipes: [...standing.recipes, recipe('x', 'private', 'My own stew')],
                    collections: standing.collections,
                },
                'settled',
            ),
        ).toBe('ready');
    });
});

describe('readDowngradedOwnerSnapshot', () => {
    const pages = (rows: readonly (readonly object[])[]) =>
        vi.fn(async ({ page }: { page: number }) => ({ data: rows[page - 1] ?? [], hasMore: page < rows.length }));

    it('reads every page of both lists, so a world on page two is not mistaken for a missing one', async () => {
        const listRecipes = pages([[recipe('r1', 'private')], [recipe('r2', 'private')]]);
        const listCollections = pages([[collection('c1', 'private')]]);
        const client = { listRecipes, listCollections } as unknown as RecipeServiceClient;

        const snapshot = await readDowngradedOwnerSnapshot(client);

        expect(snapshot.recipes.map((row) => row.id)).toEqual(['r1', 'r2']);
        expect(snapshot.collections.map((row) => row.id)).toEqual(['c1']);
        expect(listRecipes).toHaveBeenCalledTimes(2);
    });
});

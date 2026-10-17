/**
 * THE DOWNGRADED OWNER'S WORLD — a private recipe and a private collection that belong to a cook who holds no entitled
 * role, so Make public has to ask first (plan 2026-10-14-009 Q5/T1/T2).
 *
 * ## Why it is not in the run's manifest world
 *
 * Every other fixture is leased for a run, scoped by the run key and reset around it. This one cannot be: the recipe
 * service refuses a private recipe from a cook with no entitled role, so the world can only be WRITTEN while the lane is
 * premium (`poolAdmin`'s seeding phase), and the lane is downgraded straight after. After that it can only be READ, so it
 * is seeded once by `seedDowngraded.ts`, has FIXED names (no run key, which would make a second seeding a second
 * recipe), and `resetPool` never touches the `roles` tier it lives in. The owner's order is in `poolAdmin.ts`.
 *
 * ⛔ The flows that use it only READ and answer every confirm "Keep private". A flow that confirmed Make public would
 * destroy the fixture for every later run, with no way back for a user who cannot go private.
 *
 * @pattern Reconciler — `planDowngradedOwnerWorld` is the pure diff, `seedDowngradedOwnerWorld` the impure applier
 */
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import { DOWNGRADED_OWNER_WORLD } from './fixtureManifest.js';
import { ensureIngredients, toCreateRequest } from './recipeWorld.js';

/** What the cook owns, reduced to what the plan reads. */
export interface DowngradedOwnerSnapshot {
    readonly recipes: readonly { readonly id: string; readonly title: string; readonly visibility: string }[];
    readonly collections: readonly { readonly id: string; readonly name: string; readonly visibility: string }[];
}

/** The difference between the snapshot and the fixed world. */
export interface DowngradedOwnerPlan {
    readonly createRecipe: boolean;
    readonly deleteRecipeIds: readonly string[];
    readonly createCollection: boolean;
    readonly deleteCollectionIds: readonly string[];
}

/** Keep the first PRIVATE row under the name, delete every other row under it. Pure. */
function reconcileByName<T extends { readonly id: string; readonly visibility: string }>(
    rows: readonly T[],
): { readonly create: boolean; readonly deleteIds: readonly string[] } {
    const kept = rows.find((row) => row.visibility === 'private');

    return { create: kept === undefined, deleteIds: rows.filter((row) => row !== kept).map((row) => row.id) };
}

/**
 * Reconcile. Pure.
 *
 * Only rows under the fixed names are considered: a plan that could delete a row under another name would be a plan
 * that can delete something nobody named.
 */
export function planDowngradedOwnerWorld(actual: DowngradedOwnerSnapshot): DowngradedOwnerPlan {
    const recipes = reconcileByName(actual.recipes.filter((row) => row.title === DOWNGRADED_OWNER_WORLD.recipe.title));
    const collections = reconcileByName(
        actual.collections.filter((row) => row.name === DOWNGRADED_OWNER_WORLD.collectionName),
    );

    return {
        createRecipe: recipes.create,
        deleteRecipeIds: recipes.deleteIds,
        createCollection: collections.create,
        deleteCollectionIds: collections.deleteIds,
    };
}

/**
 * Write the world, as the cook, WHILE THE LANE IS PREMIUM.
 *
 * @param client - A recipe client signed in as the downgraded owner's lane.
 * @returns The plan that was carried out.
 * @throws When the recipe service refuses the private rows — the lane is not premium (`poolAdmin --apply` first).
 * @sideEffect Reads the cook's recipes and collections; deletes stale rows under the fixed names; creates what is missing.
 */
export async function seedDowngradedOwnerWorld(client: RecipeServiceClient): Promise<DowngradedOwnerPlan> {
    const recipes: DowngradedOwnerSnapshot['recipes'][number][] = [];
    const collections: DowngradedOwnerSnapshot['collections'][number][] = [];

    for (let page = 1; ; page += 1) {
        const answer = await client.listRecipes({ page, pageSize: 100 });
        recipes.push(...answer.data);

        if (!answer.hasMore) {
            break;
        }
    }

    for (let page = 1; ; page += 1) {
        const answer = await client.listCollections({ page, pageSize: 100 });
        collections.push(...answer.data);

        if (!answer.hasMore) {
            break;
        }
    }

    const plan = planDowngradedOwnerWorld({ recipes, collections });

    for (const id of plan.deleteRecipeIds) {
        await client.deleteRecipe(id);
    }

    for (const id of plan.deleteCollectionIds) {
        await client.deleteCollection(id);
    }

    if (plan.createRecipe) {
        const ingredientIds = await ensureIngredients(client, [DOWNGRADED_OWNER_WORLD.recipe]);
        const created = await client.createRecipe(toCreateRequest(DOWNGRADED_OWNER_WORLD.recipe, ingredientIds));

        if (created.visibility !== 'private') {
            throw new Error(`e2e-seed: "${created.title}" came back ${created.visibility}, not private`);
        }
    }

    if (plan.createCollection) {
        const created = await client.createCollection({
            name: DOWNGRADED_OWNER_WORLD.collectionName,
            visibility: 'private',
        });

        if (created.visibility !== 'private') {
            throw new Error(`e2e-seed: "${created.name}" came back ${created.visibility}, not private`);
        }
    }

    return plan;
}

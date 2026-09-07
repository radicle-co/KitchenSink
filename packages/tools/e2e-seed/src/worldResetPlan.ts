/**
 * WHAT THE RESET MUST DO — decided purely, applied elsewhere.
 *
 * The per-flow reset is a RECONCILIATION: compare the signer's library to the manifest and emit only the
 * difference. That framing matters twice over. It makes the settled case FREE — the common case, ~35 times
 * a job, is "nothing to do" rather than "tear down and rebuild", which keeps the reset off the write
 * throttle and off the job's clock. And it makes the decision testable without a network, which the
 * applier that carries it out can never be.
 *
 * Deliberately the same composition as `planE2EUserCleanup` / `teardownSignInFixture` in
 * `@kitchensink/e2e-fixtures`: a pure planner returning a data value, and an applier that holds no policy.
 *
 * ⛔ The plan is computed over what `listRecipes` RETURNED, which the service already scopes to the caller.
 * It therefore cannot express "delete somebody else's recipe" — including the co-author's, which several
 * flows depend on surviving every reset.
 */
import type { FixtureManifest, FixtureRecipe } from './fixtureManifest.js';

/** What the signer's library currently holds. */
export interface WorldSnapshot {
    readonly recipes: readonly { readonly id: string; readonly title: string }[];
    readonly collections: readonly { readonly id: string }[];
}

/** The difference between the snapshot and the manifest. */
export interface WorldResetPlan {
    readonly deleteRecipeIds: readonly string[];
    readonly deleteCollectionIds: readonly string[];
    readonly create: readonly FixtureRecipe[];
}

/**
 * `seeded` restores the manifest; `empty` leaves the library genuinely empty.
 *
 * The empty mode exists for `recipes/empty-library`, the one flow whose subject is the first-run screen a
 * brand-new account opens on. That state is unreachable any other way, and a universal seeded fixture is
 * precisely what hid a permanent-loading-skeleton defect on it.
 */
export type ResetMode = 'seeded' | 'empty';

/**
 * Reconcile. Pure.
 *
 * Collections are cleared unconditionally because the seeded world contains none: `seed.ts`'s one
 * collection belongs to the PRO owner, so the signer's list has always started empty, and
 * `recipes/collections-clone` asserts exactly that.
 */
export function planWorldReset(actual: WorldSnapshot, manifest: FixtureManifest, mode: ResetMode): WorldResetPlan {
    const desired = mode === 'empty' ? [] : manifest.recipes.filter((recipe) => recipe.owner === 'signer');
    const desiredTitles = new Set(desired.map((recipe) => recipe.title));

    const keptTitles = new Set<string>();
    const deleteRecipeIds: string[] = [];

    for (const recipe of actual.recipes) {
        // A title the manifest does not name is residue — a recipe a flow created, a clone it took, or a
        // row an earlier flow renamed. A SECOND row carrying a title the manifest does name is residue
        // too: two identically-titled rows make an anchored `tapOn` ambiguous and a count assertion wrong.
        if (desiredTitles.has(recipe.title) && !keptTitles.has(recipe.title)) {
            keptTitles.add(recipe.title);
            continue;
        }

        deleteRecipeIds.push(recipe.id);
    }

    return {
        deleteRecipeIds,
        deleteCollectionIds: actual.collections.map((collection) => collection.id),
        create: desired.filter((recipe) => !keptTitles.has(recipe.title)),
    };
}

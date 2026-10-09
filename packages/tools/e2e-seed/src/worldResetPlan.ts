/**
 * WHAT THE RESET MUST DO — decided purely, applied elsewhere.
 *
 * The per-flow reset is a RECONCILIATION: compare the signer's library to the manifest and emit only the
 * difference. That framing matters twice over. It makes the settled case FREE — the common case, ~35 times
 * a job, is "nothing to do" rather than "tear down and rebuild", which keeps the reset off the write
 * throttle and off the job's clock. And it makes the decision testable without a network, which the
 * applier that carries it out can never be.
 *
 * Deliberately the same composition as `planE2EUserCleanup` in `@kitchensink/e2e-fixtures` (applied by the web
 * suite's `deleteRunScopedE2EUsers`): a pure planner returning a data value, and an applier that holds no policy.
 *
 * ⛔ The plan is computed over what `listRecipes` RETURNED, which the service already scopes to the caller.
 * It therefore cannot express "delete somebody else's recipe" — including the co-author's, which several
 * flows depend on surviving every reset.
 */
import type { FixtureManifest, FixtureRecipe } from './fixtureManifest.js';

/** What the signer's library currently holds. */
export interface WorldSnapshot {
    readonly recipes: readonly {
        readonly id: string;
        readonly title: string;
        readonly visibility: FixtureRecipe['visibility'];
    }[];
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
 * The empty mode exists for `recipes/emptyLibrary`, the one flow whose subject is the first-run screen a
 * brand-new account opens on. That state is unreachable any other way, and a universal seeded fixture is
 * precisely what hid a permanent-loading-skeleton defect on it.
 */
export type ResetMode = 'seeded' | 'empty';

/**
 * Reconcile. Pure.
 *
 * Collections are cleared unconditionally because the seeded world contains none: `seed.ts`'s one
 * collection belongs to the PRO owner, so the signer's list has always started empty, and
 * `recipes/collectionsSaveCopy` asserts exactly that.
 */
export function planWorldReset(actual: WorldSnapshot, manifest: FixtureManifest, mode: ResetMode): WorldResetPlan {
    return reconcile(actual, mode === 'empty' ? [] : manifest.recipes.filter((recipe) => recipe.owner === 'signer'));
}

/** The difference between a library and the recipes it should hold. Pure. */
function reconcile(actual: WorldSnapshot, desired: readonly FixtureRecipe[]): WorldResetPlan {
    const desiredByTitle = new Map(desired.map((recipe) => [recipe.title, recipe]));

    const keptTitles = new Set<string>();
    const deleteRecipeIds: string[] = [];

    for (const recipe of actual.recipes) {
        // A title the manifest does not name is residue — a recipe a flow created, a clone it took, or a
        // row an earlier flow renamed. A SECOND row carrying a title the manifest does name is residue
        // too: two identically-titled rows make an anchored `tapOn` ambiguous and a count assertion wrong.
        //
        // ⛔ So is a manifest title at the WRONG VISIBILITY. `recipes/visibility` flips the private lamb public and
        // back; a flow that dies between the legs leaves a row this loop would otherwise keep by title alone, and
        // every later flow of the run would open a public recipe the manifest says is private. Visibility is the
        // one field a flow in the corpus changes WITHOUT renaming, so it is compared here. Other fields are not:
        // every flow that edits a seeded recipe's content also renames it, which the title check already catches.
        const wanted = desiredByTitle.get(recipe.title);

        if (wanted !== undefined && wanted.visibility === recipe.visibility && !keptTitles.has(recipe.title)) {
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

/** One row of the CO-AUTHOR's library that carries the private-food recipe's title. */
export interface PrivateFoodRecipeRow {
    readonly id: string;
    readonly visibility: FixtureRecipe['visibility'];
    /** The binding each of its lines points at, in order. */
    readonly lineBindingIds: readonly string[];
}

/** Keep one intact row, or create the recipe. Every other row with the title is deleted either way. */
export type PrivateFoodRecipePlan =
    | { readonly action: 'keep'; readonly recipeId: string; readonly deleteRecipeIds: readonly string[] }
    | { readonly action: 'create'; readonly deleteRecipeIds: readonly string[] };

/**
 * Whether a row is the recipe AND its food, still together: at the fixture's visibility, with exactly the fixture's
 * lines, every one bound to the food's CURRENT binding. Pure.
 *
 * ⛔ `bindingId` must be the binding the food has NOW — the caller authors or re-binds the food before asking. That
 * is what makes "the line points at this binding" mean "the line points at a food that still exists". A purge that
 * removed the food and kept the recipe leaves a row whose title matches but whose line points at the OLD binding,
 * which reads `FOOD_REMOVED` for everyone rather than private.
 */
export function isIntactPrivateFoodRecipe(
    row: Pick<PrivateFoodRecipeRow, 'visibility' | 'lineBindingIds'>,
    recipe: Pick<FixtureRecipe, 'visibility' | 'ingredients'>,
    bindingId: string,
): boolean {
    return (
        row.visibility === recipe.visibility &&
        row.lineBindingIds.length === recipe.ingredients.length &&
        row.lineBindingIds.every((id) => id === bindingId)
    );
}

/**
 * Reconcile the co-author's private-food recipe with its food. Pure — the same shape as {@link planWorldReset}:
 * decide here, apply in `ensurePrivateFoodRecipe`.
 *
 * Unlike the signer's reset it never keys on the title alone: see {@link isIntactPrivateFoodRecipe}.
 *
 * @param rows - Every row of the co-author's library carrying the recipe's title.
 * @param recipe - The fixture the rows should match.
 * @param bindingId - The food's CURRENT binding.
 */
export function planPrivateFoodRecipe(
    rows: readonly PrivateFoodRecipeRow[],
    recipe: Pick<FixtureRecipe, 'visibility' | 'ingredients'>,
    bindingId: string,
): PrivateFoodRecipePlan {
    const kept = rows.find((row) => isIntactPrivateFoodRecipe(row, recipe, bindingId));
    const deleteRecipeIds = rows.filter((row) => row !== kept).map((row) => row.id);

    return kept === undefined
        ? { action: 'create', deleteRecipeIds }
        : { action: 'keep', recipeId: kept.id, deleteRecipeIds };
}

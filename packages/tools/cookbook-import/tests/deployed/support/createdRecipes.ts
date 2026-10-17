/**
 * Remove every recipe a deployed run created, as the principal that owns it, and prove each one is gone.
 *
 * Owner ruling 2026-09-13: the e2e tiers "guarantee that they not only clean up their data but … scope the data".
 * The scope is the owner: each recipe is deleted through the client of the pool user that created it, and only the
 * ids this run was handed are touched. A delete's `204` proves the request; the owner's read answering `404` is what
 * proves the recipe is gone. Every recipe is attempted before anything is reported, and every failure is reported.
 *
 * @pattern Port — {@link RecipeRemovalPort}, the two calls of the house `RecipeServiceClient` a removal needs
 */
import { isNotFoundError, type RecipeServiceClient } from '@kitchensink/recipe-service-client';

/** What removing one recipe needs from its owner's client: the delete, and the read that proves it. */
export type RecipeRemovalPort = Pick<RecipeServiceClient, 'deleteRecipe' | 'getRecipeById'>;

/** One recipe a run created, with the client of the principal that owns it. */
export interface CreatedRecipe {
    readonly id: string;
    readonly owner: RecipeRemovalPort;
}

/**
 * Delete one recipe and read it back.
 *
 * A `404` on the delete is not a failure by itself: the read decides whether the recipe is really gone.
 *
 * @param recipe - The recipe and its owner.
 * @returns The failure, or `undefined` when the recipe is gone.
 * @sideEffect Deletes the recipe through its owner's client.
 */
async function removeOne({ id, owner }: CreatedRecipe): Promise<Error | undefined> {
    try {
        await owner.deleteRecipe(id);
    } catch (error) {
        if (!isNotFoundError(error)) {
            return new Error(`recipe ${id}: the delete failed`, { cause: error });
        }
    }

    try {
        await owner.getRecipeById(id);
    } catch (error) {
        return isNotFoundError(error)
            ? undefined
            : new Error(`recipe ${id}: could not confirm the delete`, { cause: error });
    }

    return new Error(`recipe ${id}: still readable by its owner after the delete`);
}

/**
 * Remove every created recipe, in order.
 *
 * @param created - What the run created.
 * @returns The ids removed, in the order given.
 * @throws {AggregateError} Naming every recipe that was not removed, after every recipe was attempted.
 * @sideEffect Deletes recipes through each owner's client.
 */
export async function removeCreatedRecipes(created: readonly CreatedRecipe[]): Promise<readonly string[]> {
    const failures: Error[] = [];

    for (const recipe of created) {
        const failure = await removeOne(recipe);

        if (failure !== undefined) {
            failures.push(failure);
        }
    }

    if (failures.length > 0) {
        throw new AggregateError(
            failures,
            `${failures.length} of ${created.length} created recipes were not removed: ` +
                failures.map((failure) => failure.message).join('; '),
        );
    }

    return created.map((recipe) => recipe.id);
}

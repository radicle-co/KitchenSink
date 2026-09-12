import type { RecipeDetail } from '@kitchensink/recipe-core';

/** The `onMutate` context for a rating write: the pre-mutation `recipe(id)` snapshot to roll back to. */
export interface RatingMutationContext {
    readonly previous: RecipeDetail | undefined;
}

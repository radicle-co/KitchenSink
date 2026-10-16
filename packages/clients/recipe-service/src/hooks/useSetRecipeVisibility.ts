import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { recipeVisibilitySchema } from '@kitchensink/recipe-core';

import { recipeServiceKeys } from '../queries.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * The key every visibility write is filed under, with its `{ id, visibility }` as variables. A write can be refused
 * after the screen that sent it has gone — the editor's follow-up lands after the editor navigated to the recipe — so
 * the recipe page reads the latest one for its recipe from the mutation cache (`useMutationState`).
 */
export const RECIPE_VISIBILITY_MUTATION_KEY = ['recipe-service', 'mutations', 'recipeVisibility'] as const;

const recipeVisibilityVariablesSchema = z.object({ id: z.string(), visibility: recipeVisibilitySchema }).readonly();

/**
 * What a visibility write carries: the variables `useSetRecipeVisibility` files under
 * {@link RECIPE_VISIBILITY_MUTATION_KEY}. Exported so a reader of the mutation cache names this shape, not a copy of it.
 */
export type RecipeVisibilityVariables = z.infer<typeof recipeVisibilityVariablesSchema>;

/**
 * Read a cached write's variables as {@link RecipeVisibilityVariables}. The mutation cache holds every mutation's
 * variables as `unknown` and the key names only ours, so this parses the shape rather than claiming it.
 *
 * @param variables - A mutation's `state.variables`, of any type.
 * @returns The variables, or `undefined` when they are not a visibility write's.
 */
export function recipeVisibilityVariablesOf(variables: unknown): RecipeVisibilityVariables | undefined {
    const parsed = recipeVisibilityVariablesSchema.safeParse(variables);

    return parsed.success ? parsed.data : undefined;
}

/**
 * `PATCH /api/v1/recipes/{id}/visibility` — set a recipe's visibility.
 *
 * DA3 — write-through: the response is the full, freshly-persisted `RecipeDetail`, so it is written straight
 * into `recipe(id)` instead of invalidating it. A visibility flip is confirmed (against the server DAL) to be
 * a pure single-column metadata UPDATE with no `recipe_versions` insert and no `currentVersion` bump — unlike
 * a content edit or a restore — so `recipeVersions(id)` is deliberately NOT invalidated here.
 *
 * DA4 follow-on: this is a genuinely optimistic-worthy write (a toggle the viewer expects to flip instantly),
 * but layering `onMutate`/`onError` on top of DA3's write-through would need its own red→green pass (today's
 * `onSuccess`-only invalidation is a pinned, deliberate contract — see the tests keyed `VISIBILITY_PROBES`,
 * and note `useSetRecipeRating` / `useDeleteRecipeRating` settled on this SAME shape: reconcile on success,
 * rollback-only on error, no invalidation on failure). Deferred out of DA4's required scope (rating) rather
 * than risk a rushed change
 * to that contract; not yet implemented.
 */
export function useSetRecipeVisibility() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: RECIPE_VISIBILITY_MUTATION_KEY,
        mutationFn: (vars: RecipeVisibilityVariables) => client.setRecipeVisibility(vars.id, vars.visibility),
        onSuccess: async (data, vars) => {
            // Cancel any in-flight `recipe(id)` GET before writing through, so a stale detail fetch settling
            // after this visibility change cannot clobber the fresh response (symmetric with the other hooks).
            await queryClient.cancelQueries({ queryKey: recipeServiceKeys.recipe(vars.id) });
            queryClient.setQueryData(recipeServiceKeys.recipe(vars.id), data);
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
            void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
        },
    });
}

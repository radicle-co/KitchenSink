import { useMutation } from '@tanstack/react-query';

import type { RecordCorrectionRequest } from '@kitchensink/schema-recipe';

import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/ingredients/corrections` — teach the resolver what an ingredient phrase MEANS (U14/R19).
 *
 * DESIGN PATTERN: **Command**, which is what a TanStack mutation already IS — no wrapper is added.
 *
 * ⚠️ IT INVALIDATES NOTHING, and that is a decision rather than an omission. A correction writes to the
 * resolution knowledge base, which is consulted by the SERVER when a future phrase is resolved — it changes
 * no ingredient row, no recipe, and no search result that any cached query already holds. Invalidating
 * `ingredientSearches` here would re-fetch every cached typeahead to receive byte-identical data, on a path
 * the user reaches while typing.
 *
 * ⛔ It is also deliberately NOT chained onto the pick that produced it. The correction and the pick are two
 * separate intents: the pick fixes THIS recipe line and must never fail because the knowledge base was
 * momentarily unwritable, and the correction teaches the system. A caller renders the correction's own
 * pending/error state and lets the line stand either way — `recorded: false` is a SUCCESS (the binding was
 * already in force, or a concurrent correction won), so only a thrown error is a failure worth showing.
 */
export function useRecordIngredientCorrection() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (correction: RecordCorrectionRequest) => client.recordIngredientCorrection(correction),
    });
}

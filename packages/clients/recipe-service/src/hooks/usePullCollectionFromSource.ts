import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { PullDiff } from '../types.js';
import { invalidateCollections } from './invalidateCollections.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/collections/{id}/pull-from-source` — pull new recipes from a cloned collection's source.
 *
 * `previewedDiff` (from `usePreviewPull`) is optional and, when supplied, lets the server detect
 * DRIFT between what the caller previewed and what it would apply now — a rejection surfaces as a typed
 * `PullDriftError` (never swallowed) carrying the fresh diff for the caller to re-present.
 *
 * No write-through: the response's `collection` is the NARROW `Collection` projection (no `recipes`
 * embed), so writing it into `collection(id)` would clobber that cache's `.recipes` array with an entry
 * that lacks it entirely. Invalidating is therefore the correct — not merely simpler — choice here.
 */
export function usePullCollectionFromSource() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; previewedDiff?: PullDiff }) =>
            client.pullCollectionFromSource(vars.id, { previewedDiff: vars.previewedDiff }),
        // A pull only adds MEMBERSHIP rows (`added_via = 'pull'`) — it creates no recipes and edits no
        // recipe row, so no recipe or search query is stale. Only the collection namespace is.
        onSuccess: () => {
            invalidateCollections(queryClient);
        },
    });
}

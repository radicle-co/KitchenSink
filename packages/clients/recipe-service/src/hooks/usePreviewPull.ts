import { useMutation } from '@tanstack/react-query';

import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/collections/{id}/pull-from-source/preview` — PREVIEW a pull without mutating (W5 Task 5).
 *
 * An IMPERATIVE trigger (`mutateAsync`), not a query: the preview is read-only server-side but is invoked
 * on demand (e.g. opening the pull-updates dialog), not kept warm/refetched like a `useQuery` cache entry.
 * It touches no cache — nothing about the collection changed — so there is no invalidation to perform; the
 * caller echoes the resolved `PullDiff` back as `previewedDiff` to `usePullCollectionFromSource`.
 */
export function usePreviewPull() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (id: string) => client.previewPullFromSource(id),
    });
}

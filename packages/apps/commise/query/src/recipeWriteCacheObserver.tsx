/**
 * @module @commise/query/recipe-write-cache — the outbox's recipe writes, applied to the TanStack cache.
 *
 * The outbox's sender calls the client directly (`recipeSender.ts`), so it bypasses the mutation hooks' cache effects.
 * This observer applies the same effects (`applyRecipeCreated` / `applyRecipeUpdated`, the one statement of them) to
 * every recipe write that synced, so a recipe the editor saved through the outbox shows fresh in My recipes and on its
 * detail page. Mount it once, inside both `QueryClientProvider` and `SyncProvider`.
 *
 * Renders nothing.
 *
 * @pattern Observer over the outbox's settlement bus — a read-through cache writer
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type FC } from 'react';

import { applyRecipeCreated, applyRecipeUpdated } from '@kitchensink/recipe-service-client/hooks';

import { useSyncQueue } from './syncProvider.js';

/** Applies each synced recipe write to the cache. @sideEffect Writes and invalidates queries. */
export const RecipeWriteCacheObserver: FC = () => {
    const queryClient = useQueryClient();
    const { subscribe } = useSyncQueue();

    useEffect(
        () =>
            subscribe((event) => {
                if (event.outcome !== 'synced' || event.answer?.kind !== 'recipeWritten') {
                    return;
                }

                // A create's detail is written as an update's is, so Publish lands on the page with no refetch; the
                // create's own effect then marks every list stale for the new recipe.
                void applyRecipeUpdated(queryClient, event.answer.detail);

                if (event.intentKind === 'create') {
                    applyRecipeCreated(queryClient);
                }
            }),
        [queryClient, subscribe],
    );

    return null;
};

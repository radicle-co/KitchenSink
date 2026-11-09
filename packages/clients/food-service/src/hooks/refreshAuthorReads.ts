import type { QueryClient } from '@tanstack/react-query';

import { foodServiceKeys } from '../queries.js';

/**
 * Refresh everything an author's change can move: the food (its `publicationState`), its newest request, and the
 * cook's list with its unseen-decision count. Invalidated, not reset: the page keeps showing the old answer until the
 * new one lands, and then changes once.
 *
 * @sideEffect Marks three reads stale.
 */
export async function refreshAuthorReads(
    queryClient: QueryClient,
    subject: string | undefined,
    id: string,
): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: foodServiceKeys.food(id) }),
        queryClient.invalidateQueries({ queryKey: foodServiceKeys.publicationRequest(id) }),
        queryClient.invalidateQueries({ queryKey: foodServiceKeys.ownFoods(subject) }),
    ]);
}

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { foodServiceKeys } from '../queries.js';
import type { UpdateAuthoredFoodInput } from '../types.js';
import { useFoodServiceClient } from './foodServiceProvider.js';
import { useFoodServiceSubject } from './useFoodServiceSubject.js';

/**
 * Refresh everything an author's change can move: the food (its `publicationState`), its newest request, and the
 * cook's list with its unseen-decision count. Invalidated, not reset: the page keeps showing the old answer until the
 * new one lands, and then changes once.
 *
 * @sideEffect Marks three reads stale.
 */
async function refreshAuthorReads(queryClient: QueryClient, subject: string | undefined, id: string): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: foodServiceKeys.food(id) }),
        queryClient.invalidateQueries({ queryKey: foodServiceKeys.publicationRequest(id) }),
        queryClient.invalidateQueries({ queryKey: foodServiceKeys.ownFoods(subject) }),
    ]);
}

/** `POST .../publication-request`: the author asks staff to make a private food public. `mutate(foodId)`. */
export function useRequestFoodPublication() {
    const client = useFoodServiceClient();
    const subject = useFoodServiceSubject();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.requestPublication(id),
        onSuccess: (_detail, id) => refreshAuthorReads(queryClient, subject, id),
    });
}

/** `DELETE /api/v1/foods/{id}`: the author withdraws the food. `mutate(foodId)`. There is no undo. */
export function useWithdrawFood() {
    const client = useFoodServiceClient();
    const subject = useFoodServiceSubject();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.deleteAuthoredFood(id),
        onSuccess: (_void, id) => refreshAuthorReads(queryClient, subject, id),
    });
}

/**
 * `PUT /api/v1/foods/{id}`: edit one's own food. `mutate({ id, input })`. A private food applies at once; a public one
 * answers `editPending` and waits for staff.
 */
export function useUpdateAuthoredFood() {
    const client = useFoodServiceClient();
    const subject = useFoodServiceSubject();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, input }: { readonly id: string; readonly input: UpdateAuthoredFoodInput }) =>
            client.updateAuthoredFood(id, input),
        onSuccess: (_result, { id }) => refreshAuthorReads(queryClient, subject, id),
    });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useFoodServiceClient } from './foodServiceProvider.js';
import { refreshAuthorReads } from './refreshAuthorReads.js';
import { useFoodServiceSubject } from './useFoodServiceSubject.js';

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

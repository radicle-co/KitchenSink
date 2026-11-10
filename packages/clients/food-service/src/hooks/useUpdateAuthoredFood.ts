import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { UpdateAuthoredFoodInput } from '../types.js';
import { useFoodServiceClient } from './foodServiceProvider.js';
import { refreshAuthorReads } from './refreshAuthorReads.js';
import { useFoodServiceSubject } from './useFoodServiceSubject.js';

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

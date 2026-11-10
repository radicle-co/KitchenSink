import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useFoodServiceClient } from './foodServiceProvider.js';
import { refreshAuthorReads } from './refreshAuthorReads.js';
import { useFoodServiceSubject } from './useFoodServiceSubject.js';

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

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cancelParseJobPoll } from './cancelParseJobPoll.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';
import { writeParseJobThrough } from './writeParseJobThrough.js';

/** `POST /api/v1/recipe-parse-jobs/{id}/retry` — re-drive the `failed_retryable` lines (`202`). */
export function useRetryParseJob() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.retryParseJob(id),
        onSuccess: async (job) => {
            await cancelParseJobPoll(queryClient, job.id);
            writeParseJobThrough(queryClient, job);
        },
    });
}

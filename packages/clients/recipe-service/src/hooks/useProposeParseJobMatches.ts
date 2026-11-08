import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cancelParseJobPoll } from './cancelParseJobPoll.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';
import { writeParseJobThrough } from './writeParseJobThrough.js';

/**
 * `POST /api/v1/recipe-parse-jobs/{id}/matches` — match the job's parsed foods as proposals (`202`, ADR-0071). The
 * returned view, with each proposed food's match, is written through to the job's own cache entry.
 */
export function useProposeParseJobMatches() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => client.proposeParseJobMatches(id),
        onSuccess: async (job) => {
            await cancelParseJobPoll(queryClient, job.id);
            writeParseJobThrough(queryClient, job);
        },
    });
}

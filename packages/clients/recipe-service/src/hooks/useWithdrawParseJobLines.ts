import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cancelParseJobPoll } from './cancelParseJobPoll.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';
import { writeParseJobThrough } from './writeParseJobThrough.js';

/** What to withdraw: the job and the 0-based line positions the cook kept as written. */
export interface WithdrawParseJobLinesVariables {
    readonly id: string;
    readonly lineIndexes: readonly number[];
}

/** `POST /api/v1/recipe-parse-jobs/{id}/withdraw-lines` — take these lines out of the parse (`200`, idempotent). */
export function useWithdrawParseJobLines() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, lineIndexes }: WithdrawParseJobLinesVariables) =>
            client.withdrawParseJobLines(id, { lineIndexes: [...lineIndexes] }),
        onSuccess: async (job) => {
            await cancelParseJobPoll(queryClient, job.id);
            writeParseJobThrough(queryClient, job);
        },
    });
}

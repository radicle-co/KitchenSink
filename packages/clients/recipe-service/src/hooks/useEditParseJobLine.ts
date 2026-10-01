import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { EditParseJobLineRequest } from '@kitchensink/schema-recipe';

import { cancelParseJobPoll } from './cancelParseJobPoll.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';
import { writeParseJobThrough } from './writeParseJobThrough.js';

/** `PATCH /api/v1/recipe-parse-jobs/{id}/lines/{lineIndex}` — replace one line and re-drive its parse (`202`). */
export function useEditParseJobLine() {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: { id: string; lineIndex: number; input: EditParseJobLineRequest }) =>
            client.editParseJobLine(vars.id, vars.lineIndex, vars.input),
        onSuccess: async (job) => {
            await cancelParseJobPoll(queryClient, job.id);
            writeParseJobThrough(queryClient, job);
        },
    });
}

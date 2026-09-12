import { useQueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../queries.js';

/**
 * Cancel any in-flight poll for a job before writing a mutation's response through.
 *
 * ⛔ NOT BELT-AND-BRACES, and the race is live rather than theoretical: `useParseJob` polls on a timer while
 * the job is `running`, so a `GET` issued a moment before a retry/edit lands can settle AFTER it and clobber
 * the fresh view with the pre-mutation one — putting the edited line back to its old text on screen. Same
 * cancel `useUpdateRecipe` performs for the same reason. `create` needs none: there is no query for a job
 * that did not exist.
 *
 * @param queryClient - The cache to cancel against.
 * @param jobId - The job whose poll to cancel.
 * @sideEffect Cancels in-flight queries for that key.
 */
export async function cancelParseJobPoll(queryClient: ReturnType<typeof useQueryClient>, jobId: string): Promise<void> {
    await queryClient.cancelQueries({ queryKey: recipeServiceKeys.parseJob(jobId) });
}

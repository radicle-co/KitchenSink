import { useQueryClient } from '@tanstack/react-query';

import type { ParseJobResponse } from '@kitchensink/schema-recipe';

import { recipeServiceKeys } from '../queries.js';

/**
 * Write a job view straight into its own cache entry (DA3 write-through).
 *
 * @param queryClient - The cache to write.
 * @param job - The freshly-persisted view every parse-job endpoint answers with.
 * @sideEffect Writes one cache entry.
 */
export function writeParseJobThrough(queryClient: ReturnType<typeof useQueryClient>, job: ParseJobResponse): void {
    queryClient.setQueryData(recipeServiceKeys.parseJob(job.id), job);
}

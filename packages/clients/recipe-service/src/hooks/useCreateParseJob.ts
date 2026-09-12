import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { CreateParseJobRequest, ParseJobResponse } from '@kitchensink/schema-recipe';

import { useRecipeServiceClient } from './recipeServiceProvider.js';
import { writeParseJobThrough } from './writeParseJobThrough.js';

/** Caller hooks for {@link useCreateParseJob}. */
export interface CreateParseJobOptions {
    /**
     * Run after the job is accepted and written through — typically to navigate to its review surface.
     *
     * ⛔ EXPOSED HERE rather than left to a per-call `mutate(vars, { onSuccess })`, and the difference is
     * not stylistic. TanStack SKIPS per-call callbacks when the observer unmounts before the mutation
     * settles — and on this resource that loses the created job's ID PERMANENTLY: the job exists, but the
     * service publishes no list endpoint (see `queries.ts`'s key factory), so nothing can ever address it
     * again until the TTL sweeps it. A mutation-level callback survives the unmount.
     */
    readonly onSuccess?: (job: ParseJobResponse) => void;
}

/**
 * `POST /api/v1/recipe-parse-jobs` — submit a pasted ingredient block (`202`).
 *
 * The accepted view is written through to the NEW job's own key, so the poll `useParseJob` starts
 * against the server's first answer instead of an empty cache.
 *
 * @param options - Caller hooks; see {@link CreateParseJobOptions.onSuccess} for why navigation belongs here.
 */
export function useCreateParseJob(options: CreateParseJobOptions = {}) {
    const client = useRecipeServiceClient();
    const queryClient = useQueryClient();
    const { onSuccess } = options;

    return useMutation({
        mutationFn: (input: CreateParseJobRequest) => client.createParseJob(input),
        onSuccess: (job) => {
            // The write-through happens FIRST, so a caller navigating to the review surface finds the
            // server's first view already in the cache rather than a spinner over data it holds.
            writeParseJobThrough(queryClient, job);
            onSuccess?.(job);
        },
    });
}

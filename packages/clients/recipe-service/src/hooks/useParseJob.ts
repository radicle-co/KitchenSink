import { useQuery } from '@tanstack/react-query';

import { DEFAULT_PARSE_JOB_POLL_INTERVAL_MS, parseJobQueries } from '../queries.js';
import type { QueryEnableOptions } from './queryEnableOptions.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** Enable gate + poll cadence for {@link useParseJob}. */
export interface ParseJobOptions extends QueryEnableOptions {
    /** Poll cadence (ms) while the job is `running`. Defaults to {@link DEFAULT_PARSE_JOB_POLL_INTERVAL_MS}. */
    readonly pollIntervalMs?: number;
}

/**
 * `GET /api/v1/recipe-parse-jobs/{id}` — poll one parse job until it settles.
 *
 * Self-limiting: the cadence comes from {@link parseJobQueries}`.detail` (`parseJobPollIntervalOf`), which polls while
 * the job can still MOVE — `running` at the standard cadence, dropping to the slower settling one when every pending
 * line reads `stalled`, and `partial` at the settling one — and stops on `complete`, on `expired`, and once `expiresAt`
 * has passed. There is no time limit (owner ruling 2026-10-13). Gate it on an id actually existing — `''` before a
 * create has landed disables the query rather than firing a request for a job that does not exist.
 *
 * ⛔ DO NOT "fix" this to stop on `partial`. A worker that claimed a line before the producer marked it retryable still
 * lands, and the aggregate re-derives the job; the factory's own docstring carries the reasoning.
 *
 * ⚠️ EXPIRY ARRIVES HERE AS DATA, not as an error: the service answers an expired job's read `200` with
 * `status: 'expired'`. Only a mutation raises `ParseJobExpiredError`.
 *
 * @param id - The job id (the query is disabled for an empty id).
 * @param options - Enable gate + poll cadence.
 */
export function useParseJob(id: string, options: ParseJobOptions = {}) {
    const client = useRecipeServiceClient();
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_PARSE_JOB_POLL_INTERVAL_MS;

    return useQuery({
        ...parseJobQueries(client).detail(id, pollIntervalMs),
        enabled: (options.enabled ?? true) && id.length > 0,
    });
}

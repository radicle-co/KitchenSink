/**
 * Pure retry-budget helpers for the fan-out worker (T-153, FR-016/FR-027). The exponential backoff and
 * the retry-budget ceiling are isolated here so they are unit-testable without a database. The
 * `fetch_queue` row's `last_requested` gate is set to `now() + interval 'backoffSeconds(attempts) s'`
 * by {@link FetchQueueDao.recordFailure}; this module just states the curve and the ceiling.
 *
 * @implements FR-016 FR-027
 */

/** Real source failures tolerated before a food is tombstoned `FAILED` (FR-016). */
export const MAX_FAILURE_ATTEMPTS = 5;

/**
 * Exponential backoff in seconds for the n-th real failure: `2^attempts` (FR-016). `attempts` is the
 * post-increment failure count (1 → 2s, 2 → 4s, 3 → 8s, 4 → 16s, 5 → 32s). Pure.
 *
 * @param attempts - The post-increment failure count (≥ 1).
 * @returns The backoff delay in seconds.
 */
export function backoffSeconds(attempts: number): number {
    return 2 ** attempts;
}

/**
 * Whether the food has exhausted its retry budget and must be tombstoned `FAILED` (FR-016/FR-027).
 *
 * @param attempts - The post-increment real-failure count.
 * @returns `true` once `attempts` reaches {@link MAX_FAILURE_ATTEMPTS}.
 */
export function isRetryBudgetExhausted(attempts: number): boolean {
    return attempts >= MAX_FAILURE_ATTEMPTS;
}

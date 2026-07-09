/**
 * Readiness probe for the food service (ARCH-PS-3). A cheap `SELECT 1` against the shared `pg` pool,
 * bounded by a short timeout so a hung/failing-over RDS or an exhausted pool surfaces as a *fast*
 * rejection (→ 503) instead of hanging the health endpoint and letting the ALB keep routing traffic
 * into a broken instance.
 */

/** The minimal `pg.Pool` surface the probe needs — a single `SELECT 1`. Narrowed for easy mocking. */
export interface ReadinessQueryable {
    query(text: string): Promise<unknown>;
}

/** Default probe budget: long enough to absorb a healthy round-trip, short enough to fail fast. */
export const READINESS_PROBE_TIMEOUT_MS = 2000;

/**
 * Run `SELECT 1` against `pool`, rejecting if it neither resolves nor rejects within `timeoutMs`. The
 * losing query is left to settle and be garbage-collected — a probe never blocks on it.
 *
 * @throws when the query fails or the timeout elapses first.
 * @sideEffect Issues a `SELECT 1` round-trip on the connection pool.
 */
export async function probeDatabase(
    pool: ReadinessQueryable,
    timeoutMs: number = READINESS_PROBE_TIMEOUT_MS,
): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('readiness probe timed out')), timeoutMs);
    });

    try {
        await Promise.race([pool.query('SELECT 1'), timeout]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

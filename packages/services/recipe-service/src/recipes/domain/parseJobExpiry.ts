/**
 * `isParseJobExpired` — the ONE expiry rule of a paste job (ADR-0071 review, F12): the job DAL's mutation guard and the
 * paste matcher both apply it, so the two can never disagree about whether a job may still change.
 *
 * Expiry is DERIVED, never polled (the job DAL's rule 2): a job is expired once the TTL sweep marked it, or AT its
 * `expires_at` instant even before the sweep ran.
 */

/**
 * Whether a paste job has expired.
 *
 * @param job - The job's stored status and expiry instant.
 * @param nowMs - The clock, in epoch milliseconds.
 * @returns `true` once expired. Pure.
 */
export function isParseJobExpired(job: { readonly status: string; readonly expiresAt: Date }, nowMs: number): boolean {
    return job.status === 'expired' || job.expiresAt.getTime() <= nowMs;
}

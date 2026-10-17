/**
 * The jobs whose purpose is to DELETE per-PR infrastructure. Two guards read this list:
 * `reclamationNeverGated.test.ts` (none of them may bind a GitHub Environment) and
 * `awsCredentialsFederated.test.ts` (none of them may sign in to AWS on a production tier, ADR-0063).
 *
 * Adding a job here is the cheap half of the contract; the expensive half is remembering that anything which can
 * suspend it turns a PR close into a bill.
 */

/** One reclamation job, by its workflow file name and job key. */
export interface ReclamationJob {
    readonly workflow: string;
    readonly job: string;
}

/** Every reclamation job in `.github/workflows/`. */
export const RECLAMATION_JOBS: readonly ReclamationJob[] = [
    // ADR-0060 moved both out of `sandbox-deploy.yml` (which the owner disabled): the on-close teardown to
    // `sandboxCleanup.yml`, the abandoned-preview sweep to the dispatch-only `sandboxReapClosed.yml`.
    { workflow: 'sandboxCleanup.yml', job: 'cleanup' },
    { workflow: 'sandboxReapClosed.yml', job: 'reap-abandoned' },
    // Sandbox Down tears a preview down and, for the last one, releases the shared tier.
    { workflow: 'sandboxDown.yml', job: 'down' },
];

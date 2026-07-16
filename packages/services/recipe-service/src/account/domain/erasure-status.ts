/**
 * Pure status logic for the account-erasure vertical (C-007).
 *
 * The four erasure statuses split into two in-flight (`queued`, `running`) and two terminal
 * (`completed`, `failed`), and that split drives every branch of `POST /v1/account/erasure`: in-flight →
 * `202` with the existing job id, `completed` → `410`, `failed` → a fresh `202`. The set itself is
 * defined once on the schema ({@link ACTIVE_ERASURE_JOB_STATUSES}); this module is only the runtime
 * narrowing over it.
 */
import { ACTIVE_ERASURE_JOB_STATUSES, type ActiveErasureJobStatus } from '../../database/schema/account.js';

/**
 * Whether a raw `account_erasure_jobs.status` value is an in-flight status.
 *
 * The column is `TEXT` (constrained by a CHECK, not a PG enum), so Drizzle hands it back as a plain
 * `string`; this is the one place that string becomes the typed {@link ActiveErasureJobStatus} the `202`
 * contract requires. Exact match — no trimming, no case folding — because the values are written by this
 * codebase and the DB CHECK, not by a client.
 *
 * @param status - The raw status value from the row.
 * @returns `true` when the job is `queued` or `running`. Pure.
 */
export function isActiveErasureJobStatus(status: string): status is ActiveErasureJobStatus {
    return (ACTIVE_ERASURE_JOB_STATUSES as readonly string[]).includes(status);
}

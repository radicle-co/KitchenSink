/**
 * WHAT A PENDING PARSE LINE IS DOING, read at request time from facts the pipeline already records (plan
 * 2026-10-15-011; owner ruling 2026-10-13: the server reports a per-line phase, computed at read time rather than
 * through a new write path).
 *
 * The facts are the worker's own: `claimLine` (recipe-workers `parseLine.ts`) stamps `attempts` and
 * `last_received_at` when a delivery takes a line, and every claim, landing, retry and edit moves `updated_at`. So:
 *
 * | Phase      | When (first match wins)                          |
 * | ---------- | ------------------------------------------------ |
 * | `retrying` | a claim younger than the lease, second+ delivery |
 * | `reading`  | a claim younger than the lease, first delivery   |
 * | `stalled`  | nothing in the whole paste moved for `stall`     |
 * | `queued`   | never claimed                                    |
 * | `delayed`  | the claim lapsed and no new one has been taken   |
 *
 * ⛔ EVERY PHASE IS INFERRED, none is recorded. "At most the lease" mirrors `claimLine`'s refusal of a claim younger
 * than the lease, so `reading` means exactly "a delivery holds this line". A held claim implies the paste moved within
 * the lease, which is below the stall threshold, so a held claim can never read `stalled`; the order only makes that
 * explicit.
 *
 * ⚠️ Quiet is measured over the whole PASTE, not the line: non-prod drains one line at a time, so a line behind its
 * siblings is `queued` for as long as they keep landing. A paste queued behind ANOTHER cook's paste reads `stalled`,
 * which is why `stalled` means "taking longer than usual" and settles nothing — the phase moves back the moment work
 * resumes. Inside the lease, an attempt that already threw still reads `reading`, for up to one lease.
 *
 * ⚠️ This is the COOK's reading, over rows only. The operator's is the queue backstop (`classifyOwed`), which also
 * reads the SQS transport; this service holds no permission to read it, and must not gain one for this.
 *
 * @pattern Policy — a pure decision over recorded facts, the sibling of `copyForwardPolicy.ts`
 */
import { PARSE_LINE_DELIVERY, type ParseLineDelivery } from '@kitchensink/recipe-core/parsing/parse-line-delivery';

import type { ParseJobLineStatus } from '../../database/schema/parseJobs.js';
import type { ParseJobLinePhase } from '../parseJobs.schema.js';

/** The recorded facts one line contributes. */
export interface LineProgressFacts {
    readonly status: ParseJobLineStatus;
    /** Deliveries that claimed the line; `0` for one never claimed (and for a row from before migration 0046). */
    readonly attempts: number;
    /** Seconds since the last claim, by the database's clock; `null` when the line was never claimed. */
    readonly claimAgeSeconds: number | null;
}

/**
 * The phase of one line.
 *
 * @param line - The line's recorded facts.
 * @param jobQuietSeconds - Seconds since anything in the line's paste last moved, by the database's clock.
 * @param delivery - The queue's timing; the shipped numbers unless a test supplies its own.
 * @returns The phase, or `null` for a line that is not pending (it is doing nothing). Pure.
 */
export function lineProgressOf(
    line: LineProgressFacts,
    jobQuietSeconds: number,
    delivery: ParseLineDelivery = PARSE_LINE_DELIVERY,
): ParseJobLinePhase | null {
    if (line.status !== 'pending') {
        return null;
    }

    const { claimAgeSeconds } = line;

    if (claimAgeSeconds !== null && claimAgeSeconds <= delivery.leaseSeconds) {
        return line.attempts >= 2 ? 'retrying' : 'reading';
    }

    if (jobQuietSeconds > delivery.stallSeconds) {
        return 'stalled';
    }

    return claimAgeSeconds === null ? 'queued' : 'delayed';
}

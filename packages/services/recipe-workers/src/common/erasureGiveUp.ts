/**
 * The erasure give-up policy, in a module of its own so the queue backstop (`queueCheckReads.ts`) can bind the same
 * numbers the sweeper abandons by without importing the sweeper, which builds an SQS client and starts observability
 * at import. One authority for the policy; two readers.
 *
 * @module
 */

/**
 * Claims after which a job is abandoned to `failed` rather than re-dispatched forever.
 *
 * **This constant is the give-up policy, so the arithmetic behind it matters.** The queue's
 * `maxReceiveCount` is 5 and its visibility timeout is 6 minutes, so ONE message yields at most 5 claims
 * over ~30 minutes before SQS routes it to the DLQ — which fires the DLQ alarm. 10 therefore means two
 * complete DLQ cycles: roughly an hour of real retrying, across two independently-dispatched messages,
 * with a human already paged from the first. A job that has burned that is not failing transiently.
 *
 * The property worth keeping if this is ever retuned: **it must exceed `maxReceiveCount`**, so that a
 * `failed` job always has a DLQ message (and therefore an alarm) behind it. `failed` is never the first
 * anyone hears of a broken erasure.
 */
export const ERASURE_GIVE_UP_ATTEMPTS = 10;

/**
 * The give-up AGE floor (seconds): a job is abandoned only once it is BOTH attempts-exhausted AND this old.
 *
 * `attempts` alone is not a safe give-up trigger, because it is not per-job. The message carries only
 * `ownerId` (by design — `toErasureMessage` (in `erasureSweeper.ts`)), so `claimErasureJob` increments the counter on whatever
 * row is active for the owner. After a job fails and the user re-POSTs, a FRESH row is created; the old
 * cycle's still-in-flight messages then redeliver and claim the fresh row, inflating ITS `attempts` for work
 * that has nothing to do with it. On `attempts` alone, that fresh job could cross
 * {@link ERASURE_GIVE_UP_ATTEMPTS} after only a few of its OWN real attempts and be abandoned prematurely.
 *
 * The fix is a floor on the job's OWN age (`created_at`), which no cross-generation message can move: a job
 * is abandoned only after both signals agree. 1 hour matches the wall-clock the attempts arithmetic was
 * meant to represent (two full DLQ cycles), and — crucially — comfortably exceeds one `maxReceiveCount`
 * DLQ cycle (~30 min), so the "a `failed` job always has a DLQ message + alarm behind it" invariant holds:
 * a job this old with exhausted attempts has genuinely burned its retries.
 */
export const ERASURE_GIVE_UP_AGE_SECONDS = 3600;

-- CR-002 R7: bound the nightly erasure-completion reconciliation sweep.
--
-- The sweep (identity-webhooks `erasure-reconciliation.ts`) re-drives the idempotent recipe + food erasure
-- legs for every `status='erased'` identity. Without a completion marker it re-drives the ENTIRE erased
-- population every night forever — unbounded as that population grows. `reconciled_at` is that marker: the
-- sweep stamps it the first night BOTH legs verify jointly complete, then scans only
-- `status='erased' AND reconciled_at IS NULL`, so a fully-reconciled identity is swept exactly once and
-- dropped thereafter.
--
-- This is deliberately NOT a time window on the erasure timestamp: a window would stop re-driving a
-- genuinely STUCK leg once it aged out, silently dropping it from the ErasureIncomplete alarm — the exact
-- half-erased-forever failure this control exists to catch. A stuck identity is never stamped, so it stays
-- in the scan and keeps feeding the alarm; only a proven-complete one leaves.
--
-- Nullable, no default: NULL = "not yet proven jointly complete" (or not erased). There is deliberately NO
-- data backfill — existing erased rows keep reconciled_at = NULL so the sweep verifies each ONCE and stamps
-- only the ones it confirms complete. Backfilling them to "reconciled" without verifying would mask a
-- historically-incomplete (stuck) erasure, defeating the control.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

-- Partial index over ONLY still-pending erasures (matches the sweep's WHERE, ordered by updated_at for the
-- grace-window filter), so the nightly scan cost tracks the unreconciled working set, not the total erased
-- population. Mirrors the schema definition in `@kitchensink/identity-db` users.ts.
CREATE INDEX IF NOT EXISTS users_erasure_pending_idx
    ON users (updated_at)
    WHERE status = 'erased' AND reconciled_at IS NULL;

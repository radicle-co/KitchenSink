-- 0014 — status VERSION and the version the provider was last brought to (plan U10, R26/R27).
--
-- ⛔ WHY. Closure and reactivation both reach Clerk through the deletion queue, because only that Lambda
-- holds the Clerk secret. The queue is an SQS STANDARD queue, which is at-least-once and UNORDERED — so a
-- user who closes their account and is then reactivated by an admin can have the two messages delivered in
-- either order. The worker applies whichever arrives last: today it reads the EVENT NAME off the message and
-- bans or unbans accordingly, with no reference to what the database says. The reachable outcome is an
-- account that is `active` in identity and BANNED at Clerk — the person cannot sign in, and nothing anywhere
-- records that the two disagree.
--
-- ⛔ THE FIX IS TO STOP TREATING THE MESSAGE AS AN INSTRUCTION. A message becomes a TRIGGER: "look at this
-- user". The worker reads the CURRENT status and version, applies whatever that status implies, and settles
-- only if the version has not moved since it read. A version that moved means a newer intent was recorded
-- while the provider call was in flight, so the settle is refused and the redelivery applies the newer one.
-- This is the same compare-and-set the parse and verification claims use (U6/U7), against a different row.
--
-- `status_version` increments inside the SAME transaction as every status change, so it cannot be raised by
-- anything that did not change the status, and cannot be missed by anything that did.
--
-- `status_applied_version` is what the PROVIDER was last brought to. Owed work is exactly
-- `status_applied_version IS DISTINCT FROM status_version` on a non-erased account — which is what the U12
-- backstop reads, and why this is a version rather than a boolean: a boolean cannot say WHICH intent is
-- outstanding, so a second change during a failed apply would be indistinguishable from the first.
--
-- ⚠️ ERASED ACCOUNTS ARE NOT OWED. Erasure has its own path (the `erasure` branch fans out to recipe and
-- food and deletes at Clerk), and an erased account must never be re-banned or re-unbanned by this
-- convergence. The backstop's predicate excludes them explicitly rather than relying on the version pair.
--
-- ⚠️ BACKFILL: existing rows start at version 1, applied 1 — "the provider already agrees". That is the
-- honest starting point: this migration cannot know whether any given historical account diverged, and
-- starting them all as OWED would enqueue a ban or unban for every user in the table. Divergence that
-- predates this migration is out of its reach, and is left to the backstop's other signals.

ALTER TABLE users
    ADD COLUMN status_version integer NOT NULL DEFAULT 1,
    ADD COLUMN status_applied_version integer NOT NULL DEFAULT 1;

CREATE INDEX users_status_unapplied_idx
    ON users (status_version)
    WHERE status_applied_version IS DISTINCT FROM status_version;

COMMENT ON COLUMN users.status_version IS
    'U10: incremented in the same transaction as every status change. The intent.';
COMMENT ON COLUMN users.status_applied_version IS
    'U10: the version the identity provider was last brought to. Behind status_version means owed.';

-- 0017 — the identity provider's confirmed deletion of an erased account (P1 #5).
--
-- ⛔ WHY. A self-service erasure scrubs the identity row first and deletes the Clerk account LATER, in the deletion
-- worker (the identity service holds no Clerk secret, by design). Until now nothing recorded that the later step
-- happened. Reconciliation re-ran only the recipe and food legs and stamped `reconciled_at`, so a lost or
-- dead-lettered message left a LIVE Clerk account behind a row reported as fully erased — and the person kept
-- signing in to an account they were told was destroyed.
--
-- `provider_deleted_at` is that one durable fact: "Clerk confirmed this account no longer exists". It is written by
-- the deletion worker after `deleteUser` succeeds or answers 404, by the `user.deleted` webhook path (Clerk is gone
-- by definition), and by the tombstone sweep (which deletes at Clerk first). Reconciliation treats a missing stamp
-- as an incomplete leg and re-enqueues an erasure message; the worker stays the only Clerk mutator.
--
-- ⛔ NOT AN `erasing` STATUS. That would delay the R10 anti-resurrection guard, which keys on `erased`.
-- ⛔ NOT 0014's version pair. That pair tracks closure and reactivation intent; erased rows are excluded from it.
--
-- ⚠️ NULLABLE, NO DEFAULT. NULL means "not confirmed", which is the honest state of every row that has not been
-- through the worker. A default would invent a confirmation nobody observed.
--
-- ⚠️ NO GRANT. The column inherits the table's privileges (ADR-0039's default-privilege hook).
--
-- The two CHECKs make the unsafe states unstorable rather than merely unlikely:
--   - a confirmation can exist only on an erased row;
--   - an erasure cannot be marked reconciled while the provider account may still be alive.

ALTER TABLE users
    ADD COLUMN provider_deleted_at timestamptz;

-- ⛔ EXISTING ROWS. 0012 stamped `reconciled_at` on erased rows before this column existed, so a database that
-- already holds one cannot take the second CHECK (the sandbox's migration failed on exactly that). No existing row
-- carries a provider-deletion confirmation, so none may stay marked reconciled: clear the stamp. The nightly
-- reconciliation then re-verifies each such row once (0012's own semantics) and now also confirms Clerk.
UPDATE users
   SET reconciled_at = NULL
 WHERE reconciled_at IS NOT NULL
   AND provider_deleted_at IS NULL;

ALTER TABLE users
    ADD CONSTRAINT users_provider_deleted_only_erased
        CHECK (provider_deleted_at IS NULL OR status = 'erased'),
    ADD CONSTRAINT users_reconciled_requires_provider_deleted
        CHECK (reconciled_at IS NULL OR provider_deleted_at IS NOT NULL);

-- 0002: rekey fetch_requesters from the Clerk `sub` to the app-user ULID (CR-002 / U1, R5)
--
-- Hand-authored, ordered DDL applied once by the in-VPC migration runner (see
-- src/lambdas/migrate/handler.ts). The runner wraps this file in a single BEGIN/COMMIT, so it must
-- NOT open its own transaction. The Drizzle definition in src/db/schema/operational.ts documents the
-- same post-migration shape (`requester_id`).
--
-- WHAT CHANGES
--   fetch_requesters.sub  ->  fetch_requesters.requester_id  (an OPAQUE app-user ULID for a user
--   principal, or an allowlisted `svc_*` id for a service principal — NO cross-service FK, D2).
--   The `(food_id, sub)` PK and the `idx_fetch_requesters_sub` index are renamed in lock-step. A
--   RENAME COLUMN is a metadata-only operation: the PK constraint and index keep functioning and are
--   simply renamed for name/schema coherence.
--
-- ── CUTOVER SAFETY — ORDERING IS LOAD-BEARING (read before editing) ────────────────────────────────
--   The provenance validator (src/worker/provenance.ts, deployed WITH this migration) is tightened in
--   the same change to accept ONLY a valid ULID or `svc_*` and to REJECT a raw Clerk `sub` (`user_*`).
--   Any `fetch_requesters` row written before this cutover is keyed by a raw Clerk `sub`. Left in
--   place, such a legacy row would (a) fail provenance, and (b) for an in-flight leased food whose
--   ONLY requesters are legacy subs, drop the valid-requester count to ZERO — so the consumer refuses
--   to produce it (FR-048), stranding the food. Food cannot backfill sub -> ULID itself: the mapping
--   lives in identity, not here.
--
--   CHOSEN CUTOVER = PURGE (not "tolerate both forms for a window"). `fetch_requesters` rows are
--   ephemeral demand signals that self-prune when a food leaves the queue (DSN-10); the durable data
--   is the `food` golden record. Purging the transient demand is SAFE and SIMPLER than a two-phase
--   dual-read window, and it lets the tightened validator ship in a single deploy with no lingering
--   legacy-key acceptance. Demand re-accrues naturally as users re-request; nothing user-durable is
--   lost. (This service is pre-launch — no production food demand exists at cutover.)
--
--   NON-STRANDING (the subtle part). Deleting only the requester rows and/or the active queue rows in
--   isolation would strand an in-flight food:
--     - a `PENDING` food whose queue row is deleted is stuck FOREVER at 202 — a repeat add-by-name does
--       NOT re-enqueue a PENDING food (foods.service only re-enqueues an UNRESOLVED food with an expired
--       candidate set), so it would never progress;
--     - a `PENDING` food whose requesters are purged but queue row kept would be refused by the
--       tightened provenance guard (zero valid requesters) and tombstoned, still never resolving.
--   So the purge is scoped to leave NOTHING stuck:
--     (2a) drop every requester row (all are pre-U1 raw-`sub` keys; harmless to drop the valid
--          `svc_change_refresh` ones too — a refresh row simply won't refresh this cycle);
--     (2b) delete every dataless `PENDING` placeholder food (CASCADE removes its queue/requester/
--          candidate rows) — these carry NO golden data, so a stale poll cleanly 404s and re-adds;
--     (2c) delete any remaining ACTIVE (pending/in_flight) queue rows — these now belong only to
--          `RESOLVED` foods mid change-refresh; the food stays RESOLVED and readable, it just skips
--          this refresh cycle.
--   Left intact: RESOLVED foods (readable), UNRESOLVED foods (still PATCH-resolvable; they normally
--   hold no queue row), and NOT_FOUND/FAILED tombstones.
--
--   ORDER (must stay): (1) rename the column/index, THEN (2a→2b→2c) purge. No legacy `sub`-keyed row
--   survives to be evaluated by the tightened validator, and nothing is left in a stuck state.
--
-- Rollback boundary (KTD-4): food is a separate CDK stack, so this migration reverts independently of
-- the recipe/identity erasure feature.
--
-- @implements R5 FR-048 FR-043 FR-044

-- (1) Rename the column + its index to the ULID-keyed name. The `fetch_requesters_pk` constraint name
-- is unchanged (only the column it spans is renamed — Postgres updates that reference automatically).
ALTER TABLE "fetch_requesters" RENAME COLUMN "sub" TO "requester_id";
ALTER INDEX "idx_fetch_requesters_sub" RENAME TO "idx_fetch_requesters_requester_id";

-- (2) Purge legacy demand state, non-stranding (see CUTOVER SAFETY above). Runs once
-- (schema_migrations gates re-invocation); on a fresh/test database every table is empty, so these are
-- all no-ops.
DELETE FROM "fetch_requesters";                                   -- (2a) every pre-U1 raw-sub key
DELETE FROM "food" WHERE "status" = 'PENDING';                    -- (2b) dataless placeholders (CASCADE)
DELETE FROM "fetch_queue" WHERE "status" IN ('pending', 'in_flight'); -- (2c) leftover RESOLVED-refresh rows

# 0034 — A recipe save and its version row are one transaction

- **Status:** Accepted
- **Date:** 2026-09-06
- **Area:** recipe-service write path · version history (FR-007b / FR-007b-i) · transaction boundaries
- **Related:** `packages/services/recipe-service/src/recipes/recipes.service.ts` (`recordSnapshotIn`, the three call sites), `src/versions/versions.service.ts` (`createSnapshot`, `enforceRetention`), `src/database/unitOfWork.ts` (the S-R1 seam), [ADR-0026 §7a](0026-two-engine-ingredient-parse-pipeline.md) (the required-parameter precedent), [ADR-0032](0032-deployed-ecosystem-test-tier.md) (why no e2e tier is owed)

## Context

Every recipe write — create, update, clone, restore — records an immutable `recipe_versions` row. That
write ran **after** the recipe had already committed, and it was wrapped in a `try/catch` that swallowed
the failure to a `console.error`. Three docstrings recorded the reasoning, all in the same terms:

> Best-effort: the recipe has already committed, so a snapshot/retention failure must NOT fail the user's
> save — it is logged and swallowed (the reconciliation/worker path backstops a missed row).

**The load-bearing half of that justification was false.** There is no backstop. `archiveSweeper.ts`
selects only rows that already exist in `recipe_version_pending_archives`; nothing anywhere reconstructs a
missing `recipe_versions` row, and nothing reconstructs a missing outbox row. A swallowed failure was
permanent and silent, and the comment asserting otherwise is why it felt safe.

Measured against a real database before the change: with the version insert refused, `POST /api/v1/recipes`
answered **201** and persisted a recipe with **zero** version rows.

`enforceRetention` carried the same shape one layer down, with its own stated safety net — "the next save
re-enqueues idempotently". True only _if there is a next save_: a recipe whose owner never edits again never
re-derived its overflow, so that version was never archived, with no alert and no DLQ.

## Decision

**A recipe write and its version row commit together or not at all.** The transaction is opened by
`RecipesService` through the existing S-R1 Unit-of-Work seam and threaded into both DALs; the
`recipe_versions` insert and the retention outbox insert both join it; neither swallows.

Four consequences, each deliberate:

1. **`recordSnapshotIn` takes the transaction FIRST and required.** Not defaulted — a default is a position
   silently asserted for every caller that had not thought about it (ADR-0026 §7a). `VersionsDal.createSnapshot`
   and `PendingArchivesDal.enqueueMany` require it too, so "a version row written outside a transaction" is a
   compile error rather than a convention.
2. **The restore's opt-out is deleted.** `update`'s `recordSnapshot?: boolean` was the one path that could
   commit a recipe write with no version row — an opt-out of an invariant, granted to the caller whose entire
   purpose is reconstructing history. It is replaced by a `SnapshotDirective` stating what the version records.
3. **All four write paths now build the snapshot the same way.** The restore previously stored the _archived_
   snapshot verbatim, while the rebuilt update body carries no tags, cuisine, difficulty, mealType or status —
   so the stored version asserted fields the live recipe did not have. One rule removes that divergence.
4. **The S3 archive is untouched.** FR-007b-i binds the S3 write, and it still holds: over-retention versions
   go to an outbox and a worker writes them to S3, pruning only once the write confirms. A save still never
   waits on, or fails because of, S3.

## Consequences

- A version-write failure now surfaces as `500 INTERNAL_ERROR` — an outcome already published for every one
  of these routes, so no client branch is new and no error code was minted (a new `RecipeErrorCode` would
  widen a union both apps consume under ADR-0014).
- The new 500 is safe to retry, because nothing committed. The old 201 was not repairable at all.
- An outbox hiccup now fails the user's save. Accepted: no failure mode reaching that insert alone could be
  constructed, and the alternative leaves the never-archived hole open with nobody owning it.
- The `recipes` row lock is held across three more statements. Statement count is unchanged.

## Two traps this design walks past, recorded so nobody re-introduces them

- **Swallowing inside a transaction is broken, not conservative.** Postgres aborts a transaction on any
  statement error: every later statement fails and the `COMMIT` degrades to a `ROLLBACK`. A `try/catch`
  inside the boundary reads exactly like the old code, passes every mocked unit test, and silently discards
  the user's entire save. Swallowing requires a SAVEPOINT (`tx.transaction`), which is deliberately not used.
- **`db.transaction` from inside a transaction is not nesting.** On a pool-backed client drizzle takes a
  **second connection**, which cannot see the outer transaction's uncommitted rows and does not roll back
  with it. The recipe pool sets no `max` (so 10) and no `connectionTimeoutMillis`, so that shape deadlocks
  permanently at ten concurrent saves. `RecipesDal.readConflict` therefore stays OUTSIDE the boundary — it
  opens its own transaction _and_ issues `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`, which Postgres
  rejects once a statement has run. That is why a CAS miss returns `undefined` out of the callback and the
  409 is raised after the transaction closes.

## Alternatives rejected

- **Un-swallow without a transaction.** Strictly worse: the recipe is committed before the snapshot runs, so
  a bare throw returns 5xx over a saved recipe — the same lie in the other direction.
- **A compensating delete.** A second write that can itself fail, and for `update` it cannot un-bump
  `current_version` without racing the CAS it would be fighting. Saga compensation is for cross-service
  boundaries; both writes are in one database.
- **Push the snapshot into the DAL's existing transaction via a callback.** The snapshot payload is built by
  a service-layer pure function, so the DAL's contract would become "I also run arbitrary caller code inside
  my transaction", and the invariant would be invisible at the call site.

## Verification

`__tests__/integration/versions/snapshotAtomicity.integration.test.ts` proves it against a real Postgres for
create, update, clone and the outbox, and `restoreAtomicity.integration.test.ts` for restore. The failures
are induced by a real `BEFORE INSERT` trigger and a real unique-constraint collision — never a mock, because
the property under test is whether two writes share a transaction, and a test that replaces one of the
writes cannot observe that.

No e2e tier is owed: under ADR-0032 an e2e test targets a deployed origin and cannot force a trigger or an
error branch, and `docs/CODING_STANDARDS.md` §7.1 routes that coverage to integration rather than back to a
locally-booted e2e job.

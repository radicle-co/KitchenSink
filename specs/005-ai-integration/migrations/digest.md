# Phase Digest — 5.5 Migration Plan

**Feature**: 005-ai-integration
**Phase**: 5.5 — Migration Plan (conditional; trigger MET)
**Date**: 2026-08-05
**Status**: completed

## Trigger

`plan.md` §2 Data Model is non-empty — four `CREATE TABLE` statements in a new logical database
`kitchensink_ai`. The phase had never run and was **absent from the phases map** entirely;
`pre-impl-review` (which follows it) was already marked `skipped`, so 5.5 had been jumped silently.

## Outcome

| Item                | Value                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| DB kind             | PostgreSQL 16 (RDS shared instance) · Drizzle ORM                                     |
| Logical DB          | `kitchensink_ai` (new)                                                                |
| Tables added        | 4 — `ai_generation_records`, `user_byok_keys`, `mcp_agent_grants`, `prompt_templates` |
| Indexes added       | 5 (one partial)                                                                       |
| Strategy            | Big-bang, with written rationale (empty target DB, no readers/writers)                |
| Destructive changes | Forward: **no**. Rollback: **yes** — see R-03/R-04/R-05                               |
| Backfill required   | No — recorded explicitly rather than left as a missing file                           |
| Risks catalogued    | 12 (4 HIGH, 4 MEDIUM, 2 LOW, 1 N/A) + residual risk stated                            |

## Verified empirically

Applied against a real PostgreSQL 16 instance in a throwaway database (dropped afterwards; existing
integration-test databases untouched):

- `forward.sql` applies cleanly, exit 0.
- `validation.sql` passes on the correct schema.
- `rollback.sql` DDL removes all four tables and correctly **leaves `pgcrypto` installed**.
- Three mutation tests confirmed `validation.sql` **fails** when the schema is wrong — the D-005
  column-level unique (`FAIL(2b)`), a non-partial index (`FAIL(5b)`), and a cross-service foreign key
  (`FAIL(6)`).

The mutation results are the load-bearing evidence: they show the gate discriminates rather than
passing unconditionally.

## Decisions recorded

1. **Big-bang is correct here and is not a shortcut.** Expand–migrate–contract over an empty
   database adds failure modes without removing risk. Rationale written into `migration-plan.md` so
   it is not re-litigated.
2. **Database/role provisioning is out of scope for `forward.sql`.** `CREATE DATABASE` cannot run in
   a transaction; folding it in would break the all-or-nothing property the rollback story depends
   on. Provisioning stays with CDK/DataStack, matching `kitchensink_recipes`.
3. **`pgcrypto` is never dropped on rollback.** Other logical databases on the shared instance depend
   on `gen_random_uuid()`; dropping it would turn one service's rollback into a cross-service outage.
4. **`validation.sql` is written as regression guards, not as a restatement of the DDL.** Each check
   targets a defect that was actually present in an earlier revision, or an architectural rule a
   plausible "fix" would violate.

## Open items carried forward

- **F-06 is RESOLVED (owner decision 2026-08-07)** — a new shared package `@kitchensink/ai-db` owns the
  schema, DAOs and this migration, mirroring `@kitchensink/identity-db` (consumed by both `identity`
  and `identity-webhooks`, the same split as ai-service/ai-workers). Scaffolded by the new T103, which
  must precede T005/T006/T008. The DDL above is unchanged; only its home moved. Superseded text: `ai-workers` must insert into
  `ai_generation_records`, whose Drizzle schema `T006` places in `ai-service`; there is no shared
  schema package and cross-workspace relative imports are banned. This does **not** change the DDL
  above, but it does determine which package owns the schema module — and therefore where the
  shipped `0001_ai_initial.sql` finally lives. Needs an architecture decision.
- The migration file itself is not yet written to
  `packages/services/ai-service/src/database/migrations/` — that is T008, in Phase 6.

## Next

Phase 5C (Pre-Implementation Review) is `skipped`. Next active phase is **6 — Implement**, gated by
the Test-first Red gate: the 47 `Test-first: true` tasks must be confirmed failing before any
implementation runs.

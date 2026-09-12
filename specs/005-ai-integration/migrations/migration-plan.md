# Migration Plan — Feature 005 (AI Integration)

> Generated: 2026-08-05
> DB: PostgreSQL 16 (RDS, shared `kitchensink-data-{stage}` instance) · Drizzle ORM
> Logical database: **`kitchensink_ai`** (new) — per-service pattern, alongside `kitchensink_recipes`
> Strategy: **Big-bang** — deliberately, with the rationale below
> Ships to: `packages/shared/ai-db/src/migrations/0001_ai_initial.sql` (tasks.md T008)

## Schema diff

There is no "before". `kitchensink_ai` does not exist yet, so every change is an addition to an empty
database and nothing is modified or dropped.

| Change | Object                                                 | Type      | Reversible?                     |
| ------ | ------------------------------------------------------ | --------- | ------------------------------- |
| ADD    | `ai_generation_records` (+3 indexes)                   | table     | ⚠️ destructive once populated   |
| ADD    | `user_byok_keys` (composite unique `user_id,provider`) | table     | ❌ orphans Secrets Manager ARNs |
| ADD    | `mcp_agent_grants` (+2 indexes, one partial)           | table     | ⚠️ destructive once populated   |
| ADD    | `prompt_templates` (composite unique `key,version`)    | table     | ⚠️ destructive once populated   |
| ADD    | `pgcrypto`                                             | extension | ✅ (deliberately not reversed)  |

**No `MODIFY` and no `DROP` rows exist**, which is why this is not a data migration. The reversibility
column is about rolling _back_ after the tables have been used, not about the forward operation.

`user_byok_keys` is marked ❌ rather than ⚠️ because dropping it destroys the only pointer to live
third-party credentials held in AWS Secrets Manager — a loss Postgres cannot undo. See R-03.

## Strategy per change — and why big-bang is correct here

The operating principle is zero-downtime-by-default and big-bang requires a written rationale. Here it
is.

Big-bang is rejected when it means _a disruptive rewrite of a table that is being read and written
concurrently_. **None of those conditions hold.** The four tables are created in a database that does
not yet exist, has no rows, no readers, and no writers. `ai-service` is not deployed. There is no
old shape to dual-write to, no data to backfill, and no cutover window to keep short — expand–
migrate–contract and shadow-column would each be pure ceremony over an empty database, adding steps
that can fail while removing no risk.

| Change             | Strategy | Rationale                                                                                                  |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| All four `CREATE`s | Big-bang | Empty target database, no concurrent readers/writers, no data to move. Single transaction, all-or-nothing. |

**The real risk this phase has to manage is therefore not downtime — it is provisioning order and
rollback safety**, which is where the mitigations in `risk-matrix.md` are concentrated.

## Why there is no backfill plan

`backfill.md` is mandatory whenever a backfill is required. **No backfill is required**: there is no
pre-existing data in `kitchensink_ai`, and no table in this feature derives values from another
service's data at migration time (`user_id` is an unkeyed app ULID written at request time, not
populated from identity). Recording the absence explicitly so a reviewer does not read a missing file
as an oversight.

## Files produced

| File              | Purpose                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `forward.sql`     | The DDL. Verified runnable — see "Verification" below.                   |
| `rollback.sql`    | Destructive undo, with two mandatory manual pre-steps above the DDL.     |
| `validation.sql`  | Executable post-migration gate. Raises on failure; non-zero exit = fail. |
| `risk-matrix.md`  | 12 risks with concrete mitigations; residual risk stated.                |
| `digest.md`       | Phase digest.                                                            |
| ~~`backfill.md`~~ | Not produced — no backfill required (rationale above).                   |

## Verification — actually executed, not asserted

Run against a real PostgreSQL 16 instance in a throwaway database, which was dropped afterwards; the
existing integration-test databases were not touched.

| Check                                                         | Result                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `forward.sql` applies cleanly                                 | ✅ exit 0                                               |
| `validation.sql` passes on the correct schema                 | ✅ `PASS: all 0001_ai_initial assertions satisfied.`    |
| `rollback.sql` DDL removes all four tables                    | ✅ 0 tables remaining                                   |
| `rollback.sql` leaves `pgcrypto` installed                    | ✅ still present (cross-database dependency preserved)  |
| **Mutation:** column-level unique on `user_byok_keys.user_id` | ✅ correctly **failed** — `FAIL(2b)` (the D-005 defect) |
| **Mutation:** partial index replaced with a non-partial one   | ✅ correctly **failed** — `FAIL(5b)`                    |
| **Mutation:** cross-service foreign key added                 | ✅ correctly **failed** — `FAIL(6)`                     |

The mutation rows are the ones that matter: they prove `validation.sql` discriminates, rather than
passing regardless of input.

## Pre-migration checklist

- [ ] **Provision `kitchensink_ai` and its role first.** `forward.sql` does not do this — `CREATE
DATABASE` cannot run in a transaction. This belongs to CDK/DataStack + the migrate Lambda, as
      for `kitchensink_recipes`.
- [ ] Confirm the runner wraps `forward.sql` in a single transaction (R-02 depends on it).
- [ ] Backup — required even though the database is empty, because it establishes the restore point
      that `rollback.sql` assumes exists.
- [ ] Dry-run on sandbox before prod.
- [ ] Run `validation.sql` immediately after `forward.sql`, in the same job. A migration that is not
      validated in the same run is a migration nobody validated.
- [ ] No migration window / announcement needed — no existing consumers.

## Rollback trigger criteria

- `validation.sql` exits non-zero.
- `forward.sql` fails partway (transaction should already have rolled it back — investigate before
  re-running, because a non-transactional runner is the only way this leaves residue).
- Drizzle schema and database disagree after deploy (`ai-service` fails to boot).

**Not** a trigger: application-level bugs in `ai-service`. Once rows exist, rollback is destructive
(R-03/R-04/R-05) and a forward fix is nearly always correct instead.

## Owner

Feature 005 implementer. The Secrets Manager pre-step in `rollback.sql` additionally requires
AWS credentials with `secretsmanager:DeleteSecret` — confirm the operator has them **before** a
rollback is started, not during one.

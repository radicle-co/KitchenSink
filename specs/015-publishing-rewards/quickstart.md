# Phase 1 — Quickstart Validation: 015 Publishing Rewards

**Created**: 2026-08-22

⛔ **Nothing here is runnable yet.** No implementation exists — by owner directive, and because the feature is
blocked (see [`plan.md`](./plan.md) §9). This is the validation guide the implementation must satisfy, written
now so the acceptance bar is fixed before any code is written.

## Prerequisites

- Node 24 (the shell defaults to 18; prefix with the v24 nvm bin or vitest and the husky hooks fail)
- Docker — Postgres for the integration tier
- A database per tier. **Do not share one**: tiers race each other's schema resets.

## What is already verifiable today

The migration is the one part that can be validated before any application code exists:

```bash
# Apply the DDL to a throwaway database and prove the constraints actually bite.
docker run -d --name pr015 -e POSTGRES_PASSWORD=x -e POSTGRES_DB=scratch postgres:18-alpine
# wait for real readiness — pg_isready reports ready during Postgres's init phase and will lie to you
until docker exec pr015 psql -U postgres -d scratch -tAc "select 1" >/dev/null 2>&1; do :; done
# (create a minimal `recipes` stub so the FKs resolve, then:)
docker exec -i pr015 psql -U postgres -d scratch -v ON_ERROR_STOP=1 < migrations/forward.sql
docker exec -i pr015 psql -U postgres -d scratch -v ON_ERROR_STOP=1 < migrations/validation.sql
```

**Expected**: `forward.sql` exits 0; every `validation.sql` query returns its documented PASS result.

**The check that matters most** — the ratchet must reject a _decrease_, including the both-columns form that
defeated the original CHECK:

```sql
INSERT INTO contributor_standing (owner_id, tier) VALUES ('u1', 3);
UPDATE contributor_standing SET tier = 1, updated_at = now() WHERE owner_id = 'u1';
-- EXPECTED: ERROR — contributor standing is monotonic (FR-007i)
UPDATE contributor_standing SET tier = 5 WHERE owner_id = 'u1';
-- EXPECTED: UPDATE 1
```

Verified on PG 16 and PG 18.6.

## Scenarios the implementation must satisfy

| #   | Scenario                                           | Expected                                                       | Story       |
| --- | -------------------------------------------------- | -------------------------------------------------------------- | ----------- |
| 1   | Author a complete recipe, publish with attestation | Published; 2 slots granted; ledger shows it                    | US1         |
| 2   | Publish a recipe below the completeness floor      | Publishes; **no** grant; the missing fields are named          | US1         |
| 3   | Decline the attestation                            | Publication does **not** proceed; no grant                     | US1         |
| 4   | Unpublish a rewarded recipe                        | Private; **balance identical**; no forfeiture warning anywhere | US2         |
| 5   | Republish the same recipe                          | No second grant                                                | US2         |
| 6   | Publish an imported-public recipe                  | Publishes with attribution; **no** grant; reason stated        | US3         |
| 7   | Publish a cookbook scan                            | Refused, reason stated                                         | US3         |
| 8   | Free user with 0 slots creates a recipe            | Cannot make it private; can save it as a **draft**             | —           |
| 9   | Lapsed premium holding 200 private recipes         | Keeps all 200; cannot make a **new** one private               | `C-015-022` |
| 10  | Two simultaneous publishes                         | Never exceeds 3/day or the 50 ceiling                          | `FR-010a`   |
| 11  | Grant write fails after publication commits        | Publication stands; grant lands on retry, **exactly once**     | `FR-010b`   |
| 12  | Reward read fails                                  | UI shows **unavailable**, never `0 slots`                      | `FR-010c`   |
| 13  | Erase account with an obligation pending           | Obligation cancelled; no records resurrected                   | `FR-021`    |

## Running the tiers (once implemented)

```bash
npm run test --workspace=packages/services/recipe-service          # unit
npm run test:integration --workspace=packages/services/recipe-service
npm run test:e2e --workspace=packages/apps/commise/web             # Playwright
```

Every tier must be **written first and watched fail** (CLAUDE.md §7.1). Scenarios 10 and 11 are the two that
cannot be validated by a sequential test — 10 needs genuine parallelism, and 11 needs fault injection.

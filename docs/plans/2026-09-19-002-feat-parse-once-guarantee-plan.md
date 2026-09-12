# Parse-once guarantee — flow audit and the open-item plan

**Date:** 2026-09-19 · **Branch:** `chore/code-quality-enforcement-phase-1-2`

## 1. The requirement

> once we see a string and parse it, it should not go to the parser again

Stated precisely, because two shipped mechanisms deliberately re-ask and a naive reading would call them
bugs: **one distinct submission of a string costs at most one engine ask per engine generation.** A model
pin or `PARSE_PROMPT_VERSION` bump invalidates the cache by design; a validator-disputed line is retried by
owner ruling (up to 3). Neither is a dedup leak. See ADR-0044.

## 2. The audit — every path that can reach an engine

`runParsePipeline` is the only thing that calls an engine. It has exactly two production callers:
`recipe-workers/src/handlers/parseLine.ts` (the deployed worker, in `parseAndLand`) and
`tools/cookbook-import/src/runImport.ts` (the operator import tool).

| #   | Path                                                      | Gate                                              | Reaches an engine?                                                            |
| --- | --------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | `createJob`, same owner, line already answered            | copy-forward (pre-queue)                          | **No** — no message is produced                                               |
| 2   | `createJob`, **different** owner, line already answered   | `ingredient_parse_cache`                          | **No** — costs one message, not a parse                                       |
| 3   | Same line repeated inside one paste                       | `distinct`/`representative`                       | Asked **once**                                                                |
| 4   | Second submission after the first landed                  | `ingredient_parse_cache`                          | **No**                                                                        |
| 5   | `PATCH /lines/:i` (edit)                                  | new `line_digest`                                 | Yes — a different string, correctly                                           |
| 6   | `POST /:id/retry`                                         | `resetForRetry` re-drives only `failed_retryable` | Yes, and correctly — those carry no answer, and the cache is still read first |
| 7   | Validator disputes the foods                              | owner ruling: up to 3 retries                     | Yes, deliberately                                                             |
| 8   | Engine generation changes                                 | cache key includes `engine_version`               | Yes, deliberately                                                             |
| 9   | `cookbook-import`                                         | `NO_CACHE` (ADR-0026 §6)                          | **Yes, every run** — see item C                                               |
| 10  | Two submissions in flight together, digest never answered | none in the pipeline                              | **See §3**                                                                    |

⛔ **The cache is GLOBAL, not per-owner.** `findForLines` is `WHERE line_digest = ANY($1::text[])` with no
owner predicate, so one person's parse answers everyone's identical line. Copy-forward is per-owner
(`j.owner_id = $1` is its authorization), which is why row 2 costs a message: the answer is reused, the
queue hop is not avoided.

## 3. The concurrent window — measured, and it is not what the ADR implies

ADR-0044 records the window as open. That is true **of the pipeline module in isolation** and was written
about it. Against the DEPLOYED system the answer is per stage, and it comes from
`infra/lib/consumerConcurrency.ts`:

| Stage class                  | `reservedConcurrentExecutions` | `maximumConcurrency` | `batchSize` | Window                                                                               |
| ---------------------------- | ------------------------------ | -------------------- | ----------- | ------------------------------------------------------------------------------------ |
| non-prod (sandbox, `pr-{N}`) | 1                              | unset                | 1           | **CLOSED** — strictly one message at a time, so the second finds the cache populated |
| prod                         | 5                              | 5                    | 1           | **OPEN** — up to 5 concurrent invocations                                            |

⚠️ And prod currently deploys **no** parse Lambda, so the window is unreachable in every stage today. It
becomes reachable the day the parse leg ships to prod, bounded at N−1 extra asks per engine at
concurrency N — four at prod's `maximumConcurrency: 5` (ADR-0044).

**This changes the priority, not the decision.** It is not a live defect; it is a latent one that arrives
with a deploy. It is worth closing by construction rather than by a concurrency setting nobody will
remember is load-bearing.

## 4. Work items, in priority order

### A — close the concurrent window with a per-digest lease (this plan's subject)

The constraint from ADR-0044 stands: no design may hold a connection or a transaction across the engine
call, and a reservation whose holder dies must expire or the digest is blocked forever.

**Design: a lease row, the same idiom `claimLine` already uses for a job line.**

- `ingredient_parse_leases (line_digest PRIMARY KEY, leased_until timestamptz NOT NULL)`.

    ⛔ Keyed on the LINE, not on the cache's key. `ingredient_parse_cache` is keyed per
    `(line_digest, engine, engine_version)` because it stores one answer per engine — but the worker asks BOTH
    engines in a single `runParsePipeline` call, and that call is what is being serialised. The line is the
    indivisible unit of work and therefore of the lease; keying per engine would need two leases for one call.

- Acquire: `INSERT … ON CONFLICT (line_digest) DO UPDATE SET leased_until = excluded.leased_until WHERE
ingredient_parse_leases.leased_until < now() RETURNING leased_until::text`. **Zero rows IS the refusal** —
  the house shape (`resolutionMappings.dal.ts`, the spend ledger's conditional insert).
- Release is **FENCED** on the returned `leased_until`. Matching on `line_digest` alone would delete whoever
  holds the row — including a later holder that took over after this caller's lease expired mid-parse —
  which re-opens the very window the lease closes. The fence is carried as TEXT because `timestamptz` keeps
  microseconds while a JavaScript `Date` keeps milliseconds, so a `Date` round trip could never match.
- Held → run the pipeline, then release by deleting the row.
- Refused → another invocation owns this digest. Wait a bounded interval, re-read, and **proceed anyway**
  if it is still absent. The lease is an optimisation, never a correctness dependency: a stuck holder must
  never strand a cook's line.

⛔ It lives in `recipe-workers`, wrapping the pipeline call — NOT in `recipe-import-core`. Concurrency is a
property of the deployment, not of the orchestration, and the shared module has a Null-Object cache for
`cookbook-import` precisely because it must not acquire a database.

### B — the spend ceiling is inert (highest financial risk)

`SPEND_GATED_STAGE = 'prod'` and prod deploys no Bedrock consumer, so the $100 ceiling **has never
executed anywhere**. Every real call is non-prod and ungated; the $252.96 `pr-91` burn was stopped by
killing a load test, not by a control. Needs an owner ruling — ADR-0024 §3's "prod only" is a dated
decision (2026-08-21) and amending it is not a quiet edit.

### C — `cookbook-import` re-parses every run

`NO_CACHE` is deliberate (the tool owns no database), but it means a repeated import re-asks every line.
Options: accept, or give the tool a file-backed cache adapter keyed the same way. Not a service defect.

### D — the recency window is a proxy

`recipe_parse_job_lines` carries no engine version, so a model pin inside the window still serves the old
answer. The fix is to record the engine version on the landed line, after which the window is **deleted**
rather than tuned.

### E — CACHE-ERASES-VERDICT

Validator reasons do not survive the parse cache.

### F — smaller, already scoped

`ParseIngredientsScreen` and `CollectionFormScreen` have no back guard; `enqueueOrMark` marks every message
retryable when any batch fails; the corpus-wide diff is owed and spends real money.

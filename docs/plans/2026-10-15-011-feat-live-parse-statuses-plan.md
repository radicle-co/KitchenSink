---
title: Live per-line parse statuses
type: feat
status: draft
date: 2026-10-15
---

# Live per-line parse statuses

## Owner rulings (2026-10-13)

> "It takes as long as it takes. Seems like we just need better statuses and loading state so that the users
> understand it is still being processed and what step we are in and what we are currently processing. I realize
> that this will require a server update most likely to post back statuses."

Decisions recorded with it:

1. **No time limit.** Nothing on the client gives up on a line because a clock ran out.
2. **The server reports a per-line phase**: queued / reading / retrying / delayed / stalled.
3. **The phase is computed at READ time** (`lineProgressOf`) from facts the pipeline already records, where
   possible, rather than through a new write path.
4. **The paste hold releases when the app goes to the background.**
5. **Measure non-prod parse concurrency before raising it** — measure only, change nothing.

## What exists today (measured from the tree at `183d41ca2`)

- `recipe_parse_job_lines` already records, per line: `status` (`pending | parsed | unparseable |
failed_retryable`), `attempts` (claims, migration 0046, NULL before it), `last_received_at` (the claim lease),
  `failure_code` (`delivery_allowance_exhausted`, or NULL), `copied_at`, `updated_at`. The job records
  `created_at`, `updated_at`, `expires_at`.
- The worker (`recipe-workers/src/handlers/parseLine.ts`) claims a line in ONE UPDATE (`attempts + 1`,
  `last_received_at = now()`), then runs the pipeline; a transient engine failure THROWS (SQS redelivers after the
  visibility timeout) and writes nothing; past the 20-claim allowance the line becomes `failed_retryable` with
  `failure_code = 'delivery_allowance_exhausted'`.
- The client (`features/recipes/src/editor/pastedLines.ts`) has a **3-minute client time limit**
  (`PASTE_STALL_BOUND_MS = 180_000`): past it, every unsettled line is read by the add field's simpler reader.
  That is the time limit ruling 1 removes. Its reason still stands — a dead-lettered line stays `pending` until the
  24-hour TTL — so it is REPLACED (a server-reported `stalled` phase plus a cook-chosen way out), never just deleted.
- The paste hold (`editor/pasteHold.ts`) holds the never-saved draft's server CREATE while lines are joining.
  `serverWriteFor` (`editor/checkpointPolicy.ts`) already lets `editorExit` through; `appHidden` is held.
- The operator backstop (`recipe-workers/src/handlers/queueCheck.ts` over `@kitchensink/queue-check`'s
  `classifyOwed`) classifies the parse class every 5 minutes as delayed / stuck / lost / exhausted /
  dead-lettered, reading BOTH the rows and the SQS transport.

## Blueprint (staff-architect, BLUEPRINT, 2026-10-15)

### Corrections the blueprint found in the "what exists" picture

- A `failed_retryable` line with NULL `failure_code` has TWO writers — the enqueue-failure mark
  (`parseJobs.dal.ts` `markLinesFailedRetryable`) and the worker's `landingOf(null)` when neither engine answered —
  and neither self-heals: `claimLine` requires `status = 'pending'`, so a message that arrives after the mark is
  refused. "It may still land" survives only for a worker that claimed BEFORE the mark (a millisecond race). The
  self-heal paragraphs in `queries.ts`, `useParseJob.ts` and `pastedLines.ts` rule 1 are stale since U6 and are
  corrected in this change.
- The residency refusal (`parseLine.ts`) lands nothing and throws nothing: the line stays `pending` with an aging
  claim. It reads `delayed`, then `stalled`.
- Lines join in paste order, so a line waiting on the cook blocks every later line, Publish and a second paste. A
  cook-chosen way out is therefore REQUIRED, not a nicety.
- iOS `inactive` (Control Center, the app switcher) already counts as unfocused (`mobile/src/query/connectivity.ts`),
  so it raises `appHidden`. That is ADR-0057's existing meaning of the trigger; this plan states it, not changes it.

### The phase table (computed at read time; `status = 'pending'` only, every other status carries `progress: null`)

Inputs, from ONE statement with the database's `now()`: `attempts = COALESCE(attempts, 0)`,
`claimAge = now() - last_received_at` (NULL when never claimed), `jobQuiet = now() - max(updated_at) OVER ()` over
the job's lines. First match wins:

| #   | Phase      | Predicate                           | Meaning                                                |
| --- | ---------- | ----------------------------------- | ------------------------------------------------------ |
| 1   | `retrying` | `claimAge ≤ lease AND attempts ≥ 2` | a second-or-later delivery holds the claim             |
| 2   | `reading`  | `claimAge ≤ lease AND attempts ≤ 1` | the first delivery holds the claim                     |
| 3   | `stalled`  | `jobQuiet > stall`                  | nothing in the whole paste has moved for two re-offers |
| 4   | `queued`   | `claimAge IS NULL`                  | never claimed                                          |
| 5   | `delayed`  | otherwise                           | the claim lapsed and no new one has been taken yet     |

- **Every phase is INFERRED, none is recorded.** No new write path, no migration (ruling 3).
- `≤ lease` mirrors `claimLine`'s refusal (`last_received_at < now() - lease`). A held claim implies
  `jobQuiet ≤ lease < stall`, so rows 1–2 can never meet row 3; the order only makes that explicit.
- Quiet is measured per JOB, not per line: non-prod drains one line at a time, and a line behind its siblings is
  `queued` for as long as its siblings keep landing.
- **Residual:** a job queued behind ANOTHER cook's job reads `stalled`. So `stalled` settles nothing by itself,
  polling continues, and the phase moves back the moment work resumes. Its copy says "taking longer than usual".
- **Known imprecision:** inside the lease an attempt that already threw still reads `reading`, for up to 150 s.
- **Relation to the queue watcher** (`queueCheck.ts` / `classifyOwed`): that is the OPERATOR path and reads the SQS
  transport; this is the COOK's path and reads rows only (the API gains no SQS permission). `stuck` ⊇ `delayed` ∪
  stalled-after-a-claim; `lost` ⊆ `queued` ∪ `stalled`; a dead-lettered line reads `stalled` to the cook, which is
  honest. `queueCheckReads.ts`' `claimed_too_long` uses the same lease test as `delayed`, so it reports every
  between-attempts line as `stuck` — recorded as a follow-up, not changed here.

### One timing authority

`packages/shared/recipe-core/src/parsing/parseLineDelivery.ts` (export `./parsing/parse-line-delivery`):
`PARSE_LINE_DELIVERY = { leaseSeconds: 150, visibilityTimeoutSeconds: 180, stallSeconds: 2 × 180 }`. The workers
stack builds its handler timeout and visibility timeout `Duration`s from it (synth: no diff) and the service imports
it directly. SSM was rejected: a deploy-time-resolved value drifts silently until the reading stack redeploys,
where a compiled constant moves both sides in one commit. Precedent: `PARSE_JOB_AGGREGATE_SQL`.

### Server

- Pure Policy `lineProgressOf(line, jobQuietSeconds, delivery)` in
  `recipe-service/src/recipes/domain/lineProgress.ts`, beside `copyForwardPolicy.ts`. No clock, no SQL.
- `ParseJobsDal.getJob` adds `attempts`, `claimAgeSeconds` and `jobQuietSeconds` (`::float8`, so node-pg answers a
  number rather than a numeric string). `ParseJobLineRecord` gains REQUIRED `attempts`/`claimAgeSeconds`,
  `ParseJobRecord` gains REQUIRED `quietSeconds`, so every literal and fake is a compile error until updated.
- Wire: `parseJobLineSchema` gains `progress: { phase } | null`, required and nullable, non-null exactly when
  `status = 'pending'`. An object, so a later field is additive. No job-level counts on the wire (they are a pure
  fold over the lines). Contract regenerated in the same commit.
- **One-way door:** the phase vocabulary. Installed mobile clients parse enums strictly, so a new phase later is a
  breaking change; a new FIELD on the object is not.

### Client

- `parseJobPollIntervalOf(job, now, runningMs)` (pure, `clients/recipe-service/src/queries.ts`): `false` when not
  live or terminal; `running` polls at the running cadence UNLESS every pending line is `stalled`, then at the
  settling cadence; `partial` at the settling cadence. Without the back-off an open editor polls every 4 s for 24 h.
  Polling has no time limit; it is bounded by `expiresAt` and by the editor being open, and pauses in the background
  (TanStack's `refetchIntervalInBackground: false`).
- `pastedLines.ts`: `PASTE_STALL_BOUND_MS` and `runningSince` are deleted (ruling 1). A line is `reading` (with its
  phase), `awaitingCook` (`stalled` or `retryable`) or `settled`. A line the cook chose to "Add as typed" settles
  through the add field's reader whatever lands later. Server terminals (expired, unreadable job) still settle.
- `usePasteIntoIngredients.ts`: the stall timer becomes one timer at the job's `expiresAt`; adds `addAsTyped` and a
  job-wide `retryParse` over the existing `useRetryParseJob`.
- `PasteReadingRow.state`: `queued | reading | retrying | delayed | stalled | retryable | waiting | lookupFailed`
  (`failed` renamed). Precedence: `lookupFailed` > `waiting` > the line's own state.
- Paste hold: `serverWriteFor` releases on `appHidden` as well as `editorExit` (`PASTE_HOLD_RELEASES`). Lines that
  join after that create land as authored lines (no source), as D10 accepts. ADR-0057's sentence is amended in place.

### Pattern register

- **Policy** — `lineProgressOf` (new), `serverWriteFor`'s release set (extended).
- **Shared Kernel** — `parseLineDelivery.ts`, beside `PARSE_JOB_AGGREGATE_SQL`.
- **Repository** — `ParseJobsDal` (preserved; the database clock is its one clock).
- **Adapter / projection** — `viewOf`, `projectProposal`, `pastedLinesOf` (preserved).
- **Published Language** — the service-owned zod schema copied to `@kitchensink/schema-recipe` (ADR-0014).
- **Strategy as Policy** — `parseJobPollIntervalOf` (extracted from the `refetchInterval` lambda).
- **Observer** — the poll (preserved). **Command** — the join and the retry, already TanStack mutations.
- **Visitor** — exhaustive switches in `pastedLinesOf` and `PastedReadingRow`.
- **Shared state holder** — `pasteHold` (unchanged).

## UX specification

_To be filled from the staff-ux-engineer SPECIFY run._

## Concurrency measurement (non-prod, from code and config — nothing changed)

_To be filled._

## Build order and test tiers

_To be filled._

## Open questions

_To be filled._

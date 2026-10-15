---
title: Live per-line parse statuses
type: feat
status: built
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

## UX specification (staff-ux-engineer, SPECIFY, 2026-10-15)

### Row states

Each pasted row keeps its text (2-line clamp), then a state line (16 px glyph + caption), then at most ONE action on
its own line, so nothing wraps inside a control at 320 px. Glyphs carry four meanings: `refreshCw` working, `clock`
waiting, `check` already read, `triangleAlert` needs you. Two client-only states close a gap the blueprint's list
missed: a line already read but waiting behind an earlier one has `progress: null`, so it needs its own honest state.

| State          | State line (key)                                               | Glyph / tone                  | Row action (label key → a11y-name key)                                                  |
| -------------- | -------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `queued`       | Waiting to be read (`rowStateQueued`)                          | clock / inkMuted              | —                                                                                       |
| `reading`      | Reading… (`rowStateReading`)                                   | refreshCw, static             | —                                                                                       |
| `retrying`     | Reading again… (`rowStateRetrying`)                            | refreshCw, static             | —                                                                                       |
| `delayed`      | Waiting to try again (`rowStateDelayed`)                       | clock / inkMuted              | —                                                                                       |
| `stalled`      | Taking longer than usual (`rowStateStalled`)                   | clock / inkMuted, NEVER alert | Add as written (`statusActionAddAsWritten` → `statusActionAddAsWrittenLabel`, `{line}`) |
| `retryable`    | Couldn't read this line (`rowStateRetryable`)                  | triangleAlert / attention     | Add as written (same keys); Try again lives on the progress block                       |
| `ready`        | Read. Joins in paste order. (`rowStateJoinsInOrder`)           | check / inkMuted              | —                                                                                       |
| `joining`      | Looking it up… (`rowStateLookingUp`)                           | refreshCw, static             | —                                                                                       |
| `waiting`      | Reads when you're back online (`rowStateWaitingForConnection`) | clock / inkMuted              | —                                                                                       |
| `lookupFailed` | Couldn't look up (`rowStateLookupFailed`)                      | triangleAlert / attention     | Try again (`statusActionRetry` → `statusActionRetryLookupLabel`)                        |

Precedence: `lookupFailed` > `waiting` > the line's own state. "Add as written", not "Add as typed": the cook pasted
the text. `{line}` is the raw line, because a pasted line is not a food yet.

### The progress block — one per paste, directly ABOVE the first pasted row

- Title: `pasteProgressCount` (`PluralText`) "Added {done} of {count} line(s)" — lines IN the recipe, so it never
  goes backward.
- Status line, first match wins: needs-you count (`pasteProgressNeedsYou`, attention) → offline
  (`pasteProgressOffline`) → every pending line stalled (`pasteProgressStalled` + `pasteProgressStalledHint`) → the
  head line's step, by its 1-based position: `pasteProgressReading` / `pasteProgressRetrying` / `pasteProgressDelayed`
  / `pasteProgressQueued` / `pasteProgressLookingUp`.
- Actions (ghost buttons, wrap between buttons, never inside one):
    - **Try again** — once, job-wide, when ≥ 1 line is `retryable`: it re-drives every retryable line, so a per-row
      button would describe an action it does not perform. A11y name `pasteRetryAllLabel` (`PluralText`).
    - **Add the rest as written** — when ≥ 2 lines are `stalled` or `retryable`: 200 per-row taps is not a way out.
      Applies to every line not yet read; lines already `ready` keep their parse. A11y name `pasteAddRestAsWrittenLabel`.

### Accessibility and motion

- ONE polite live region per paste, separate from the visible block (which is not live). It speaks only at
  milestones — started (`pasteProgressStarted`), first line needs the cook, all stalled, moving again
  (`pasteProgressResumed`), offline — at most once every 10 s, newest wins. Row and count changes announce nothing.
  The finish is the existing `pasteAdded` region's.
- Focus never drops to `body`: after an action, focus moves to the progress block (web `useFocusOnSignal`, native
  `useScreenReaderFocusOnSignal`).
- **Nothing moves**, on either platform: WCAG 2.2.2's loading exemption needs the page to be unusable during the wait,
  and here the editor stays usable through a read that can last 150 s. Activity is shown by the text changing.
- Web list semantics: the pasted rows sit in their own list labelled "Lines not added yet" (`pasteReadingListLabel`).

## Concurrency measurement (non-prod, from code and config — nothing changed)

Read from `recipe-workers/infra/lib/consumerConcurrency.ts` and `RecipeWorkersStack.ts` (ruling 5: measure, do not
raise), then MEASURED by synthesizing the stack for `sandbox`, `pr-91` and `prod` (2026-10-15, a throwaway probe, not
committed). The synthesized template agrees with every row below: parse function `ReservedConcurrentExecutions` 1 / 1 /
5, `Timeout` 150, `PARSE_CLAIM_LEASE_SECONDS` 150, `PARSE_DELIVERY_ALLOWANCE` 20; queue `VisibilityTimeout` 180,
`MessageRetentionPeriod` 345,600 (4 days), `maxReceiveCount` 181; event-source mapping `BatchSize` 1 with no
`ScalingConfig` in non-prod and `MaximumConcurrency` 5 in prod. The verification consumer is 1 / 1 / 5 as well.

| Setting                                      | Non-prod (`sandbox`, `pr-{N}`)                                  | Prod |
| -------------------------------------------- | --------------------------------------------------------------- | ---- |
| `reservedConcurrentExecutions` (parse fn)    | **1**                                                           | 5    |
| Event-source `maxConcurrency`                | unset (AWS's minimum is 2, so 1 is expressed by leaving it out) | 5    |
| `batchSize`                                  | 1 (one message is one line)                                     | 1    |
| Handler timeout = claim lease                | 150 s (`PARSE_LINE_DELIVERY.leaseSeconds`)                      | same |
| Queue visibility timeout                     | 180 s                                                           | same |
| `maxReceiveCount`                            | ceil(9 h / 180 s) + 1 = **181**                                 | same |
| Claim allowance (`PARSE_DELIVERY_ALLOWANCE`) | 20 claims                                                       | same |
| Lease wait for a refused caller              | 1.5 s                                                           | same |
| Memory                                       | 512 MB                                                          | same |
| CRF Lambda (`ingredient-parser`)             | no reserved concurrency, 60 s, 1,024 MB                         | same |
| Local consumer (`parseQueueConsumer.ts`)     | `MaxNumberOfMessages: 1`, 20 s long poll                        | —    |

So a non-prod stage drains **one line at a time, shared by every cook on that stage**: a 200-line paste is 200
sequential invocations, each up to 4 parse + 8 validator Bedrock calls plus one CRF invoke. This is the main source of
a non-prod paste reading `queued` for a long time, and of a paste behind another cook's reading `stalled`.

⚠️ No parse-duration metric exists (`parseLine.ts`' own note on `PARSE_LEASE_WAIT_MS`), so THROUGHPUT is not measured:
the numbers above bound concurrency, not lines per minute. To measure before raising: CloudWatch `AWS/Lambda` Duration
(p50/p95/max), Throttles and ConcurrentExecutions for `RecipeParseLineFunction`, and SQS
`ApproximateAgeOfOldestMessage` on `kitchensink-recipe-parse-{stage}`.

⚠️ A stale comment found while measuring: the parse queue's `deadLetterQueue` comment still argues for
`maxReceiveCount: 20`, while the code computes 181 from `receivesBeforeParking`. Not changed here.

## Build order and test tiers (as built)

| Commit                           | What                                                                                         | Tiers (red first, then green)                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| C1 `feat(recipe-core)`           | `PARSE_LINE_DELIVERY`; the workers stack builds its Durations from it                        | recipe-core unit; stack synth parity (red with the constant moved and the stack literal)                                    |
| C2 `feat(recipe-service)`        | `lineProgressOf`, DAL facts, `progress` on the wire, contracts regenerated                   | policy table; schema; service unit; mocked HTTP integration (red on the stale published copy); LOCAL e2e                    |
| C3 `feat(recipe-service-client)` | `parseJobPollIntervalOf` back-off; stale self-heal docs corrected                            | queries unit table                                                                                                          |
| C4 `feat(features-recipes)`      | `appHidden` releases the paste hold; ADR-0057 amended in place                               | policy table row rewritten; editor hook case (red with the old release set)                                                 |
| C5 `feat(features-recipes)`      | row states, progress block, polite region, Add as written, Try again; 3-minute limit deleted | projection, progress and copy tables; hook tests; component tests for every state on web and native; paste-list integration |
| C6 `test(e2e)`                   | Playwright cases, Maestro flows, k6 `pollProgress`                                           | written, not run                                                                                                            |
| C7 `test(recipe-service)`        | the DAL's ages asserted as numbers                                                           | LOCAL e2e (red with the cast dropped)                                                                                       |

Playwright, Maestro and k6 were written and not run. The recipe-service LOCAL e2e suites for parse jobs were run on
throwaway Postgres 18 + LocalStack containers.

## Open questions and residual risk

1. **The 24-hour TTL still expires a job.** "No time limit" is read as the client's limit; retention is untouched. A
   paste left stalled for a day expires and its unread lines join through the reader at the deadline.
2. **A paste queued behind another cook's reads `stalled`.** Rows cannot see the queue. The copy promises nothing, and
   the phase moves back when work resumes. Exact only if a later fact (queue position) is added to `progress`.
3. **RESOLVED: the operator backstop's `claimed_too_long`** now counts a pending line only when its claim lapsed AND its
   whole job has been quiet past `PARSE_LINE_DELIVERY.stallSeconds`, which is the cook's `stalled` (a line between two
   attempts is `delayed` and no longer reported). The stall window is the shared constant, bound as `$2`.
4. **RESOLVED: a refused Try again** now shows a localized failure line in the progress block (web and native), and
   focus returns to the block that says it.
5. **RESOLVED: focus after Add as written** goes to the next waiting row's action (the next stalled or retryable row after
   it, else the first before it) through the Button's `focusRequested` level, and to the progress block only when no row
   waits.
6. **iOS `inactive`** (Control Center, the app switcher) releases the paste hold, because it already raises `appHidden`.
7. **Publish blocked by lines still joining** may need its reason named in the action bar (UX open question).
8. **RESOLVED: Add as written withdraws the line server-side** (`POST /api/v1/recipe-parse-jobs/{id}/withdraw-lines`,
   migration 0054 adds the terminal line status `withdrawn`). THE RULE: a withdrawal flips each still-open line
   (`pending`, `failed_retryable`) under a row lock, and the worker's claim only takes a `pending` line under the same lock,
   so a line is either claimed BEFORE the withdrawal or REFUSED after it. No engine is asked for a line after its
   withdrawal commits. What it cannot recall: a delivery that claimed the line first may finish its one in-flight call; its
   landing is refused (`status <> 'withdrawn'`), so it never overwrites the cook's choice. Nothing is removed from SQS.
   The call is idempotent, owner-only (stranger and absent are one `404`, an expired job `409`), and best effort on the
   client: a refusal never holds the join back. Residual: `withdrawn` is a new wire status and installed clients parse the
   enum strictly, so only a cook polling the same job from an older build on a second device would see a failed parse.
9. **A failed poll is not a give-up.** Only a failure the client's retry policy calls terminal (the job gone or refused)
   ends a paste; a transient one keeps the lines where they were. Fixed in this change after review; recorded because
   the earlier code silently added everything as written on any read failure.

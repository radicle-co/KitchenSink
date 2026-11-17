# Implementation Plan: Flow Steps (rewritten recipe steps)

**Branch**: single-branch directive | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/027-rewritten-steps/spec.md`. Every clarification there is assumed and waits for the owner.

**Status**: Planned, not built. `staff-architect` PLANNING ran on 2026-11-15 (opus) and its pattern register is folded
in below. BLUEPRINT, `staff-ux-engineer` DISCOVER/DESIGN/SPECIFY and the ADR are owed before any code.

## Summary

An owner asks for Flow Steps on one recipe. recipe-service checks eligibility (a pure Specification), computes a
content digest of the saved recipe, and either returns the stored version (cache hit, no model call, no use) or
creates one pending job (single-flight on `(recipe_id, content_digest)`) and enqueues it. A new recipe-workers Lambda
builds a facts-only sheet, calls a non-Anthropic Bedrock model through the existing `gatedConverse` reserve/settle
path under a new call site, parses the answer as data, and runs two deterministic checks (two-way fact multiset,
wording similarity ceiling). A pass writes the one attached version and charges one use, keyed on the job id. Replace
is an Apply Command over the stored version through the existing recipe `update` (compare-and-swap on
`expectedVersion` plus a digest check), so versions, the 020 check and the label rules come for free.

The writer and both checks are one engine in `@kitchensink/recipe-core` (`src/stepWriting/`), built first by spec 003B (FR-045), then consumed by this feature and by 020's suggestion. Each composes it with
its own call site, charging rule and sink.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node 24 (repo toolchain).
**Primary Dependencies**: NestJS 11 (recipe-service), Drizzle ORM, zod + `nestjs-zod`, AWS SDK v3 Bedrock Runtime
`Converse` (recipe-workers, via `gatedConverse`), SQS, TanStack Query (clients), Tamagui (mobile UI), Next.js 16 (web).
**Storage**: recipe PostgreSQL 18 (two new tables, one migration). Device: 019's offline store for the attached version.
**Testing**: vitest unit + integration (DB mocked, DD12), LOCAL e2e for the migration and the single-flight index,
worker tests, Playwright (web), Maestro (mobile), k6 by hand.
**Target Platform**: web + iOS + Android. Recipe-service on Fargate. Worker on Lambda (VPC, NAT consumer).
**Project Type**: monorepo feature across shared core, one service, one worker, two apps.
**Performance Goals**: cache hit < 1 s end to end (SC-003). P95 generation ≤ 30 s (SC-004).
**Constraints**: facts-only writer input. No Anthropic model. No own keys. Fail closed on spend. Never truncate input;
job timeout 10 min.
**Scale/Scope**: one row per recipe. Generation bounded by the cook's monthly uses (`010-FR-041b`).

## Constitution Check

| Principle                   | Status | Note                                                                                             |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| I Correctness / types       | PASS   | Outcome is a discriminated union; wire types zod in-service (DD15).                              |
| II JSDoc                    | PASS   | `@pattern` on the Specification, Adapter, Command and the cooking-mode orchestration hook.       |
| III Imports / organisation  | PASS   | Subpath exports per pure module, as `parsing/parse-prompt` already does. No barrels.             |
| IV Testing pyramid          | PASS   | Tier matrix in §Testing. Fact check gets a mutation suite.                                       |
| V Monorepo                  | PASS   | No new package. recipe-workers already depends on recipe-core.                                   |
| VII Accessibility / UX      | PASS   | every state in FR-061, `recipes.flowSteps.*` keys, `staff-ux-engineer` owed.                     |
| VIII Cross-platform         | PASS   | Web + mobile in one release (FR-060).                                                            |
| IX Patterns / seams / React | PASS   | Register below. Render components get a plain `steps` array, no mode prop.                       |
| ADR-0024 layer 4b           | PASS   | Runs under the one verification role; new `SPEND_CALL_SITES` member; `llmSpendGuards` unchanged. |
| ADR-0004 NAT list           | AMEND  | New VPC Lambda adds a `nat-consumers` row (guard `natEgressConsumers.test.ts`).                  |
| ADR-0093 / 003B-FR-015      | PASS   | A replace never changes the rights label and publishes nothing (FR-032).                         |

No unjustified violation. No Complexity Tracking entry.

## Pattern register

**Prescribed (staff-architect PLANNING, 2026-11-15):**

- **Pipeline of pure functions**: `buildFactsSheet → buildStepPrompt → (writer port) → parseStepAnswer → checkFacts →
checkWording`. Each stage its own module and subpath export under `recipe-core/src/stepWriting/`.
- **Type-pinned input**: `buildStepPrompt(sheet: FactsSheet)` arity pinned with `Exact<Parameters<…>, [FactsSheet]>`
  like `buildParsePrompt`. System prompt pinned by length and SHA-256. No path can pass step wording.
- **Adapter on a Template Method**: `createGatedStepWriter(deps, modelId, callSite)` in recipe-workers over
  `gatedConverse`. `gatedConverse` itself is not refactored. Its default "ceiling denial throws and redelivers" is
  overridden for this step to a terminal `budgetSpent` (010-FR-041d). That override is the contract to test.
- **Outcome union + exhaustive switch = Visitor**: `StepRewriteOutcome = ok | factCheckFailed | tooSimilar |
budgetSpent | failed`. No visitor machinery.
- **Strategy at the consumer edge, not in the engine**: 027 composes the engine with call site `step-rewrite-cook`,
  charge = one cook use, sink = the attached version. The import-time public version (003B) composes it with its own call
  site, operating cost and its job row. 020's suggestion with a suggestion sink. No mode flag enters the engine.
- **Specification**: `rewrittenStepsEligibility(input) → { eligible } | { refused: reason }` in
  `recipe-service/src/recipes/domain/`, sibling of `publishPolicy.ts` / `privateSlotPolicy.ts`. Reasons map 1:1 to
  the spec's states.
- **Cache-Aside with single-flight**: lookup by `(recipe_id, content_digest)`. Miss inserts a pending job guarded by a
  partial unique index. A concurrent insert collides and returns the existing job id.
- **Command**: Apply = one service method over `RecipesService.update` with `expectedVersion` + digest equality. The
  client side is a TanStack mutation (Command already satisfied by the library).
- **Headless hook + pure render**: `useCookingSteps(recipe)` orchestration hook chooses Original or Flow Steps and
  hands a plain step array to the existing render components. No `mode` prop on render.
- **Ownership**: core owns correctness, the worker owns spend, the service owns state and access.

**Preserved (do not "refactor away"):**

- `verifyLine.ts` stays off `gatedConverse`.
- `update`'s compare-and-swap on `expectedVersion`; `recordsVersion` keyed on `firstPublishedAt` (ADR-0058).
- 404-not-403 for another owner's recipe (as `parseJobs`).
- One spend pool, attribution not partition (ADR-0024 §4c).

**Intent already satisfied (add nothing):** discriminated union as Visitor; TanStack mutation as Command. The
natural key `(recipe, digest)` as the idempotency key (no `Idempotency-Key` header, which would be a second source of
the same fact).

## Where the engine lives (FR-045)

| Part                                                                          | Location                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Fact sheet; the lexicons live in the language entry                           | `packages/shared/recipe-core/src/stepWriting/factsSheet.ts`             |
| Prompt builder + pinned system prompt                                         | `…/stepWriting/stepPrompt.ts`                                           |
| Answer parser (zod, data only)                                                | `…/stepWriting/stepAnswer.ts`                                           |
| Two-way fact check                                                            | `…/stepWriting/factCheck.ts`                                            |
| Hashed fingerprint and the shingle measure (each consumer owns its threshold) | `…/stepWriting/wordShingles.ts` (020's copy check reuses it)            |
| Content digest                                                                | `…/stepWriting/contentDigest.ts` (pure; used by service and worker)     |
| Engine `rewriteSteps(sheet, writer, wording) → Outcome`                       | `…/stepWriting/rewriteSteps.ts`                                         |
| Bedrock writer adapter                                                        | `packages/services/recipe-workers/src/stepWriting/gatedStepWriter.ts`   |
| Worker handler                                                                | `packages/services/recipe-workers/src/handlers/rewrittenStepsWorker.ts` |
| API, tables, eligibility, apply                                               | `packages/services/recipe-service/src/recipes/rewrittenSteps/`          |

Amounts reuse `readCooksMeasure` in `@kitchensink/recipe-core/parsing/measure-reader`; the temperature reader is new, inside the engine. Durations come from `@kitchensink/cooking-core`
`duration.ts`, which depends on `recipe-core`, so the fact sheet takes a duration reader as an INJECTED input
(`buildFactsSheet(recipe, { durations })`); the reverse import would be a cycle. A test in `packages/shared/cooking` runs
the sheet with the real reader. A second reader would break the "same reader every channel" rule (004-FR-057).

The fingerprint functions take no key and no clock of their own. The keyed hash is an injected
`KeyedHash = (shingle: string) => bigint`, and `jaccard(a, b)` and `containment(part, whole)` take fingerprint sets. The
wording limits arrive as the `wording` argument of `rewriteSteps`: `{ source: Fingerprint, hash, limits }`.

## Key decisions (detail in research.md)

1. Facts-only input for every recipe (R1). 2. Two-way fact multiset across the whole recipe (R2). 3. Similarity is a
   ceiling on reuse, measured on a hashed fingerprint of word 5-shingles, threshold from the evaluation set (R3). 4. Writer chosen by a Bedrock
   bake-off among non-Anthropic models, default candidate Nova 2 Lite (R4). 5. Digest covers steps, ingredient lines and
   language. Validity ignores engine version (R5). 6. One row per recipe (R6). 7. Eligibility needs `firstPublishedAt`,
   so a replace always records a version (R7). 8. Use charged only on `ready`, keyed on job id, through 005's ledger
   (R8). 9. Terminal `budgetSpent`, never redelivered (R9). 10. Offline copy rides 019's recipe cache (R10).

## Project Structure

### Documentation (this feature)

```text
specs/027-rewritten-steps/
├── spec.md
├── plan.md            # this file
├── research.md
├── data-model.md
├── quickstart.md
├── agentNotes.md
├── contracts/rewrittenSteps.api.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/shared/recipe-core/src/stepWriting/          # pure engine (new)
packages/services/recipe-service/src/recipes/rewrittenSteps/ # controller, schema, service, DAL, eligibility (new)
packages/services/recipe-service/src/database/migrations/00NN_rewritten_steps.sql
packages/services/recipe-workers/src/stepWriting/      # gated writer adapter (new)
packages/services/recipe-workers/src/handlers/rewrittenStepsWorker.ts
packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts  # Lambda, queue, DLQ, reserved concurrency
packages/schemas/recipe (generated copy, contract:generate)
packages/clients/recipe-service-client (hooks: useRewrittenSteps, useRequestRewrittenSteps, useApplyRewrittenSteps, useRemoveRewrittenSteps)
packages/apps/commise/features/recipes/src/rewrittenSteps/  # orchestration + render, web and .native
packages/apps/commise/features/cooking/                # Original / Flow Steps switch via useCookingSteps
```

**Structure Decision**: no new package or deployable. One new Lambda inside the existing worker stack.

## Build order

0. Prerequisites: 005's use ledger (FR-015a) exists. The plan register gains `rewrittenSteps`; ADR written. Evaluation set
   (≥ 200 recipes) assembled privately, never committed.
1. recipe-core engine, test-first, with the mutation suite for the fact check.
2. Migration + LOCAL e2e (tables, partial unique index, cascade, erasure coverage).
3. recipe-service: eligibility Specification, digest, request/status/apply/remove, zod contract, `contract:generate`.
4. recipe-workers: adapter, handler, infra (Lambda, queue, DLQ, reserved concurrency, NAT row, call site member).
5. Bake-off on the evaluation set. Set the similarity threshold and caps from measurements. Pin model id.
6. Clients and UI after `staff-ux-engineer` SPECIFY. Web and mobile together.
7. 008 integration (switch, timers, place mapping) and 019 offline cache.

## Testing (tiers owed, test-first)

| Tier                        | What                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (core)                 | Sheet extraction per category; prompt arity and SHA pin; answer parser refusals; fact check both directions with mutants (drop one amount, add one, change a duration, drop a safety line, merge/split steps); shingle measure. |
| Unit (service)              | Eligibility reasons, digest stability (whitespace, order), state union mapping, apply digest/version refusal.                                                                                                                   |
| Integration (mocked)        | Request hit/miss, concurrent request returns one job, use charged once on ready, none on refusal, 404 for others.                                                                                                               |
| Worker                      | `budgetSpent` terminal and not redelivered; unreadable counter retried; 10-min expiry → failed; recipe deleted mid-job → discarded, no charge.                                                                                  |
| LOCAL e2e                   | Migration applied; partial unique index rejects a second pending; cascade on recipe delete; erasure.                                                                                                                            |
| Service e2e (deployed) + k6 | Request/status/apply round trip; k6 on status reads (hit path).                                                                                                                                                                 |
| Component (both)            | Every state in spec FR-061, including `busy`; banned-word guard over `recipes.flowSteps.*`.                                                                                                                                     |
| Playwright / Maestro        | US1 attach + cook; US2 stale + update; US3 replace + restore; US4 budget/out-of-uses/offline.                                                                                                                                   |

## Watch list

- **Fact extraction recall.** A fact the extractor misses is neither sent nor checked. Mitigation: SC-001 human audit;
  the extractor is measured on the evaluation set before any model is chosen.
- **Quality from facts only.** May read flat. Measured in the bake-off; SC-007 is a hypothesis.
- **Shared pool.** First cook-funded consumer of the ADR-0024 pool, which the go-live plan (§6) says must split
  before Pro with AI is sold. Not shippable to paying cooks until that split lands.
- **Open rulings.** 020 Q-4 (label), 020-FR-078 (spend). See spec "Conflicts".

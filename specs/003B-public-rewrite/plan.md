# Implementation Plan: Public Versions of Imported Recipes

**Branch**: single-branch directive | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/003B-public-rewrite/spec.md`. Each clarification there is ruled where marked, and the rest are assumed and wait for the owner.

**Status**: BLUEPRINT done 2026-11-17. `staff-architect` PLANNING ran on 2026-11-15 (opus). Its pattern register and its
findings are folded in below and into the spec (FR-015, FR-016, FR-045, FR-065, and the FR-050 title rule). The decisions
are to be recorded in the paste and link import ADR, owed (T004), and the feature ADR, owed (T004). The build order is in `tasks.md`, with one slice tag per task.
`staff-ux-engineer` SPECIFY is done (`docs/design/publicVersion/spec.md` and `detailSpec.md`). EVALUATE is owed before launch (T117).

## Summary

At the end of an import, recipe-service classifies the source with one pure Specification: open, third-party or paid.
An aggregator follows the third-party rules. A third-party item offers Private, Public or Both. A paid item gets the same offer under the paid-site rules
(spec FR-017), and stays private only where they hold it back. Public and Both create one public-version job.
A recipe-workers Lambda runs 027's step-writing engine on a facts snapshot and the source step text, under its own ADR-0024 call site, and
stores the result on the job. The cook reviews it. "Publish" is one Command. In one transaction it re-runs the fact check and the wording
check on the server. It then writes the public recipe through the hold.
There are no caps (owner ruling 2026-11-15). Every later save of a public version runs the wording check inside the recipe
write, against a hashed fingerprint of the source taken at import. The source text itself is never kept for this check. The job keeps the source step text in `source_steps` only until it ends, so a retry sends the writer the same text.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node 24.
**Primary Dependencies**: NestJS 11 (recipe-service), Drizzle ORM, zod + `nestjs-zod`. AWS SDK v3 Bedrock Runtime
`Converse` through `gatedConverse` (recipe-workers), and SQS. TanStack Query, Tamagui (mobile), Next.js 16 (web).
**Storage**: recipe PostgreSQL 18. Two new tables, new columns on `recipes` and on the import item, widened CHECKs (the source type and the item choice).
Expand-only (ADR-0035), with the house two-step CHECK migration pair.
**Testing**: vitest unit and integration (database mocked, DD12), LOCAL e2e for the migration and the publish
transaction, worker tests, Playwright, Maestro, and k6 by hand.
**Target Platform**: web, iOS and Android. recipe-service on Fargate. The worker on Lambda (VPC, NAT consumer).
**Project Type**: monorepo feature across shared core, one service, one worker and two apps.
**Performance Goals**: 95% of jobs ready within 30 s (SC-004).
**Constraints**: writer input is the facts sheet plus the source step text, with no address, statement or source title (ruled 2026-11-17). No Anthropic model. The writer never fetches. A link import fetches on the device first, the server second (ADR-0093). Fail closed on spend and on the open test. An
unreadable paid, opt-out or signature signal is `unknown` and takes the rewrite path. Job timeout 10 min.
**Scale/Scope**: bounded by the spend ceiling, one public version per source page, and 3 attempts per holder (the import item, then the saved recipe). A paste spends its import unit only at save (FR-016a, C-24).

## Constitution Check

| Principle                  | Status | Note                                                                                                                                          |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| I Correctness / types      | PASS   | Classification and job state are discriminated unions. Wire types in-service zod (DD15).                                                      |
| II JSDoc                   | PASS   | `@pattern` on the Specification, the Command, the statechart module and the adapter.                                                          |
| III Imports / organisation | PASS   | No barrels. Subpath exports for the engine modules, as `parsing/parse-prompt` already does.                                                   |
| IV Testing pyramid         | PASS   | Tier matrix below. The fact check, the fingerprint and the classifier each get a mutation suite.                                              |
| V Monorepo                 | PASS   | No new package: the promoter, the job-expiry function and the capacity function live in recipe-core, which recipe-workers already depends on. |
| VII Accessibility / UX     | PASS   | Every state keyed (spec table). `staff-ux-engineer` SPECIFY done, EVALUATE owed (T117). One radio group, never disabled.                      |
| VIII Cross-platform        | PASS   | Web and mobile in one release (FR-091).                                                                                                       |
| IX Patterns / seams        | PASS   | Register below.                                                                                                                               |
| ADR-0024 layer 4b          | PASS   | Runs under the one verification role. New `SPEND_CALL_SITES` member `import-public-rewrite`.                                                  |
| ADR-0004 NAT list          | AMEND  | The new VPC Lambda adds a `nat-consumers` row (`natEgressConsumers.test.ts`).                                                                 |
| ADR-0093                   | PASS   | Amended ADR-0082 §5 and §6 already. This feature builds what it rules.                                                                        |

## Engine ownership (decision)

**027 owns the engine's design. 003B depends on it and builds none of it twice.**

| Part                                                                                                                                                                        | Owner | Built by                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------- |
| `recipe-core/src/stepWriting/*`: facts sheet, prompt, answer parser, fact check, shingle measure, `rewriteSteps`                                                            | 027   | 003B, first (027 build step 1)                |
| `recipe-workers/src/stepWriting/gatedStepWriter.ts` (the adapter half of 027 step 4)                                                                                        | 027   | 003B, first                                   |
| The bake-off, the pinned model id, the measured thresholds (027 step 5)                                                                                                     | 027   | 003B, first. 003B cannot launch without them. |
| Import classification, the choice, the public-version job, the worker handler, the review, Publish, the every-save wording guard, the rate alarm, the title builder, all UI | 003B  | 003B                                          |
| 027's own tables, cache, use ledger and Cooking Mode switch                                                                                                                 | 027   | 027 only. 003B never takes them.              |

003B builds the engine first. 027's build step 0 needs 005's use ledger, which is unbuilt. 003B charges operating
cost and needs no ledger.

**Edits made to 027 in the same PR:**

1. `027-FR-045` and its plan: spec 003B builds the engine first (`027-FR-045`).
2. `wordShingles.ts`: the measure takes shingle SETS, not text. `fingerprint(text, size, hash) → { formatVersion, hashes }`
   uses an injected, keyed, versioned hash, with `jaccard(a, b)` and `containment(part, whole)`. 027's in-memory check, 003B's stored
   check and 020's copy check run through one function. The per-sentence check is containment, not Jaccard. The text
   fold in front of the shingles is defined in 027 research R3.
3. `027-FR-032`: no gate. A 027 replace never changes the rights label, and an imported recipe goes public only through 003B-FR-015's two doors. Otherwise "private copy, replace, set public" is a back door.
4. `027-FR-044`: the banned-word list is one module both guards import (003B FR-064).
5. `027-FR-043`: no credit key of its own for a public version of an imported recipe. 027 uses 003B's.
6. 027's "Not stored: the facts sheet" stays true for 027. 003B stores a facts snapshot and the source step text (`source_steps`) on its job until the flow
   ends (FR-033, FR-042). This is a deliberate difference, recorded here and in 027's data model.

**The title is not in the engine.** 027 never changes a title, so a title field only 003B reads is a mode flag.
003B builds the title in code from the facts sheet (C-8). If the bake-off shows those titles read badly, 003B adds its
own second pinned prompt behind the same adapter, under its own call site.

## Pattern register

**Prescribed (staff-architect PLANNING, 2026-11-15):**

- **Specification**: `classifySource(input) → open | thirdParty | paid`, pure, an allowlist, fail closed.
  A second pure Specification, `paidPublicEligibility`, reads stated opt-outs and clearly read signature status. It also reads the
  publication date, or the first-import date for an undated page, against `PAID_CONTENT_HOLD_MONTHS` (6). It returns
  `allowed` or one reason.
  It lives in `recipe-service/src/import/domain/sourceClassification.ts`, beside the import's visibility rule. It runs
  on the server only. The client renders the result and never computes it.
- **Statechart as a derived state union + exhaustive switch (Visitor) + Command outcomes**, the house shape of
  `details/detailsDialogMachine.ts`. No xstate. The server job state is an input to it, never a copy.
- **Strategy at the consumer edge**: the engine is composed with call site `import-public-rewrite`, operating cost and
  the job row as its sink. No mode flag enters the engine.
- **Command**: Publish is one service method through `RecipesService.create`. The client side is a TanStack mutation.
- **No cap Specification**: there are no caps (owner ruling 2026-11-15). The rate alarm counts public versions per
  source from the source records.
- **Guard in the write transaction**: the wording check runs inside the `RecipesService` write for any recipe that is
  a public version. It covers `update` and version restore (ADR-0058), not just one controller.
- **Adapter on a Template Method**: 027's `createGatedStepWriter` over `gatedConverse`, with the final `budgetSpent`
  override 004-FR-059 already uses.

**Preserved (do not refactor away):**

- `evaluateVisibility` and `provenancePolicy`. The classification is an input to them, not a replacement.
- The ADR-0074 hold. A public version NOT APPROVED becomes private and takes a slot, over the limit where need be (ADR-0073).
- The ADR-0073 per-user lock and live count, and the lock order of every paste and job transaction: the import header, the item, the allowance, the DD33 lock, the private recipe, then the job (FR-016a). The bulk save takes the same order through `ImportedCreate.beforeLocks` (T314), so there is no deadlock to retry.
- The rest-public promoter (FR-087): a marker on the item (a transactional outbox row, not a job) and one global `promote()` in recipe-core, a work-queue dispatcher that loops one-insert transactions under one fan-out advisory lock and creates jobs while the pending-or-writing count across all cooks is below the configured seat count. It matches and binds nothing, and no job waits behind the seat limit. The marker rule is stated once, in the data model.
- `gatedConverse`, unrefactored.

**Intent already satisfied (add nothing):** TanStack mutation as Command. The outcome union as Visitor. The unique
`recipes.source_page_key` as the idempotency key (no `Idempotency-Key` header).

## Cost path under DD21

- **Pool.** The one ADR-0024 pool ($100 a month, prod only, first come first served). Attribution by `CallSite`, never
  a sub-budget (§4c).
- **Charge.** Operating cost (ADR-0024 §6 item 1). Never a cook's use (010-FR-041d, 005-FR-015a).
- **Per call.** ADR-0024 §6 estimates a recipe-sized call at about 1,750 tokens in and 900 out: about $0.003 on Nova 2
  Lite. The facts sheet is smaller than a full recipe, so this is an upper estimate. The bake-off measures it.
- **Per holder.** At most 3 writer attempts, counted by the holder (the import item, then the saved recipe) across its jobs (one automatic retry, one by hand, C-7): at most about $0.009 for the attempts, and each re-claim adds one writer call beyond the 3 attempts.
- **Per cook.** Not bounded by the import allowance (a paste spends its unit only at save, FR-016a). Bounded by one
  public version per source page and 3 attempts per holder. There is no separate cap (owner ruling 2026-11-15), so the
  pool's ceiling is the real bound. There is no per-cook read cap and no new ledger channel (owner ruling 2026-11-19). The AI-use metric of FR-086 (calls and cost per import or job, with `Stage` and the outcome) watches the one known loop, read-then-cancel, which is free and could drain the shared pool. That risk is accepted.
- **Denial.** Final `budgetSpent`, refund in full, ack the message, never redeliver (FR-082). The screen reads the
  counter as a hint only. The reservation is the gate.
- **ADR-0024 §3** gains a third no-retry path, in the feature ADR. §6's split of operating AI from paid credits is
  still owed before Pro with AI goes on sale, and this call site sits on the operating side.
- **Non-prod.** Ungated, as every other call site, so non-prod spend is watched, not capped (DD21).

## Project Structure

### Documentation (this feature)

```text
specs/003B-public-rewrite/
├── spec.md
├── plan.md            # this file
├── research.md
├── data-model.md
├── quickstart.md
├── agentNotes.md
├── contracts/publicVersion.api.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/shared/recipe-core/src/stepWriting/                  # 027's engine (built once, by 003B first: 027-FR-045)
packages/shared/recipe-core/src/copy/bannedWords.ts            # the one banned-word list (FR-064)
packages/shared/recipe-core/src/stage/stageClass.ts  # subpath ./stage: stageClassOf, moved from recipe-workers/infra/lib/consumerConcurrency.ts (T343)
packages/shared/recipe-core/src/publicVersion/{promoter,jobExpiry,writerCapacity}.ts  # subpaths ./public-version/{promoter,job-expiry,writer-capacity}: the global promoter, the shared job-expiry function, publicVersionCapacity(stage) (T335, T343, T354)
packages/services/recipe-service/src/import/domain/sourceClassification.ts
packages/services/recipe-service/src/import/publicVersion/     # controller, schema, service, DAL, title builder
packages/services/recipe-service/src/recipes/domain/publicVersionWordingGuard.ts
packages/services/recipe-service/src/recipes/domain/publishAgeAllowed.ts   # pure predicate (FR-016)
packages/services/identity/                                    # age_assurances migration, POST /api/v1/me/age-assurance (slice P3b)
packages/services/recipe-service/src/database/migrations/00NN_public_versions.sql (+ _validate)
packages/services/recipe-workers/src/handlers/publicVersionWorker.ts
packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts  # Lambda, queue, DLQ, reserved concurrency (from publicVersionCapacity), PUBLIC_VERSION_FANOUT_SEATS, PublicVersionJobSweepBehindAlarm
packages/services/recipe-workers/src/handlers/bandDrain.ts    # the job sweep runs on its 15-minute tick (no new Lambda)
packages/schemas/recipe                                        # generated copy (contract:generate)
packages/clients/recipe-service                                # hooks for the job, publish, cancel, keepPrivate
packages/apps/commise/features/recipes/src/import/choice/      # statechart (importChoiceMachine), hook (useImportChoice), render (web + .native)
```

**Structure Decision**: no new package and no new deployable. One new Lambda inside the existing worker stack.

## Build order

0. Prerequisites. The evidence record of ADR-0089 §6 is built. The feature ADR is written (label, licence,
   provenance pair, fingerprint format, ADR-0024 §3). `staff-ux-engineer` SPECIFY.
1. 027 engine core and fingerprint API, test-first with mutation suites.
2. Migration and LOCAL e2e: tables, columns, CHECK pairs, unique `source_page_key`, cascade and erasure.
3. recipe-service: classifier, job API, Publish Command, wording guard, title builder, zod contract,
   `contract:generate`.
4. recipe-workers: handler, adapter wiring, infra (Lambda, queue, DLQ, reserved concurrency, NAT row, call site).
5. Bake-off (027 step 5): pin the model and set the step threshold from the evaluation set (027 owns both). This feature sets the title check's own measure from the same set.
6. Clients and UI, web and mobile together, after SPECIFY.
7. Amendments owed through the ADR (spec "Amendments"). The per-market switch is on in every market at launch (ADR-0093 §6a).

## Testing (tiers owed, test-first)

| Tier                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (core)          | Fingerprint: same set from same text, format version pinned, keyed hash. Containment vs Jaccard. Mutants: one shingle changed, order changed. The promoter and writer capacity (T335, T360).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Unit (service)       | Classifier: every allowlist case, every unknown open-test input reads third-party, an unread paid, opt-out or signature signal reads `unknown` and offers the choice, CC BY-NC is not open, `.gov` alone is not open. Title builder never returns the source title. The rest-public write decision for an "I wrote this" item and the statement switch (T355).                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Integration (mocked) | Choice to job. Double publish returns one recipe. No age claim: the start is not gated, Publish answers `403 ageConfirmNeeded`. Paid hold counted from the first import for an undated page. Wording guard on update and restore. Both digest drift. File items (US7): the discard-item route, the bulk private save, the rest-public route and the promoter, the grouped read, and the Start write of `choice = 'public'` on a file item (T324, T325, T326, T328, T330, T336, T337, T338, T347, T356, T362, T366).                                                                                                                                                                                                                                                              |
| Worker               | `budgetSpent` final and acked. Unreadable counter retried. Late result after `cancelled` dropped. 10-minute expiry, where every expiry from `pending` counts one attempt on the holder (the item for path `public`, the recipe for `both` and `later`). At most 3 attempts. Writer calls are the attempts plus the re-claims, counted in `public_writer_calls`. Job sweep on the band drain tick (T207).                                                                                                                                                                                                                                                                                                                                                                         |
| LOCAL e2e            | Migration applied. CHECK pairs. Unique `source_page_key`. Page key released on delete, rejection and opt-out. Erasure covers the job table and identity's `age_assurances` row. Age route round trip and k6 by hand (P3b). Job sweep against a real database (T208). keepPrivate and Publish against a real database (T317). File items (US7): a re-sent chunk after a discard, the bulk save racing a paste keepPrivate with no `40P01`, a 1,000-row rest-public batch and a ceiling hit partway (T329, T331, T339, T340). Promoter races and fan-out fairness (T357, T359, and the e2e half of T360). The statement switch to "I wrote this" (T363). The write-only clock (T365) and the purge floor (T369). The grouped read `publicVersions` against a real database (T361). |
| Infra (CDK synth)    | Writer reserved concurrency and `PUBLIC_VERSION_FANOUT_SEATS` equal `publicVersionCapacity(stage)` in both stacks, for prod and a non-prod stage (T354).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Service e2e + k6     | Job and publish round trip on a deployed preview. k6 on job status reads, by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Component (both)     | Every state in the spec table. Banned-word guard over `importMessages.choice.*` and `recipes.flowSteps.*`. The grouped file row, the no-slot and file variants and `paste.storageFull` (T320, T333, T341, T345, T346, T348, T367).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Playwright / Maestro | US1 Public and Both. US2 Private, and paid held back (paid allowed is enabled once the page evidence carries the paid facts). US3 failure and later route, US4 dead end with switch on and off, US5 blocked save. Stop to discard, keepPrivate, `allowanceRefused` and the 3-attempt Final variants (T318). US7: the per-recipe choice, Make the rest public, the grouped row and discarding one recipe (T342).                                                                                                                                                                                                                                                                                                                                                                  |

## Watch list

- **Writer input.** The writer reads the facts sheet and the source step text in the source language, and never the address, the statement or the source title (027-FR-035, ruled 2026-11-17). The fingerprint check (027-FR-042) guards against copying. The bake-off measures both.
- **Fact extraction recall.** A fact the extractor misses is neither sent nor checked. SC-001's human audit is the
  backstop.
- **Key custody.** The fingerprint key is a secret in AWS Secrets Manager under this feature, with rotation that keeps old versions readable (FR-050a). A missing key version is an operator fault: a later save answers `503 checkUnavailable` with an alarm, and Publish answers the same `503` and leaves the job `ready`.
- **Fingerprint permanence.** With no text kept, a fingerprint can never be recomputed. The format version and the key
  version are stored, and a format change keeps the old reader.
- **Shared pool.** The first operating-cost consumer that a cook's choice triggers. It competes with parse and match
  until ADR-0024 §6's split lands.
- **Unmerged dependencies.** The evidence record of ADR-0089 §6 is not built. The source record shape can still move.
- **Open owner rulings.** The spec Clarifications, and the conflicts list in the spec.

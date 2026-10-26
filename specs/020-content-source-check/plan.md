# Implementation Plan: Content Source Check

**Branch**: `docs/im-spec020` (single-branch directive. Spec Kit ran with `SPECIFY_FEATURE=020-content-source-check`.) |
**Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/020-content-source-check/spec.md`

## Summary

Before a recipe becomes publicly visible, an automated source check looks for evidence that it came from a book, a
paid site or another published source. Rule-based detectors (ISBN with checksum, listed publishers and paid sites,
copyright notices, page references, paid-site templates, cited paid-site hosts) run in recipe-service at write time.
A Bedrock model also reads the checked text alone and points at more evidence. It runs asynchronously in
recipe-workers, as a sixth call site under the existing verification role. Code verifies every quote it returns. A fixed code table decides
which evidence blocks.

When the check finds verified blocking evidence, the recipe stays saved but is hidden from everyone except its owner.
The hold lives in the one read rule for who can see a recipe. So no save ever fails, and no write path can go around
it.
The cook can keep the recipe private, change their statement, or appeal to a person in 016's reviewer queue. When the
check cannot tell, or the AI budget is spent, the cook confirms their statement. Blocking starts in shadow mode and is
switched on only after a labeled-set evaluation passes.

**Working assumptions** (the spec's open questions, until the owner answers):

- **WA-1 (Q1 = A for this release)**: text only, including text produced by OCR. Uploaded images follow once 011's
  OCR engine exists (research R-07). The recommendation changed from B to A at PLANNING, for the reasons in R-07.
- **WA-2 (Q2 = A)**: a `possible` outcome asks the cook to confirm, then publishes. Counsel's red-flag answer (spec
  FR-041) can reverse it.

## Technical Context

**Language/Version**: TypeScript (strict), Node 24.x toolchain.
**Primary Dependencies**:

- recipe-service (NestJS 11, Drizzle) for the write path, the read rule, the cook API, appeals and the list.
- recipe-workers (Lambda, `pg`) for the model call, through `gatedLlm.ts` and ADR-0024's reserve-then-settle.
- recipe-core for the pure parts: the digest, the detectors, the evidence table, the outcome function, `allows`.
- New library: `isbn3` (MIT) for ISBN parsing and checksums. `tldts` (already in the tree) for registrable domains.
- Amazon Bedrock, an in-region model (Nova Micro under WA-1), no new grantee.

**Storage**: RDS PostgreSQL 18, the existing recipe database. Seven new tables and one new column
([data-model.md](data-model.md)). No new datastore.
**Testing**: vitest unit and integration (mocked database), LOCAL e2e against a real Postgres on a developer's machine
for the read rule and the migration, Playwright for web, Maestro for mobile, k6 for the read path (manual dispatch
only). The tier for each scenario is in [quickstart.md](quickstart.md).
**Target Platform**: recipe-service on ECS Fargate, recipe-workers on Lambda (VPC-attached), web (Next.js 16) and
mobile (Expo 57).
**Project Type**: backend services plus web and mobile surfaces, plus a web-only reviewer queue in 016's dashboard.
**Performance Goals**: 95% of checks reach an outcome within 60 seconds of a publish, and none stays "checking" past
24 hours (SC-005). Public read and search latency does not regress measurably with the extra `EXISTS` (k6).
**Constraints**:

- One Bedrock grantee (ADR-0024 layer 4b), and one $100 prod pool, attributed by call site.
- The model sees the checked text only.
- No fetch of any link.
- No recipe text in a queue message or a shared evidence row.
- Every cook-facing string localised, and web and mobile in lockstep.
  **Scale/Scope**: one check per distinct checked text headed public. Volume is bounded by publications, not imports.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #    | Principle                         | Status | Notes                                                                                                                                                                  |
| ---- | --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | Correctness and Type Safety       | Pass   | Outcome, reason, evidence kind, field and detector are closed unions backed by CHECKs. `CheckedText` is branded. ISO dates                                             |
| II   | Readability and JSDoc             | Pass   | Each pure module carries JSDoc and `@pattern` tags from the register below                                                                                             |
| III  | Code Organization and Imports     | Pass   | Domain folders: `recipe-core/src/sourceCheck/`, `recipe-service/src/recipes/sourceCheck/`, `recipe-workers/src/sourceCheck/`                                           |
| IV   | Testing Discipline                | Pass   | Unit and integration for every non-UI unit, LOCAL e2e for the read rule and migration, component tests for every state, Playwright and Maestro per story, k6 for reads |
| V    | Monorepo and Workspace Governance | Pass   | No new workspace. One new dependency (`isbn3`) in recipe-core                                                                                                          |
| VI   | Formatting and Tooling            | Pass   | Shared configs, unchanged                                                                                                                                              |
| VII  | Accessibility and UX Consistency  | Pass   | Every state goes through `staff-ux-engineer` SPECIFY before it is built, with accessible names, tokens and no colour-only state                                        |
| VIII | Cross-Platform Parity             | Pass   | Cook surfaces ship on web and mobile together. The reviewer queue is operator tooling, web only, as 016 records                                                        |

Re-checked after Phase 1: unchanged. The design adds no workspace and no second grantee, and keeps every cook surface
on both platforms.

## Pattern register

From the staff-architect's PLANNING pass (2026-10-26), with the corrections it made to the first draft of the spec.

### Prescribed

| Unit                                  | Pattern                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule-based detectors                  | **Specification**: pure predicates in recipe-core, run synchronously at write time, so a rule-only `detected` and the spent-budget path need no async step                |
| Shared evidence rows                  | **Cache-Aside**, keyed by digest, rule set and model, following `ingredient_parse_cache`                                                                                  |
| `sourceCheckReadingOf`                | **One classifier, several mappings** (preserved from ADR-0071 and ADR-0072): it feeds the read rule, `importSourceFlagOf`, the owner's badge and the statement of reasons |
| Evidence-kind table and outcome table | **Visitor**: an exhaustive switch over closed unions of evidence kind and label. Code owns it, never the model                                                            |
| The hold                              | **Specification composed into the read rule**: a required field on `ViewableRecipeFields` and the same condition in the three SQL twins. Not a write-side policy          |
| `buildSourceCheckPrompt`              | **Information hiding enforced by the type**: `Exact<Parameters<…>, [CheckedText]>` with a branded `CheckedText`, ADR-0026's rule                                          |
| The check request                     | **Command over a queue**, with a claim before reserve (ADR-0024 layer 0a) and a DLQ that ends in a terminal outcome                                                       |
| The blocking switch                   | **Append-only event ledger**: the latest row is the mode, and every change says who, when and why                                                                         |
| `recipe_source_checks.state`          | **State machine**: `checking → decided`, with confirmation and overturn as guarded inputs to `allows`                                                                     |
| `allowsPublication`                   | **Policy** as a pure function, the only author of `allows`                                                                                                                |

### Preserved, on purpose

- **Reserve-then-settle**, unchanged: settle is never retried, and an unreadable counter fails closed.
- **Test-principal containment** stays in front of the C-004 matrix in `visibilityPolicy.ts`. The source check does
  not join it there.
- **C-004** (`evaluateVisibility`) keeps deciding which visibility a label may hold.
- **The import view's `version` digest** (ADR-0072 §2) absorbs source flags with no new mechanism.

### Intent already satisfied, so no new machinery

- A verdict landing by key and visibility following from it is the existing `verifyLine` shape. Nobody flips
  visibility when a verdict lands.
- The statement of reasons is derived from a decision row, as 016 derives its own.
- Stopping an import is "stop calling `advance`" (ADR-0072 §2). No stop route.

## Architecture

### Flow

```text
cook saves (public intent) ──▶ recipe-service
                                 ├─ computes checked_text_digest (recipe-core, one function)
                                 ├─ runs the rule-based detectors (sync, no model)
                                 ├─ upserts recipe_source_checks (checking, or decided if a rule blocks)
                                 └─ sends SourceCheckRequested {recipeId, digest, ruleSetVersion}  (no text)
                                                     │
                                         recipe-workers: source-check Lambda
                                           ├─ claim (layer 0a)
                                           ├─ reads text, re-derives digest (stale → stop, no spend)
                                           ├─ reserve → model call (text only) → settle
                                           ├─ verifies quotes, writes evidence set + items
                                           └─ writes outcome + allows (compare-and-set on digest)

any read ──▶ viewable = owner OR (public AND published AND (shadow OR allows for current digest))
```

### Where the hold lives

A per-recipe check row read at query time (research R-02). The worker never writes `recipes`. An edit changes the
digest in the same transaction, so a public recipe leaves view at once. Clearance points at the outcome produced, so a
model or rule change never hides the corpus. Flip to a fence column only if k6 shows the `EXISTS` over budget.

### Grantee placement

Sixth entry in `SPEND_CALL_SITES` (`source-check`), its own Lambda, queue, DLQ and reserved concurrency, under the
existing verification role (research R-01). Three guards move with it:

- `llmSpendGuards.test.ts` finds every function on the grantee role, not one named function.
- ADR-0004's NAT consumer table gains the function, and `natEgressConsumers.test.ts` asserts it.
- ADR-0024 §4c's amendment is corrected from four call sites to six.

### Boundaries

| With                            | Decision                                                                                                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 004                             | `004-FR-014a` amended (spec FR-040). 020 builds the rightsholder list first, as the one table 004's D-004 blocklist also uses                                                                                                                   |
| 016                             | Decision, confirmation and appeal rows live in the recipe database (research R-13). 016's statement **delivery** is generalised to take a 020 decision. Its `notice_decisions` table is not. Out of Scope and Assumptions amended (spec FR-041) |
| ADR-0072                        | Readiness gains the source flag for items headed public (spec FR-043). The import still never publishes                                                                                                                                         |
| The free-tier private slots ADR | Read only. `keepPrivate` is offered only with a slot free. A held recipe follows the slots ADR's answer for owner-only drafts (research R-15)                                                                                                   |
| ADR-0024                        | New call site, same pool, same grantee, layer-2 guard widened                                                                                                                                                                                   |
| ADR-0004                        | One new NAT consumer row                                                                                                                                                                                                                        |

### A new ADR is owed

The hold-in-the-read-rule decision, the per-recipe outcome over shared evidence, and the sixth call site are each
hard to reverse. They are recorded in a new ADR before the first build slice, numbered when written (another branch is
writing the slots ADR now).

## Delivery slices

Each slice is test-first in every tier it touches (CLAUDE.md, "TEST-FIRST IS LAW").

| Slice | Delivers                                                                                                                                   | Depends on                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| S0    | The ADR; `staff-ux-engineer` SPECIFY for the checking, held, confirm and appeal states on web and mobile                                   | none                                 |
| S1    | recipe-core: digest, detectors, evidence table, outcome function, `allowsPublication`. Pure, unit-tested                                   | S0                                   |
| S2    | Migration and tables; rightsholder list with admin routes; `checked_text_digest` on every write                                            | S1                                   |
| S3    | Shadow mode end to end: rule detectors at write time, worker call site, evidence and outcomes recorded, nothing hidden, metrics and alerts | S2; owner's call on the model (R-05) |
| S4    | Evaluation harness over the labeled set (outside the repo); bake-off picks the model                                                       | S3; counsel on the labeled set       |
| S5    | Read rule and cook surfaces: required field, SQL twins, `sourceCheck` on the response, confirm, web and mobile states                      | S3                                   |
| S6    | Bulk import integration: source flag, readiness, choices                                                                                   | S5; the slots ADR                    |
| S7    | Appeals, decisions and statements through 016; the blocking switch                                                                         | S5; 016's delivery and queue         |
| S8    | Switch blocking on                                                                                                                         | S4 passes SC-001/SC-002; S7          |

## Open questions for the owner

1. **Q1, images** (spec FR-006). Recommended A for this release, B once OCR exists.
2. **Q2, the `possible` band** (spec FR-016). Recommended A, pending counsel on red-flag knowledge.
3. **Held recipes and private slots** (research R-15): a question for the slots ADR, raised here because a held recipe
   behaves like an owner-only draft.

## Residual risks

- **Unmarked copies pass.** A cookbook recipe typed out without its ISBN, publisher or page numbers usually reads
  `clear`. SC-003 reports this, and no claim may hide it.
- **The model adds little to `detected`.** Every blocking kind is a list or pattern match code can do. The model's
  value is mostly `possible`, so when the pool runs dry most checks become a confirmation click.
- **One pool, shared.** A large import can use the month's pool, and every check after that is `unchecked`.
- **Non-prod is ungated.** The stated non-prod bound was measured wrong (pr-91), and this adds a consumer. Reserved
  concurrency of 1 in non-prod is the bound.
- **Red-flag knowledge.** If counsel says a `possible` signal followed by publication is awareness, WA-2 weakens safe
  harbour and Q2 must move to B.
- **016 is unbuilt.** Blocking cannot switch on until 016's statement delivery and queue exist. Until then the feature
  runs in shadow mode.
- **Reviewer access to someone else's held recipe** is a new authorization shape. It needs a security review
  (`sec-aud-1`) before S7.
- **Fields the check does not read.** Tags are checked text. A copy hidden in a field the check does not read can
  still pass. The checked-text list is versioned with the digest, so adding a field is a deliberate change.

## Project Structure

### Documentation (this feature)

```text
specs/020-content-source-check/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── cookApi.md
│   ├── reviewerAndOperatorApi.md
│   ├── importChanges.md
│   └── workerAndModel.md
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
packages/shared/recipe-core/src/sourceCheck/
├── checkedTextDigest.ts        # the one digest function (versioned)
├── detectors.ts                # rule-based detectors (Specification)
├── evidenceTable.ts            # blocking table (Visitor)
├── sourceCheckReading.ts       # outcome function, one classifier
├── allowsPublication.ts        # Policy
└── __tests__/

packages/services/recipe-service/src/recipes/sourceCheck/
├── sourceCheck.schema.ts       # zod, copied to packages/schemas/recipe
├── sourceCheck.controller.ts   # confirm, appeal
├── sourceCheck.service.ts
├── sourceCheck.dal.ts
├── appeals/                    # reviewer routes, decisions
├── markers/                    # rightsholder list
└── enforcement/                # blocking switch ledger
packages/services/recipe-service/src/recipes/domain/recipeVisibility.ts   # gains the required field
packages/services/recipe-service/src/database/schema/sourceCheck.ts
packages/services/recipe-service/src/database/migrations/NNNN_source_check.sql

packages/services/recipe-workers/src/sourceCheck/
├── handler.ts                  # claim, read, reserve, call, settle, write
├── sourceCheckPrompt.ts        # buildSourceCheckPrompt(CheckedText)
├── dlqHandler.ts               # terminal unchecked(checkFailed)
└── sweeper.ts                  # 24-hour limit; schedule disabled outside prod

packages/apps/commise/web, packages/apps/commise/mobile   # the cook's states, per staff-ux-engineer SPECIFY
packages/apps/commise/web                                 # reviewer queue inside 016's dashboard
```

**Structure Decision**: no new workspace. The pure logic sits in recipe-core because both recipe-service and
recipe-workers need the same digest and outcome function, and two copies would drift.

## Complexity Tracking

No constitution violation needs justifying. One deliberate addition is recorded so nobody "simplifies" it away:

| Addition                                             | Why needed                                                                                         | Simpler alternative rejected because                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Per-recipe outcome over shared evidence (two levels) | The outcome depends on the label and citation, while the model's evidence depends only on the text | One per-digest outcome gives a wrong answer to a second cook whose label differs |

# Implementation Plan: Content Source Check

**Branch**: `docs/im-spec020` (single-branch directive. Spec Kit ran with `SPECIFY_FEATURE=020-content-source-check`.) |
**Date**: 2026-10-26, revised the same day for the owner's Q1 and Q2 rulings | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/020-content-source-check/spec.md`

## Summary

Before a recipe becomes publicly visible, an automated source check reads its text and its uploaded photos, and looks
for evidence that it came from a book, a paid site or another published source.

- **Rule-based detectors** run in recipe-service at write time: ISBN with checksum, listed publishers and paid sites,
  copyright notices, page references, paid-site templates, cited paid-site hosts. Evidence they prove in the text holds
  the recipe back on its own (`detected`).
- **A Bedrock model** reads the text and each photo, alone, asynchronously in recipe-workers, as a sixth call site under
  the existing verification role. A text quote counts only if code finds it in the text. A photo signal can never be
  proven by code, so it only ever sends the recipe to a person.
- **Owner rulings, 2026-10-26.** Q1: "We should check everything we can. If the AI can't figure out if it's valid or a
  violation, then we need to raise it to a human to check." Q2: "A person decides." So every `possible` and
  `unchecked` outcome is held until a reviewer clears or holds it. Nothing automatic, and nothing the cook does,
  publishes an unsure recipe.

The hold lives in the one read rule for who can see a recipe. So no save ever fails, and no write path can go around
it. Blocking starts in shadow mode, which also forecasts how many recipes people will have to decide. It is switched
on only when the labeled-set evaluation passes and named reviewers' hours cover that forecast.

## Technical Context

**Language/Version**: TypeScript (strict), Node 24.x toolchain.
**Primary Dependencies**:

- recipe-service (NestJS 11, Drizzle) for the write path, the read rule, the cook API, referrals, the list and the
  forecast.
- recipe-workers (Lambda, `pg`) for the model calls, through `gatedLlm.ts` and ADR-0024's reserve-then-settle.
- recipe-core for the pure parts: the digest, the detectors, the evidence table, the outcome function, `allows`.
- New library: `isbn3` (MIT) for ISBN parsing and checksums. `tldts` (already in the tree) for registrable domains.
- `sharp`, already in recipe-service for thumbnails, makes each photo's bounded **check rendition** at upload confirm.
  The worker reads that rendition. It needs no image library, so no native binary enters a Lambda bundle.
- Amazon Bedrock: Nova Lite v1, in region, takes images (research R-05). No new grantee.

**Storage**: RDS PostgreSQL 18, the existing recipe database. Seven new tables and two new columns
([data-model.md](data-model.md)). The photo bucket is read, never written. No new datastore.
**Testing**: vitest unit and integration (mocked database), LOCAL e2e against a real Postgres and LocalStack S3 on a
developer's machine for the read rule, the migration and photo reads, Playwright for web, Maestro for mobile, k6 for the
read path (manual dispatch only). The tier for each scenario is in [quickstart.md](quickstart.md).
**Target Platform**: recipe-service on ECS Fargate, recipe-workers on Lambda (VPC-attached), web (Next.js 16) and
mobile (Expo 57).
**Project Type**: backend services plus web and mobile surfaces, plus a web-only reviewer queue in 016's dashboard.
**Performance Goals**: 95% of checks reach an outcome within 60 seconds of a publish, and none stays "checking" past
24 hours (SC-005). 95% of check referrals decided by a person within 72 hours and appeals within 7 days (SC-007).
Public read and search latency does not regress measurably with the extra `EXISTS` (k6).

**Constraints**:

- One Bedrock grantee (ADR-0024 layer 4b), and one $100 prod pool, attributed by call site.
- Every call reserved at its worst case. A photo is sent as its check rendition, made at a fixed maximum size, so it
  has a token ceiling.
- The model sees the checked content only.
- A photo signal never blocks and never clears.
- No fetch of any link, no reverse image search.
- No recipe text or photo in a queue message or a shared evidence row.
- Every cook-facing string localised, and web and mobile in lockstep.

**Scale/Scope**: one check per distinct checked content headed public. Model volume is bounded by publications, not
imports. Reviewer volume is bounded by publications that are unsure, which shadow mode measures.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #    | Principle                         | Status | Notes                                                                                                                                                                  |
| ---- | --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | Correctness and Type Safety       | Pass   | Outcome, reason, evidence kind, photo signal and referral state are closed unions backed by CHECKs. `CheckedText` and `CheckedPhoto` are branded. ISO dates            |
| II   | Readability and JSDoc             | Pass   | Each pure module carries JSDoc and `@pattern` tags from the register below                                                                                             |
| III  | Code Organization and Imports     | Pass   | Domain folders: `recipe-core/src/sourceCheck/`, `recipe-service/src/recipes/sourceCheck/`, `recipe-workers/src/sourceCheck/`                                           |
| IV   | Testing Discipline                | Pass   | Unit and integration for every non-UI unit, LOCAL e2e for the read rule and migration, component tests for every state, Playwright and Maestro per story, k6 for reads |
| V    | Monorepo and Workspace Governance | Pass   | No new workspace. One new dependency (`isbn3`) in recipe-core                                                                                                          |
| VI   | Formatting and Tooling            | Pass   | Shared configs, unchanged                                                                                                                                              |
| VII  | Accessibility and UX Consistency  | Pass   | Every state goes through `staff-ux-engineer` SPECIFY before it is built, with accessible names, tokens and no colour-only state                                        |
| VIII | Cross-Platform Parity             | Pass   | Cook surfaces ship on web and mobile together. The reviewer queue is operator tooling, web only, as 016 records                                                        |

Re-checked after Phase 1 and after the Q1/Q2 revision: unchanged. The design adds no workspace and no second grantee,
and keeps every cook surface on both platforms.

## Pattern register

From the staff-architect's PLANNING pass (2026-10-26), with the corrections it made to the first draft of the spec,
and the additions the owner's Q1/Q2 rulings required.

### Prescribed

| Unit                                  | Pattern                                                                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule-based detectors                  | **Specification**: pure predicates in recipe-core, run synchronously at write time, so a rule-only `detected` and the spent-budget path need no async step                              |
| Shared evidence rows                  | **Cache-Aside per part**: one set for the text and one per photo, each keyed by its own digest, rule set and model, following `ingredient_parse_cache`                                  |
| `sourceCheckReadingOf`                | **One classifier, several mappings** (preserved from ADR-0071 and ADR-0072): it feeds the read rule, `importSourceFlagOf`, the owner's badge, the referral and the statement of reasons |
| Evidence-kind table and outcome table | **Visitor**: an exhaustive switch over closed unions of evidence kind and label. Code owns it, never the model. Photo kinds have one weight only: "for a person"                        |
| The hold                              | **Specification composed into the read rule**: a required field on `ViewableRecipeFields` and the same condition in the three SQL twins. Not a write-side policy                        |
| The two prompt builders               | **Information hiding enforced by the type**: `Exact<Parameters<…>, [CheckedText]>` and `[CheckedPhoto]`, each branded, ADR-0026's rule                                                  |
| The check request                     | **Command over a queue**, with a claim before reserve (ADR-0024 layer 0a) and a DLQ that ends in a terminal outcome                                                                     |
| The photo call's reservation          | **Bounded resource**: resize to a fixed maximum, so the worst case is known before the call                                                                                             |
| `recipe_source_checks.state`          | **State machine**: `checking → decided`, with a reviewer's clearance, the curator grant and the next-period re-check as guarded inputs to `allows`                                      |
| The referral queue                    | **State machine plus work queue**: `shadow \| open → cleared \| held \| withdrawn \| superseded \| resolvedByCheck`, ordered by `due_at`, one open per recipe and digest                |
| `allowsPublication`                   | **Policy** as a pure function, the only author of `allows`. It takes no cook input                                                                                                      |
| The blocking switch and staffing      | **Append-only event ledger**: the latest row is the mode, and blocking must cite both an evaluation and a staffing record                                                               |

### Preserved, on purpose

- **Reserve-then-settle**, unchanged: settle is never retried, and an unreadable counter fails closed.
- **Test-principal containment** stays in front of the C-004 matrix in `visibilityPolicy.ts`. The source check does
  not join it there.
- **C-004** (`evaluateVisibility`, with ADR-0073's required slot fact) keeps deciding which visibility a label may
  hold.
- **The import view's `version` digest** (ADR-0072 §2) absorbs source flags with no new mechanism.

### Intent already satisfied, so no new machinery

- A verdict landing by key and visibility following from it is the existing `verifyLine` shape. Nobody flips
  visibility when a verdict lands.
- The statement of reasons is derived from a decision row, as 016 derives its own.
- Photo cache removal uses the existing `cdnInvalidation.ts`.
- Stopping an import is "stop calling `advance`" (ADR-0072 §2). No stop route.

## Architecture

### Flow

```text
cook saves (public intent) ──▶ recipe-service
                                 ├─ computes checked_content_digest (text + sorted photo hashes, one function)
                                 ├─ runs the rule-based detectors on the text (sync, no model)
                                 ├─ upserts recipe_source_checks (checking, or decided if a rule blocks)
                                 └─ sends SourceCheckRequested {recipeId, digest, ruleSetVersion}  (no content)
                                                     │
                                         recipe-workers: source-check Lambda
                                           ├─ claim (layer 0a)
                                           ├─ reads text and photos, re-derives digest (stale → stop, no spend)
                                           ├─ text: reserve → call → settle; quotes proven or dropped
                                           ├─ each photo: read its check rendition → reserve ceiling → call → settle
                                           ├─ writes evidence set + items
                                           └─ writes outcome + allows (compare-and-set on digest)
                                                     │
                            possible / unchecked on a published recipe ──▶ referral (due in 72 h) ──▶ a person
                                                                                       clear │ hold
                                                                                             ▼
                                                                           decision + statement of reasons

any read ──▶ viewable = owner OR (public AND published AND (shadow OR allows for current digest))
```

### Where the hold lives

A per-recipe check row read at query time (research R-02). The worker never writes `recipes`. An edit, a new photo or
a removed photo changes the digest in the same transaction, so a public recipe leaves view at once. Clearance points
at the outcome produced, so a model or rule change never hides the corpus. Flip to a fence column only if k6 shows the
`EXISTS` over budget.

### Grantee placement

Sixth entry in `SPEND_CALL_SITES` (`source-check`), its own Lambda, queue, DLQ and reserved concurrency, under the
existing verification role (research R-01). Four guards move with it:

- `llmSpendGuards.test.ts` finds every function on the grantee role, not one named function.
- ADR-0004's NAT consumer table gains the function, and `natEgressConsumers.test.ts` asserts it.
- ADR-0024 §4c's amendment is corrected from four call sites to six.
- The function's photo-bucket grant is read-only on the recipe-photo prefix, asserted by an infra test.

### Photos

Research R-07. Every uploaded photo on a recipe headed public is read, one model call each. The call reads the
photo's check rendition, made at upload confirm at a fixed maximum size, which gives the call a token ceiling. Signals
come from a closed set of five, with no free text. Every signal is unproven and sends the recipe to a person. No OCR
engine is added: under the ruling it would decide nothing. A recipe that was public and becomes held has its photo
paths removed from the CDN cache.

### People and load

Research R-10. Referrals are created only when a cook publishes, never for a draft. The forecast in shadow mode gives
referrals per day and reviewer time, including a month in which the AI budget runs out and every publish without rule
evidence goes to a person. Blocking needs named reviewers whose hours cover that forecast with 25% to spare (SC-011).

### Boundaries

| With     | Decision                                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 004      | `004-FR-014a` amended (spec FR-040). 020 builds the rightsholder list first, as the one table 004's D-004 blocklist also uses                                                                                                       |
| 016      | Decision and referral rows live in the recipe database (research R-13). 016's statement **delivery** is generalised to take a 020 decision. Its `notice_decisions` table is not. Out of Scope and Assumptions amended (spec FR-041) |
| ADR-0072 | Readiness gains the source flag for items headed public (spec FR-043). Unsure items save as drafts. The import still never publishes                                                                                                |
| ADR-0073 | Read only. `keepPrivate` and the downgrade are offered only with a slot free. A held recipe is public but hidden, so it uses no slot (research R-15)                                                                                |
| ADR-0024 | New call site, same pool, same grantee, layer-2 guard widened, worst-case reservation for photos                                                                                                                                    |
| ADR-0004 | One new NAT consumer row                                                                                                                                                                                                            |

### A new ADR is owed

The hold-in-the-read-rule decision, the per-recipe outcome over shared evidence, the photo rule (unproven, so a person
decides), the referral queue with its staffing gate, and the sixth call site are each hard to reverse. They are
recorded in a new ADR before the first build slice, numbered when written.

Two existing ADRs are amended with it:

- **ADR-0023**: a one-way downgrade of provenance after a save, to `imported_physical` or `imported_paid` with a
  citation (spec FR-015a, FR-044). Today `source` exists on create only, so without this amendment "change your
  statement" has no route.
- **ADR-0072 §7**: readiness waits for the source flag on items headed public (spec FR-043).

## Delivery slices

Each slice is test-first in every tier it touches (CLAUDE.md, "TEST-FIRST IS LAW").

| Slice | Delivers                                                                                                                                                                           | Depends on                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| S0    | The ADR; `staff-ux-engineer` SPECIFY for the checking, detected, "a person will check" and appeal states on web and mobile, and the reviewer queue                                 | none                                          |
| S1    | recipe-core: digest, detectors, evidence table, outcome function, `allowsPublication`. Pure, unit-tested                                                                           | S0                                            |
| S2    | Migration and tables; `content_sha256` and the check rendition on photo confirm; rightsholder list with admin routes; `checked_content_digest` on every write                      | S1                                            |
| S3    | Shadow mode end to end: rule detectors, the worker's text and photo calls with worst-case reservation, evidence and outcomes, `shadow` referrals, the forecast, metrics and alerts | S2                                            |
| S4    | Evaluation harness over the labeled set (outside the repo), photos included; bake-off confirms the model; reviewer timing on a shadow sample                                       | S3; counsel on the labeled set                |
| S5    | Read rule and cook surfaces: required field, SQL twins, `sourceCheck` on the response, appeal and downgrade routes, CDN removal, web and mobile states                             | S3                                            |
| S6    | Bulk import integration: source flag, readiness, choices                                                                                                                           | S5; ADR-0073 shipped                          |
| S7    | Referral queue, reviewer decisions, scoped read with signed photo URLs, statements through 016, staffing ledger, the blocking switch                                               | S5; 016's delivery and queue; security review |
| S8    | Switch blocking on                                                                                                                                                                 | S4 passes SC-001/SC-002; SC-011 met; S7       |

## Open questions for the owner

1. **`unchecked` goes to a person** (spec Clarifications, FR-020). The Q1 ruling's words cover "the AI can't figure it
   out". A spent budget means the AI never looked, which this plan reads as the same case. That replaces, for this
   feature, the earlier ruling that the cook is asked when the budget is spent. The cost is a referral flood in a month
   the pool runs out. Confirm, or rule that the cook is asked there instead.
2. **The curator grant counts as a person's decision** (FR-003a, research R-16). Otherwise the public-domain corpus
   fills the queue. Confirm.
3. **The 72-hour target for check referrals** (FR-030) is our default, sized for one part-time reviewer. Confirm or
   change it.
4. **Held recipes use no private slot** (research R-15). A held recipe is public but hidden, so ADR-0073 does not
   count it. That is a question on ADR-0073, raised here because more recipes now sit held.

## What the rulings make infeasible, or costly

- **No photo can be blocked by code, and no photo with a signal can go public without a person.** Code cannot prove
  what a model reads in an image. So "check everything we can" for photos means "every photo signal is a person's
  work". A photographed cookbook page, which is the clearest copy there is, still waits for a reviewer.
- **The queue is a hard capacity limit.** Nothing may publish an unsure recipe without a person, so an under-staffed
  queue means cooks wait, with no automatic way out. With the owner as the only reviewer, a busy week or a spent AI
  budget can break the 72-hour target. SC-011 makes this visible before launch. It cannot make it go away.
- **A spent AI budget floods the queue** under open question 1, until the period ends and the re-check drains it.
- **"A different reviewer" for an appeal of a person's hold** (FR-026a) needs two reviewers. With one, the same person
  decides the appeal, and the record says so.
- **Bulk imports at scale.** 300 imported recipes made public can create many referrals once the cook publishes them.
  Grouping by import helps a reviewer, but every recipe still needs its own decision.
- **Photo cost.** Up to ten photo calls per recipe on a dearer, image-capable model shrinks how far the $100 pool goes,
  and a pool that runs out sooner feeds the queue sooner.

## Residual risks

- **Unmarked copies pass.** A cookbook recipe typed out without its ISBN, publisher or page numbers, with a plain dish
  photo, usually reads `clear`. SC-003 reports this, and no claim may hide it.
- **The model adds little to `detected`.** Every blocking kind is a list or pattern match code can do. The model's
  value is `possible`, which now means a person's time.
- **One pool, shared.** A large import can use the month's pool, and every check after that is `unchecked`.
- **The month-start re-check can spend the new pool.** After a budget month, every open `unchecked` referral is checked
  again when the period starts (spec FR-021). That backlog lands on the new pool on day one, and it can use it up and
  start the next flood. Decision: it drains at the function's reserved concurrency, oldest first, and stops at a
  ceiling denial like any call. It gets no share of its own, because ADR-0024 §4c refuses a sub-budget per consumer.
  The forecast (FR-039a) shows the backlog's expected cost.
- **Non-prod is ungated.** The stated non-prod bound was measured wrong (pr-91), and photo calls add more. Reserved
  concurrency of 1 in non-prod is the bound.
- **A reviewer's clearance is a judgement on record.** Counsel is asked what standard it needs (spec FR-041).
- **016 is unbuilt.** Blocking cannot switch on until 016's statement delivery and queue exist. Until then the feature
  runs in shadow mode.
- **Reviewer access to someone else's held recipe and photos** is a new authorization shape. It needs a security review
  (`sec-aud-1`) before S7.
- **Fields the check does not read.** A copy hidden in a field the check does not read can still pass. The checked
  content list is versioned with the digest, so adding a field is a deliberate change.

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
├── checkedContentDigest.ts     # the one digest function (versioned)
├── detectors.ts                # rule-based detectors (Specification)
├── evidenceTable.ts            # blocking / for-a-person table (Visitor)
├── sourceCheckReading.ts       # outcome function, one classifier
├── allowsPublication.ts        # Policy
├── photoTokenCeiling.ts        # the resize bound and its token ceiling
└── __tests__/

packages/services/recipe-service/src/recipes/sourceCheck/
├── sourceCheck.schema.ts       # zod, copied to packages/schemas/recipe
├── sourceCheck.controller.ts   # appeal, downgrade
├── sourceCheck.service.ts
├── sourceCheck.dal.ts
├── referrals/                  # reviewer queue, decisions, scoped read
├── forecast/                   # referral forecast and staffing ledger
├── markers/                    # rightsholder list
└── enforcement/                # blocking switch ledger
packages/services/recipe-service/src/recipes/domain/recipeVisibility.ts   # gains the required field
packages/services/recipe-service/src/photos/                              # content_sha256 and the check rendition on confirm
packages/services/recipe-service/src/database/schema/sourceCheck.ts
packages/services/recipe-service/src/database/migrations/NNNN_source_check.sql

packages/services/recipe-workers/src/sourceCheck/
├── handler.ts                  # claim, read, reserve, call, settle, write
├── sourceCheckPrompts.ts       # buildSourceCheckTextPrompt, buildSourceCheckPhotoPrompt
├── dlqHandler.ts               # terminal unchecked(checkFailed)
└── sweeper.ts                  # 24-hour limit, next-period re-check; schedules disabled outside prod

packages/apps/commise/web, packages/apps/commise/mobile   # the cook's states, per staff-ux-engineer SPECIFY
packages/apps/commise/web                                 # reviewer queue inside 016's dashboard
```

**Structure Decision**: no new workspace. The pure logic sits in recipe-core because both recipe-service and
recipe-workers need the same digest and outcome function, and two copies would drift.

## Complexity Tracking

No constitution violation needs justifying. Two deliberate additions are recorded so nobody "simplifies" them away:

| Addition                                          | Why needed                                                                                              | Simpler alternative rejected because                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-recipe outcome over shared, per-part evidence | The outcome depends on the label and citation. Evidence depends only on one part: the text or one photo | One per-digest outcome gives a wrong answer to a second cook whose label differs. Evidence keyed by the whole content re-sends ten photos for a one-word text fix |
| One model call per photo                          | Each call needs its own worst-case reservation, and a denied photo call must not lose the text result   | One call with all photos has a ten-photo worst case that one denial throws away entirely                                                                          |

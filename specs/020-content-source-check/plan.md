# Implementation Plan: Content Source Check

**Branch**: `docs/im-spec020` (single-branch directive. Spec Kit ran with `SPECIFY_FEATURE=020-content-source-check`.) |
**Date**: 2026-10-26, revised the same day for four rounds of owner rulings and the staff-architect REVIEW |
**Spec**: [spec.md](spec.md) | **ADR**: [ADR-0074](../../docs/architecture/decisions/0074-content-source-check.md)
**Input**: Feature specification from `specs/020-content-source-check/spec.md`

## Summary

Before a recipe becomes publicly visible, an automated source check reads its text and its uploaded photos, and looks
for evidence that it came from a book, a paid site or another published source.

- **Rule-based detectors** run in recipe-service, in the save's own transaction: ISBN with checksum, listed publishers
  and paid sites, copyright notices, page references, paid-site templates, cited paid-site hosts. They are the only
  thing that can hold a recipe back on its own (`detected`), so a `detected` outcome is known when the save returns.
- **A Bedrock model** reads the text and each photo, alone, asynchronously in recipe-workers, as a sixth call site under
  the existing verification role. A text quote counts only if code finds it in the text, and even then it only sends
  the recipe to a person. A photo signal can never be proven by code, so it too only sends the recipe to a person.
- **Owner rulings, 2026-10-26.** Q1: "We should check everything we can. If the AI can't figure out if it's valid or a
  violation, then we need to raise it to a human to check." Q2: "A person decides." Then: "The only time we don't
  mark a recipe as needing review is if the photo AND the text and any source reference that was provided passes
  green." So a recipe goes public with no person only when every part is green. Every other recipe is held until a
  staff reviewer clears or holds it. Nothing automatic, and nothing the cook does, publishes it.
- **Our own database** is searched for the same recipe and the same source, and for what a person decided about them
  (owner: "we should also check our own database to see if same recipe already exists and was approved/passed or if
  recipes from the same source was approved/passed"). The lookup runs in the worker, before any spend. Only a person's
  own latest decision on the matched content can turn a part green, only when the copy adds no new evidence, and never
  by passing a green along. Private recipes are searched, but no cook ever learns anything about another cook's
  private recipe.
- **Reviewers are employees**, never users (owner: "the person reviewing these recipes are employees - not users").

The hold lives in the one read rule for who can see a recipe. So no save ever fails, and no write path can go around
it. Blocking starts in shadow mode, which also forecasts how many recipes staff will have to decide. It is switched
on only when the labeled-set evaluation and the duplicate-detection measurement pass. The forecast is information:
review time targets wait (owner: "we can deal with SLO/SLA later").

## Technical Context

**Language/Version**: TypeScript (strict), Node 24.x toolchain.
**Primary Dependencies**:

- recipe-service (NestJS 11, Drizzle) for the write path, the read rule, the cook API, referrals, the list and the
  forecast.
- recipe-workers (Lambda, `pg`) for the model calls, through `gatedLlm.ts` and ADR-0024's reserve-then-settle.
- recipe-core for the pure parts: the digest, the detectors, the evidence table, the outcome function, `allows`.
- New libraries in recipe-core: `isbn3` (MIT) for ISBN parsing and checksums, `tldts` for registrable domains, and
  `normalize-url` for page keys. `tldts` and `normalize-url` are in the tree today only as transitive dependencies, so
  each is declared directly, at its current major. `normalize-url` is ESM-only and recipe-core is an ES module.
- `sharp`, already in recipe-service for thumbnails, makes each photo's bounded **check rendition** at upload confirm.
  The worker reads that rendition. It needs no image library, so no native binary enters a Lambda bundle.
- Amazon Bedrock: Nova Lite v1, in region, takes images (research R-05). No new grantee.

**Storage**: RDS PostgreSQL 18, the existing recipe database. The new tables and columns are in
[data-model.md](data-model.md). The photo bucket is read, never written, and only by the source-check function. No new
datastore.
**Testing**: vitest unit and integration (mocked database), LOCAL e2e against a real Postgres and LocalStack S3 on a
developer's machine for the read rule, the migration and photo reads, Playwright for web, Maestro for mobile, k6 for the
read path (manual dispatch only). The tier for each scenario is in [quickstart.md](quickstart.md).
**Target Platform**: recipe-service on ECS Fargate, recipe-workers on Lambda (VPC-attached), web (Next.js 16) and
mobile (Expo 57).
**Project Type**: backend services plus web and mobile surfaces, plus a web-only reviewer queue in 016's dashboard.
**Performance Goals**: 95% of checks reach an outcome within 60 seconds of a publish, and none stays "checking" past
24 hours (SC-005). No review time target in this release. Public read and search latency does not regress
measurably with the extra `EXISTS` (k6). The lookup, which runs in the worker, meets its budget at the projected
corpus size in a LOCAL e2e benchmark before blocking is switched on (research R-17).

**Constraints**:

- One Bedrock grantee (ADR-0024 layer 4b), and one $100 prod pool, attributed by call site.
- Every call reserved at its worst case. A photo is sent as its check rendition, made at a fixed maximum size, so it
  has a token ceiling.
- The model sees the checked content only.
- A photo signal does not reject a recipe automatically and never clears one. It holds the recipe for a person (amended 2026-11-03, ADR-0082).
- No fetch of any link, no reverse image search. The duplicate lookup reads our own database only.
- A private recipe's content is shown to nobody but staff, and to staff only as its decision.
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
| V    | Monorepo and Workspace Governance | Pass   | No new workspace. Three direct dependencies in recipe-core (`isbn3`, `tldts`, `normalize-url`), two of them already in the tree transitively                           |
| VI   | Formatting and Tooling            | Pass   | Shared configs, unchanged                                                                                                                                              |
| VII  | Accessibility and UX Consistency  | Pass   | Every state goes through `staff-ux-engineer` SPECIFY before it is built, with accessible names, tokens and no colour-only state                                        |
| VIII | Cross-Platform Parity             | Pass   | Cook surfaces ship on web and mobile together. The reviewer queue is operator tooling, web only, as 016 records                                                        |

Re-checked after Phase 1 and after the Q1/Q2 revision: unchanged. The design adds no workspace and no second grantee,
and keeps every cook surface on both platforms.

## Pattern register

From the staff-architect's PLANNING pass and its REVIEW (both 2026-10-26), with the additions the owner's four rounds
of rulings required. The build is held to this register.

### Prescribed

| Unit                                         | Pattern                                                                                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule-based detectors                         | **Specification**: pure predicates in recipe-core, run in the save's transaction. **The only source of blocking**, so `detected` needs no async step                                                                 |
| Evidence weight                              | **Decision table** over kind × detector × label (spec FR-010), an exhaustive switch. Its `model` arm returns `forAPerson` only, and a CHECK repeats it                                                               |
| `matchEffectOf`                              | **Decision table with explicit precedence** (spec FR-047): ordered rows, the first that applies wins. Only one row greens, and it needs a person's latest decision and the same-items rule                           |
| Combining match effects                      | **Lattice join** per part: `notGreen` over `green` over `none` (spec FR-047c)                                                                                                                                        |
| The part results and `clear`                 | **Composite of Specifications**: one green predicate per part (text, each photo, source reference). `clear` is their conjunction. A reviewer's clearance is the same Composite applied to what the person saw        |
| `allowsPublication`                          | **Policy** as a pure function over the outcome, the cleared outcome and the clearance. The only author of `allows`. It takes no cook input                                                                           |
| `recipe_source_checks.state` and its writers | **State machine with compare-and-set guards**: `checking → decided`, a reviewer's clearance and the re-check as guarded inputs, each locking the referral row first (data-model §3)                                  |
| Shared model evidence                        | **Content-addressed Cache-Aside**, keyed by part, model, prompt SHA, output schema and rendition (spec FR-005)                                                                                                       |
| The check request, part claims and fan-in    | **Command + Idempotent Receiver + Observer**: a message per digest, a leased claim per part before any reserve, and a fan-in that finishes every outcome waiting on a part when it lands                             |
| The hold                                     | **One exported Specification** with a TypeScript form and a SQL form (`holdSpecification.ts`), held equal by a parity test, used by the read rule's twins and by erasure. A guard refuses a fifth copy               |
| Match fingerprints and source keys           | **Derived index** kept by the writer: one row per live recipe, rewritten in the content transaction, removed at a tombstone. The MinHash band table is the same pattern if the flip comes                            |
| The blocking switch                          | **Append-only ledger with a paused mode**: legal moves enforced by a trigger, the mode stamped once per outcome, never read per query                                                                                |
| The photo read                               | **Capability scoped by `lambda:SourceFunctionArn`**: one grant on a shared role, usable by one function                                                                                                              |
| `sourceCheckReadingOf`                       | **One classifier, several mappings** (preserved from ADR-0071 and ADR-0072): it feeds the read rule, `importSourceFlagOf`, the owner's badge, the referral and the statement of reasons                              |
| The two prompt builders                      | **Information hiding enforced by the type**: `Exact<Parameters<…>, [CheckedText]>` and `[CheckedPhoto]`, each branded, ADR-0026's rule                                                                               |
| The photo call's reservation                 | **Bounded resource**: resize to a fixed maximum, so the worst case is known before the call                                                                                                                          |
| The referral queue                           | **State machine plus work queue**: `shadow \| deferred \| open → cleared \| held \| withdrawn \| superseded \| resolvedByCheck \| expired`, oldest first, one live per recipe and digest, a per-cook cap that defers |

### Preserved, on purpose

- **Reserve-then-settle**, unchanged: settle is never retried, and an unreadable counter fails closed. A ceiling
  denial on this call site is not retried, as ADR-0024 §3 now records.
- **Test-principal containment** stays in front of the C-004 matrix in `visibilityPolicy.ts`. The source check does
  not join it there.
- **C-004** (`evaluateVisibility`, with ADR-0073's required slot fact) keeps deciding which visibility a label may
  hold.
- **The import view's `version` digest** (ADR-0072 §2) absorbs source flags with no new mechanism.
- **Erasure's one transaction** keeps its shape. It gains the hold Specification's SQL text and a wait before its
  recipe phase, not a second phase.

### Intent already satisfied, so no new machinery

- A verdict landing by key and visibility following from it is the existing `verifyLine` shape. Nobody flips
  visibility when a verdict lands.
- SQL text shared by two deployables through recipe-core is the existing `PARSE_JOB_AGGREGATE_SQL` shape.
- The statement of reasons is derived from a decision row, as 016 derives its own.
- Photo cache removal uses the existing `cdnInvalidation.ts`.
- Stopping an import is "stop calling `advance`" (ADR-0072 §2). No stop route.
- The per-cook referral cap is counted live under a per-cook advisory lock, ADR-0073's shape, never a counter column.

## Architecture

### Flow

```text
cook saves (public intent) ──▶ recipe-service, one transaction
                                 ├─ computes checked_content_digest (text + sorted photo hashes + source statement)
                                 ├─ runs the rule-based detectors on the text and the citation
                                 ├─ writes match fingerprints + source keys (no lookup here)
                                 ├─ rule blocks? ──▶ recipe_source_checks decided / detected. Done: no message, no spend
                                 └─ otherwise: check row (checking) + its part rows, stamps `enforced` from the mode
                                    if headed public, sends SourceCheckRequested {recipeId, digest}  (no content)
                                                     │
                                         recipe-workers: source-check Lambda (same steps every time)
                                           ├─ re-derives the digest (stale → stop, no spend)
                                           ├─ lookup in our own database (pg_trgm + SET LOCAL, shingle Jaccard)
                                           ├─ claims each part with a lease (layer 0a); claimed elsewhere → no spend
                                           ├─ text and each photo: reserve → call → settle (denial: not retried)
                                           ├─ writes each model set, then re-sends the check for every outcome waiting on it
                                           └─ writes the outcome by compare-and-set: items, parts, matches, allows,
                                              and reveal_at (the timing floor)
                                                     │
              possible / unchecked, decided, on a published recipe ──▶ referral (cap defers) ──▶ staff reviewer
                                                                                       clear │ hold
                                                                                             ▼
                                                                           decision + statement of reasons

any read ──▶ viewable = owner OR (public AND published AND SOURCE_CHECK_ALLOWS_SQL)
             SOURCE_CHECK_ALLOWS_SQL = the current digest's row AND ((allows AND reveal_at <= now()) OR enforced = false)
```

### Where the hold lives

A per-recipe check row read at query time (research R-02). The worker never writes `recipes`. An edit, a new photo, a
removed photo or a citation change moves the digest in the same transaction, so a public recipe leaves view at once.
Clearance points at the outcome and evidence it cleared, so a model or rule change never hides the corpus, and a
re-check cannot ride on a stale clearance. The enforcement mode is stamped on each outcome, never read per query, so
`paused` keeps old holds and stops new ones. The condition is one exported Specification that the read rule's three
SQL twins and account erasure all use. Flip to a fence column only if k6 shows the `EXISTS` over budget.

### Grantee placement

A new entry in `SPEND_CALL_SITES` (`source-check`), its own Lambda, queue, DLQ and reserved concurrency, under the
existing verification role (research R-01). Five guards move with it:

- `llmSpendGuards.test.ts` finds every function on the grantee role, not one named function.
- ADR-0004's NAT consumer table gains the function, and `natEgressConsumers.test.ts` asserts it.
- ADR-0024 §4c names `SPEND_CALL_SITES` as the authority for the call sites, instead of a count.
- The photo-bucket read is read-only on the check-rendition prefix and carries a `lambda:SourceFunctionArn` condition
  naming this function, in its own `iam.Policy`. An infra guard asserts the condition (ADR-0024 layer 4b).
- A guard pins this call site's model to an in-region registry entry (spec FR-033).

### Photos

Research R-07. Every uploaded photo on a recipe headed public is read, one model call each. The call reads the
photo's check rendition, made at upload confirm at a fixed maximum size, which gives the call a token ceiling. Signals
come from a closed set of five, with no free text. Every signal is unproven and sends the recipe to a person. No OCR
engine is added: under the ruling it would decide nothing. A recipe that was public and becomes held has its photo
paths removed from the CDN cache.

### Same recipe and same source

Research R-17 and R-19.

- **Where**: recipe-service writes the fingerprint and source keys in the content transaction. The worker runs the
  lookup after it re-derives the digest and before it reserves anything. No lookup runs in a request.
- **Same recipe**: an exact fingerprint (`v1:` SHA-256 of the normalised match text), and near copies found by
  `pg_trgm` (already installed) through a GIN index, under `SET LOCAL pg_trgm.similarity_threshold`, confirmed by
  word-shingle Jaccard. Thresholds come from a labeled pairs set (SC-015). A LOCAL e2e benchmark at the projected
  corpus size gates blocking. If it fails, a MinHash LSH band table replaces the GIN index.
- **Same source**: `page` (via `normalize-url`), `host` (via `tldts`) and `isbn` (via `isbn3`) keys, and any staff
  **source decision** on them.
- **Candidates**: never the recipe itself or its clone tree. Only a recipe first published earlier can be the original.
- **Effect**: `matchEffectOf` is an ordered decision table (spec FR-047). Only a person's own latest decision on the
  matched content greens, under the same-items rule, and never by passing a green along. Per part, not green wins.
- **Privacy**: private recipes are candidates. Staff see a private match's decision only. The cook sees one generic
  note for any match or source decision, on the same timing, and the worker runs the same steps whatever it finds.
- **Data**: match text, fingerprint and source keys are the cook's data, removed at a tombstone and at erasure. Only a
  hold decision keeps the hash, so a kept hash can only send a copy to a person.

### People and load

Research R-10. Referrals are created only when a cook publishes and the outcome is decided, never for a draft.
Reviewers are employees: 016's review scope is granted to staff accounts only, and a staff read of a cook's held recipe
needs a security review. Each cook has a cap on open referrals. Past it, new referrals wait as `deferred` and open as
the cook's open ones close. The cap only defers. The forecast in shadow mode gives referrals per day and staff time for
ordinary publishing, a budget-spent month and a curated book backlog. It is information, and gates nothing (owner: "we
can deal with SLO/SLA later"). The cap's number is set from it.

### Erasure and donation

Research R-18. Erasure's "truly public" predicate uses the hold Specification's SQL text. At election, each elected
recipe that is not already allowed is checked. One that is not all green gets a `donation` referral, and the erasure
job waits for its recipe phase until each is decided or the 14-day donation deadline passes. The account is closed
meanwhile. Then the existing transaction runs, and keeps only what the hold Specification allows. Fourteen days leaves
about sixteen of GDPR Art. 12(3)'s month for the rest of the erasure. A not-approved recipe is never donated. The election screen's amendment is spec
FR-044a.

### Boundaries

| With                 | Decision                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 004                  | `004-FR-014a` amended (spec FR-040). 020 builds the rightsholder list first, as the one table 004's D-004 blocklist also uses                                                                                                                                                                                                                                                              |
| 016                  | Decision and referral rows live in the recipe database (research R-13). Referrals appear in 016's reviewer queue (`016-FR-053a`), reached only through its review scope (`016-FR-053g`), granted to staff only. 016's statement **delivery** is generalised to take a 020 decision. Its `notice_decisions` table is not. Out of Scope, Assumptions and counsel items amended (spec FR-041) |
| ADR-0072             | Readiness waits only for the rule-based detectors on items headed public (spec FR-043). Every item that is not `detected` saves as a draft, and its AI check runs after the save. The import still never publishes                                                                                                                                                                         |
| ADR-0073             | Amended (§11). A public recipe in review uses no slot; a private one holds its slot. Not approved moves it to private, over the limit if need be. A `detected` save with no free slot is refused. A move from review to Private needs a free slot (research R-15)                                                                                                                          |
| ADR-0024             | New call site, same pool, same grantee. §3 gains a second path that does not retry a denial. §4c names `SPEND_CALL_SITES`. Layer 4b records the photo read scoped by `lambda:SourceFunctionArn`. Layer-2 guard widened, worst-case reservation for photos                                                                                                                                  |
| ADR-0027             | A third erasure verdict: time-boxed legal retention, with `purge_after`, for decision rows                                                                                                                                                                                                                                                                                                 |
| ADR-0039             | Table policy: the switch ledger is a `dictionary` table; markers and source decisions use a new `retireOnly` class                                                                                                                                                                                                                                                                         |
| ADR-0004             | One new NAT consumer row                                                                                                                                                                                                                                                                                                                                                                   |
| Account closure plan | U3b's election screen amended (spec FR-044a). The erasure worker reads the hold Specification and waits on donation referrals                                                                                                                                                                                                                                                              |

### The ADR

[ADR-0074](../../docs/architecture/decisions/0074-content-source-check.md) records the decisions here that are hard to
reverse: the hold in the read rule, per-part evidence, the all-green rule, match effects with precedence, no passing
along and the same-items rule, only rules block, the one-way switch with a paused mode, erasure and donation under a
hold, and the private-recipe non-disclosure rule.

Amended in place with it:

- **ADR-0024** §3 (a second path that does not retry a ceiling denial), §4c (the call sites, named by
  `SPEND_CALL_SITES`) and layer 4b (the photo read scoped by function).
- **ADR-0027** (time-boxed retention of decision hashes and reviewer text, and the erasure guard's third map).
- **ADR-0023**: a one-way downgrade of provenance after a save, to `imported_physical` or `imported_paid` with a
  citation (spec FR-015a, FR-044). Today `source` exists on create only, so without this amendment "change your
  statement" has no route.
- **ADR-0072 §7**: readiness waits only for the rule-based detectors on items headed public (spec FR-043).
- **ADR-0073** §11: a public recipe in review uses no slot, a private one holds its slot, and not approved becomes
  private (research R-15).

## Delivery slices

Each slice is test-first in every tier it touches (CLAUDE.md, "TEST-FIRST IS LAW").

| Slice | Delivers                                                                                                                                                                                                                                                                                                          | Depends on                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| S0    | ADR-0074 (written); `staff-ux-engineer` SPECIFY for the checking, detected, "a person will check" and appeal states on web and mobile, the erasure election screen, and the reviewer queue                                                                                                                        | none                                                                            |
| S1    | recipe-core: digests, detectors, weight table, `matchEffectOf`, outcome function, `allowsPublication`, the hold Specification in both forms. Pure, unit- and property-tested                                                                                                                                      | S0                                                                              |
| S2    | Migration and tables; `content_sha256` and the check rendition on photo confirm; rightsholder list with admin routes; `checked_content_digest` on every write                                                                                                                                                     | S1                                                                              |
| S3    | Shadow mode end to end: rule detectors in the save, fingerprints and source keys in the content transaction, the worker's lookup, leased claims, fan-in, text and photo calls with worst-case reservation, part results, outcomes, `shadow` referrals, the forecast, metrics and alerts                           | S2                                                                              |
| S4    | Evaluation harness over the labeled set (outside the repo), photos included, and the labeled pairs set for duplicates; bake-off confirms the model; thresholds set from measurement; the lookup benchmark at the projected corpus size; reviewer timing on a shadow sample                                        | S3; counsel on the labeled set                                                  |
| S5    | Read rule and cook surfaces: required field, the hold Specification in the SQL twins and in erasure's predicate, the fifth-copy guard, `sourceCheck` on the response, appeal and downgrade routes, the tombstone path, CDN removal, web and mobile states                                                         | S3                                                                              |
| S6    | Bulk import integration: source flag, readiness, choices                                                                                                                                                                                                                                                          | S5; ADR-0073 shipped                                                            |
| S7    | Referral queue (staff only) with the per-cook cap, reviewer decisions by compare-and-set with matches shown, source decisions, scoped read with signed photo URLs, statements through 016, donation referrals and the erasure wait, the blocking switch with its paused mode                                      | S5; 016's delivery and queue; security review; counsel on the donation deadline |
| S9    | _(added 2026-11-03, owner ruling, ADR-0082)_ CC BY eligibility: the outcome function exposes `ccByEligible` (see `FR-056`). The "publicly visible" read covers the open web, so family and Adapted recipes headed public already get the outside-copy check. Counsel review is owed before launch (`016-FR-050`). |
| S8    | Switch blocking on                                                                                                                                                                                                                                                                                                | S4 passes SC-001, SC-002 and SC-015; S7                                         |

## Tasks owed (ADR-0082)

_(Added 2026-11-03, owner ruling, ADR-0082.)_ The founder asked for an airtight path to public. Spec section K
(`FR-057` to `FR-074`) closes it with one gate. This section holds the door-by-door analysis and the tasks it owes.
This feature has no `tasks.md`, so the tasks live here. Their IDs are `K082-NN`, so they cannot collide with 016's
`L082-NN`. Every task is test-first: the failing tests in every tier come before the code (CLAUDE.md, "TEST-FIRST IS
LAW"). Counsel review is owed before launch (`016-FR-050`).

**Release order (FR-062).** S5's read rule with its required hold input ships before, or with, any new public door.
No slice in 021, 012, 018 or 026 that opens a public surface can merge ahead of S5.

### The bypass table

Every way content can become public or more visible. "Gate" names the requirement that holds it. "Same gate" says
whether it passes FR-002 like a first publish. The last column is what the shipped code does today.

| #   | Door                                                       | Gate                                                         | Same gate                                | Shipped code today                                                                                        |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | First publish from the editor                              | FR-001, FR-002, FR-057                                       | Yes                                      | No hold. `isRecipeViewableBy` is "owner, or public and published" (`recipes/domain/recipeVisibility.ts`)  |
| 2   | Private to public toggle                                   | FR-001, FR-002                                               | Yes                                      | No hold (`PATCH :id/visibility`)                                                                          |
| 3   | Edit a public recipe's text, or paste a new method in      | FR-001, FR-058, FR-064, FR-012d                              | Yes, after FR-058 and FR-064             | No hold. No digest exists                                                                                 |
| 4   | Add, replace, remove or reorder a photo on a public recipe | FR-001, FR-058                                               | Yes, after FR-058                        | No hold (`photos.controller.ts`)                                                                          |
| 5   | Title, description, tags, steps, lines                     | Text digest (data-model §0)                                  | Yes                                      | No digest                                                                                                 |
| 6   | Notes, credit text, display text, group label, preparation | FR-058 closes it                                             | Was a gap                                | Not in any digest. `notes` has no column yet                                                              |
| 7   | Restore an old version                                     | FR-065, FR-058                                               | Was a gap                                | `POST :versionNumber/restore` writes content with no check                                                |
| 8   | Line edit or rebind on a public recipe                     | FR-058 (the trigger)                                         | Was a gap                                | `PATCH :id/lines/:lineIndex`, `POST :id/ingredients/:position/rebind`. No check                           |
| 9   | Clone a public recipe, then publish                        | FR-001, `021-FR-005`, `001-FR-005b`                          | Yes                                      | Clone lands as a draft and keeps the source type (`recipes.service.ts` `clone`). Its publish has no hold  |
| 10  | Fork or "save my own copy" of a facts card                 | `021-FR-014c`                                                | Yes                                      | No facts card exists. A clone of a public `imported_public` recipe copies the full text                   |
| 11  | A recipe added to a public collection                      | FR-018 (lists and collections read the rule)                 | Yes                                      | Members filter through `readableBy` (`collections.dal.ts`). No hold term                                  |
| 12  | A public collection's name, description and cover          | FR-071                                                       | Was a gap                                | Description allows 1000 characters (`collections.schema.ts`), while `012-FR-017` says 200. No check       |
| 13  | Bulk import (ADR-0072)                                     | FR-003b, FR-024, `021-FR-014e` per-source cap                | Yes                                      | Not built (`src/import` holds a domain folder only)                                                       |
| 14  | Link, paste, video, photo and extension imports            | FR-004                                                       | Yes                                      | No hold                                                                                                   |
| 15  | A public web import read by another signed-in cook         | `021-FR-003`, `021-FR-014a` (facts card only)                | Yes, as a facts card                     | **Gap.** `visibilityPolicy.ts` allows `imported_public` public, and the read returns the full copied text |
| 16  | A book or paid-site card headed public                     | FR-003, FR-068                                               | Was a gap                                | No book card exists. `imported_physical` and `imported_paid` are refused public                           |
| 17  | A linked card's notes and photos                           | FR-068                                                       | Was a clarification only                 | No linked card exists                                                                                     |
| 18  | A licensed page (`021-FR-014f`)                            | FR-069 (always a person)                                     | Was a gap                                | Not built                                                                                                 |
| 19  | CC BY switched on                                          | FR-056, FR-070                                               | Yes, after FR-070                        | Not built                                                                                                 |
| 20  | Public domain text under the curator grant                 | FR-003a, `021-FR-006`, `016-FR-015k`                         | Yes                                      | The grant exists. No record, no gate                                                                      |
| 21  | A public domain record that fails later                    | FR-067, `021-FR-007`                                         | Yes, read live                           | Not built                                                                                                 |
| 22  | A site that opts out, passes its cap or is excluded later  | FR-067, FR-059, `021-FR-014e`                                | Yes, read live                           | Not built                                                                                                 |
| 23  | A source page that changes after import                    | FR-067 (never fetched again)                                 | Yes                                      | n/a                                                                                                       |
| 24  | A chef's Home or claim change (`021-FR-010a`)              | FR-067, `021-FR-010a`                                        | Yes. It moves the canonical address only | Not built                                                                                                 |
| 25  | Re-publish after a takedown                                | FR-066                                                       | Was a gap                                | Not built. No notice pipeline yet                                                                         |
| 26  | Account erasure donation                                   | FR-018a                                                      | Yes                                      | Erasure reads visibility only                                                                             |
| 27  | Household sharing                                          | FR-072 (not publication)                                     | Not public. Counsel item                 | No household code in recipe-service                                                                       |
| 28  | A creator's bio and avatar                                 | FR-071 (016 notice-and-action only; decided O11, 2026-11-03) | No, by house rule, decided               | Fields exist in identity (`types/profile.ts`)                                                             |
| 29  | Search, Discover and community lists                       | FR-018 correction (four predicates)                          | Yes                                      | `communityOf` and `readableBy` carry no hold (`recipePredicates.ts`)                                      |
| 30  | The 012 creator page list and embed widget                 | `021-FR-001`, `021-FR-061`                                   | Yes                                      | Not built                                                                                                 |
| 31  | Preview images and structured data                         | `021-FR-001`, FR-018b, `021-FR-061`                          | Yes. Social caches are residual          | Not built                                                                                                 |
| 32  | Lessons (013) and paid chef content (018, 026)             | FR-001's audience rule                                       | Yes, by FR-001                           | Not built. Those specs owe the follow-up                                                                  |
| 33  | Own-library export (`017-FR-018a`)                         | Not a public door. It goes to the cook only (GDPR Art. 20)   | n/a                                      | `GET export` serves the caller's own recipes                                                              |
| 34  | A public API or bulk download of the library               | `021-FR-103`. Not specified                                  | Yes, for any future one                  | None                                                                                                      |
| 35  | An offline publish from the outbox                         | FR-001, at the server                                        | Yes                                      | Outbox ships (ADR-0057)                                                                                   |
| 36  | A Commise-version pilot                                    | FR-073                                                       | Yes, with stricter thresholds            | Not built                                                                                                 |
| 37  | A draft set back to public by an old app                   | FR-059 (missing means held), FR-062                          | Yes                                      | n/a                                                                                                       |
| 38  | Sell a private recipe or collection (O14e)                 | FR-057, `012-FR-034c`, `018-FR-026`                          | Yes, at listing and on every buyer read  | Not built. No sale or listing exists yet                                                                  |
| 39  | An owner import with "This is my recipe" (O16)             | FR-012g, `004-FR-014a`                                       | Yes. A live claim clears one hit only    | Not built. No statement 1a and no claim exist yet                                                         |

### Tasks

| ID      | Task                                                                                                                                                               | FR                    | Tests (test-first)                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K082-01 | Make the hold a required input of `ViewableRecipeFields`, and fix every call site the compiler names                                                               | FR-057                | unit (each call site refuses a held recipe), integration (each read route answers 404 for a held recipe)                                                                                                                    |
| K082-02 | Guard: any SQL testing `visibility = 'public'` outside the hold Specification fails                                                                                | FR-018, FR-057        | unit (a planted fifth copy fails the guard)                                                                                                                                                                                 |
| K082-03 | The digest-to-NULL trigger on every checked table, and the digest write in the same transaction                                                                    | FR-058                | unit, integration, LOCAL e2e (each table's change nulls the digest, and the recipe reads as held)                                                                                                                           |
| K082-04 | The checked-field parity guard against every public projection                                                                                                     | FR-058                | unit (a projected field with no digest entry fails)                                                                                                                                                                         |
| K082-05 | The digest re-keying migration path                                                                                                                                | FR-058                | LOCAL e2e (a version bump keeps every public recipe public and every hold held)                                                                                                                                             |
| K082-06 | "Missing means held" in both forms of the hold Specification                                                                                                       | FR-059                | unit and property tests (each input forced to NULL or unknown, one at a time)                                                                                                                                               |
| K082-07 | The failure map, with an alert per row                                                                                                                             | FR-060                | unit (each dependency stubbed to fail), integration (the cook state stays `checking`, then `inReview`)                                                                                                                      |
| K082-08 | Idempotency keys for outcomes, referrals, claims, deliveries and search reservations                                                                               | FR-061                | unit, integration (a retried request answers the first result and writes nothing new)                                                                                                                                       |
| K082-09 | Flags for new doors default closed, and an unreadable flag reads closed                                                                                            | FR-062                | unit, integration                                                                                                                                                                                                           |
| K082-10 | The decision log fields, the rule version and the decider kind, with de-identification at erasure                                                                  | FR-063                | unit, integration, LOCAL e2e (erasure keeps a de-identified record and purges it at `016-FR-052a`)                                                                                                                          |
| K082-11 | Version-pinned public reads: during an edit's check, readers see the last approved version, never the new text _(amended 2026-11-03, O10)_                         | FR-064                | integration, deployed e2e (edit a public recipe: the public page shows the old approved text until the new text clears, then the new text; with no approved version it answers not-available)                               |
| K082-12 | Version restore computes the digest and starts a check, and a Not approved digest is refused                                                                       | FR-065                | unit, integration, deployed e2e                                                                                                                                                                                             |
| K082-13 | An actioned 016 notice feeds section J as a person's block, and a counter-notice supersedes it                                                                     | FR-066                | unit (the FR-047 table row), integration (a re-upload goes to a person)                                                                                                                                                     |
| K082-14 | Live reads for opt-out, cap, exclusion, the public domain record, Home and account state                                                                           | FR-067                | integration (each change takes effect within `021-FR-061`'s bound)                                                                                                                                                          |
| K082-15 | Facts card checks: notes and photos, the web search on long notes, no kept page image as a card photo                                                              | FR-068, FR-003        | unit, integration, deployed e2e                                                                                                                                                                                             |
| K082-16 | Every licensed page goes to a person with its fetch-log licence evidence                                                                                           | FR-069                | unit, integration                                                                                                                                                                                                           |
| K082-17 | The licence line and schema.org `license` follow the served digest                                                                                                 | FR-070                | unit, component, Playwright                                                                                                                                                                                                 |
| K082-18 | Collection description and uploaded cover checks, and a hidden description on a hit                                                                                | FR-071                | unit, integration, component, Playwright, Maestro                                                                                                                                                                           |
| K082-19 | The deployed bypass matrix suite: one row per door above, plus a web-search-off row                                                                                | FR-074                | deployed e2e (each row asserts not-available signed out and no read by another cook)                                                                                                                                        |
| K082-20 | Code follow-up: a non-owner read of a public `imported_public` recipe returns only the facts card projection                                                       | `021-FR-014a`         | unit, integration, deployed e2e (row 15)                                                                                                                                                                                    |
| K082-21 | Bio and avatar saves start no check, and a notice removes them _(added 2026-11-03, O11)_                                                                           | FR-071                | unit (no check call), integration (notice removes an avatar)                                                                                                                                                                |
| K082-22 | Aggregator-site recipes make no facts card, so the cap and exclusion live read (FR-067) never counts them _(added 2026-11-03, O6)_                                 | FR-067, `016-FR-030a` | unit, integration                                                                                                                                                                                                           |
| K082-23 | Selling is a door: a recipe is listed and read by a buyer only with an allowing outcome on its current digest, and a held listing is delisted _(added 2026-11-03, O14e. Amended 2026-11-03, O15b, ADR-0082: was "delivered")_ | FR-057, `012-FR-034c` | unit (a held recipe is refused for listing, a listed recipe that becomes held is delisted), integration (a sale of a recipe with no outcome is refused, a buyer read of a held recipe is refused), deployed e2e (bypass row 38) |
| K082-24 | An edit to a sold recipe re-runs the hold, and a buyer sees the last approved version until the new digest allows _(added 2026-11-03, O15b, ADR-0082)_ | FR-057, FR-064, `018-FR-029d` | unit (the buyer read picks the newest allowing version), integration (edit, then a buyer read returns the old version, then the new one after approval), deployed e2e (bypass row 38) |
| K082-25 | A sale writes no copy: a purchase creates a grant and no recipe row, and a route that writes a bought recipe into a buyer's account is refused _(added 2026-11-03, O15a, ADR-0082)_ | FR-057, `018-FR-029a` | unit (the grant path writes no recipe), integration (no clone, export or copy route accepts a grant holder), mutation check (a sale that wrote a copy fails the test) |
| K082-26 | Unverified versus verified at the gate: a bare owner statement clears nothing, and a live claim clears only the hit on the recipe's own origin page _(added 2026-11-03, owner ruling O16, ADR-0082)_ | FR-012g, `004-FR-014a` | unit (table over statement and claim: no statement, statement only, statement with a live claim, a live claim on another domain), integration (statement only goes to a person with the statement shown, statement with a live claim goes green when nothing else hits), mutation checks (a claim that clears a hit on another page of the same domain fails, a bare statement that clears a hit fails, a claim that clears a web-search hit fails) |
| K082-27 | The claim persists per site: a second import from the same verified domain clears its own-origin hit with no new proof, and the outcome names the claim by opaque id _(added 2026-11-03, owner ruling O16, ADR-0082)_ | FR-012g, `026-FR-001` | unit (the claim is read by domain and cook, never stored on the recipe), integration (two imports from one domain, one claim, both cleared, both outcomes cite the same claim id) |
| K082-28 | Loss of verification: a failed or removed claim never reopens a cleared recipe, and the next edit or import is checked against the claim as it stands _(added 2026-11-03, owner ruling O16, ADR-0082)_ | FR-012g, FR-067, ADR-0078 §2 | integration (clear, fail the claim, the recipe stays public, a new import from the domain goes to a person, an edit to the cleared recipe goes to a person), mutation check (a build that re-checks cleared recipes on claim failure fails), deployed e2e (the verified and unverified pair, through 004's URL import) |
| K082-29 | Erasure of the claim: the claim row is deleted with the account, and an outcome that cited it keeps only the opaque claim id, method and last check time _(added 2026-11-03, owner ruling O16, ADR-0082)_ | FR-012g, FR-063, `016-FR-069` | unit (the de-identified record has no domain field), integration, LOCAL e2e (erase a cook with a cleared recipe: no claim row, the outcome survives without the domain), erasure-coverage test lists the claim table |

## Owner answers so far, and what is still open

Answered on 2026-10-26: a spent budget waits for a person (confirmed); a curator's grant is not a review (overruled);
a recipe skips review only when every part is green (generalised); review time targets wait (dropped for now);
reviewers are employees. The fourth round answered the review's four questions: match precedence (ruling 1), the
same-items rule and no passing along (ruling 2), private-recipe non-disclosure (ruling 3), and donation at erasure
(ruling 4). The spec's Clarifications quote them. The third round's defaults for the lookup are now settled by them,
in spec FR-047.

A fifth round the same day answered the rest (spec Clarifications):

- **In review is neither public nor private.** A public one uses no slot; a private bulk import holds its slot (eighth
  round). Not approved ends review and makes the recipe the
  cook's private recipe, even over the limit. This resolves ADR-0073's open question (research R-15).
- **The donation deadline is 14 days.**
- **No random sampling of green recipes for now.** The residual is accepted.
- **The strict text rule stands.**

A seventh round the same day: bulk import publishes every recipe with its chosen visibility, and every imported
recipe, public or private, is checked and waits in review until approved (spec FR-003b, ADR-0072 §3). A sixth round
the same day: a person's rejection now tells the cook why, from a fixed list of five reasons, with
`notYours` offered only for a public match (spec FR-027); and a draft uses no slot and can be used for nothing but
editing (`001-FR-003b`), which closes the Draft path.

**Still open**:

- **Reviewing private imports costs model spend and staff time** on content nobody else sees (research R-15).
- The counsel items of spec FR-041.

## What the rulings make infeasible, or costly

- **No photo can be blocked by code, and no photo with a signal can go public without a person.** Code cannot prove
  what a model reads in an image. A photographed cookbook page, the clearest copy there is, still waits for staff.
- **Only an all-green recipe skips review.** Any one grey part (a photo the budget did not cover, an unreadable
  citation, one unproven quote) sends the whole recipe to staff. That is the ruling's intent, and its cost is staff
  time.
- **The queue has no automatic way out.** With no time target and no automatic release, a backlog means cooks wait. At
  launch the reviewers are the founder and a paid backup (spec 016 `FR-053h`, owner ruling, 2026-10-27). A busy week, a
  spent AI budget or one curated book can still hold recipes for a long time. Once the measured load crosses
  `016-FR-053i`'s trigger, a half-time reviewer is hired. The hire does not shorten a backlog that already exists. The
  forecast shows this before launch. Nothing in the design can make it go away.
- **A curated book is a one-time backlog of close to all its recipes.** Old cookbooks carry page references. A staff
  source decision approving the book makes its source reference green, but each recipe's text still needs a person
  unless it is all green.
- **"A different reviewer" for an appeal of a person's hold** (FR-026a) needs two staff reviewers. From launch there
  are two, the founder and the paid backup (2026-10-27). When one of them cannot act, the same person decides, and
  the record says so.
- **The duplicate lookup can only see what we keep.** An erased or deleted recipe's match text is gone, so a copy of a
  recipe a person approved for an erased cook is judged afresh. A held recipe that was erased can still be caught as an
  exact copy, by the hash kept on its hold decision, but not as a near copy.
- **Erasure can wait.** A cook who elects to donate a recipe that needs a person waits for that person, up to the
  donation deadline, before their recipes are erased. Their account is closed meanwhile.
- **Photo cost.** Up to ten photo calls per recipe on an image-capable model shrinks how far the $100 pool goes, and a
  pool that runs out sooner feeds the queue sooner.

## Residual risks

- **Unmarked copies pass.** A cookbook recipe typed out without its ISBN, publisher or page numbers, with a plain dish
  photo, usually reads `clear`. SC-003 reports this, and no claim may hide it.
- **The model never adds to `detected`, by design.** Only the rule-based detectors block. The model's value is
  `possible`, which now means a person's time. A publisher the model keeps finding belongs on the list.
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
- **Staff access to a cook's held recipe and photos**, and to the decision on another cook's private match, is a new
  authorization shape. Reviewers are employees, which narrows who can reach it, not what it exposes. It needs a
  security review (`sec-aud-1`) before S7.
- **The lookup's cost at scale is not yet measured.** The staff-architect REVIEW found the GIN trigram index the wrong
  shape at scale. The LOCAL e2e benchmark at the projected corpus size decides whether the MinHash band table is
  needed before blocking. No maintained JavaScript MinHash library was confirmed (research R-17).
- **The original can be evaded by publishing first.** Only a candidate first published earlier can be flagged as the
  original, and `first_published_at` is set once. So a cook who publishes a placeholder early and pastes another cook's
  recipe into it later is judged as the earlier of the two. The match is seen only when the original is next checked,
  and then the original is the recipe sent to a person, who sees both. Accepted: ordering by the latest content change
  instead would flag every original whenever a copy is edited first.
- **Non-disclosure: an accepted residual.** A cook learns only that a person will check, never what or whose. The owner
  ruled out cover traffic for now (research R-19).
- **A cook can end up over the private limit.** A person's non-approval makes the recipe private even with no free
  slot. The cook keeps it and cannot make anything new private until under 50. The number of such recipes is bounded
  by staff decisions, not by the cook.
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
├── evidenceWeight.ts           # weight decision table over kind × detector × label
├── sourceCheckReading.ts       # outcome function, one classifier
├── allowsPublication.ts        # Policy over outcome, cleared outcome and clearance
├── holdSpecification.ts        # the hold: TypeScript predicate + SOURCE_CHECK_ALLOWS_SQL, held equal by a parity test
├── photoTokenCeiling.ts        # the resize bound and its token ceiling
├── partResults.ts              # green per part, and clear as their conjunction
├── matchText.ts                # normalised match text and its fingerprint
├── shingleSimilarity.ts        # word-shingle Jaccard over two match texts
├── sourceKeys.ts               # page, host and isbn keys
├── matchEffect.ts              # matchEffectOf: ordered decision table, plus the lattice join per part
├── sameItems.ts                # the same-items rule over kind and normalised marker
└── __tests__/

packages/services/recipe-service/src/recipes/sourceCheck/
├── sourceCheck.schema.ts       # zod, copied to packages/schemas/recipe
├── sourceCheck.controller.ts   # appeal, downgrade
├── sourceCheck.service.ts
├── sourceCheck.dal.ts
├── referrals/                  # reviewer queue, decisions, scoped read
├── forecast/                   # referral forecast (information only)
├── matching/                   # fingerprints and source keys in the content transaction, source decisions
├── markers/                    # rightsholder list
└── enforcement/                # blocking switch ledger
packages/services/recipe-service/src/recipes/domain/recipeVisibility.ts   # gains the required field
packages/services/recipe-service/src/photos/                              # content_sha256 and the check rendition on confirm
packages/services/recipe-service/src/database/schema/sourceCheck.ts
packages/services/recipe-service/src/database/migrations/NNNN_source_check.sql

packages/services/recipe-workers/src/sourceCheck/
├── handler.ts                  # re-derive, look up, claim, reserve, call, settle, fan in, write
├── lookup.ts                   # the pg_trgm lookup under SET LOCAL, shingle Jaccard, candidate rules
├── sourceCheckPrompts.ts       # buildSourceCheckTextPrompt, buildSourceCheckPhotoPrompt
├── dlqHandler.ts               # terminal unchecked(checkFailed)
└── sweeper.ts                  # 24-hour limit, missed fan-in, expired claims, next-period re-check; disabled outside prod
packages/services/recipe-workers/src/handlers/accountErasureWorker.ts   # uses SOURCE_CHECK_ALLOWS_SQL; waits on donations
packages/services/recipe-workers/infra/lib/                             # the photo read in its own iam.Policy, by function

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
| The enforcement mode stamped on each outcome      | `paused` must keep old holds and stop new ones, and no mode change may hide or reveal a recipe at once  | Reading the latest ledger row in the read rule lets one insert publish every held recipe, `detected` ones included                                                |
| Leased part claims and a fan-in                   | Two recipes that share a photo must not pay twice, and neither may wait forever                         | A plain claim leaves the second recipe's outcome unfinished when another worker holds the part                                                                    |

## Next batch (FINAL, owner ruling 2026-11-03)

FINAL, owner ruling 2026-11-03. These tasks cover spec section L (`FR-075` to `FR-078`). The check uses AI and searches the wider internet, not only the cited source _(amended 2026-11-03, owner ruling, ADR-0082)_. How the search works and the AI and search cost and budget are OPEN (owner ruling 2026-11-03): decided when feature 020 starts. N-09 waits on Q-1. IDs are `N-NN` so they cannot collide with `K082-NN` or `S`. Every task is
test-first: the failing tests in every tier come before the code. Counsel review is owed before launch (`016-FR-050`).

| ID   | Task                                                                                                          | FR                | Tests (test-first)                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| N-01 | Run the outside-copy check on method steps at import and return per-step flags                                | FR-075, FR-012a   | unit (each step flagged or green), integration (flags beside the match review result), LOCAL e2e                                    |
| N-02 | Suggestion call: input is the flagged step only, never the matched text, URL or statement                    | FR-075, FR-008    | unit (the prompt builder takes one string and the type refuses a second argument), integration (the model double sees only the step) |
| N-03 | Re-run the check on accept, edit and dispute, and show a still-matching suggestion as flagged                 | FR-075            | unit, integration (a suggestion that copies the source is flagged again), Playwright and Maestro (accept, edit, dispute)            |
| N-04 | A flag holds PUBLIC and SALE, and never holds a private recipe for this reason alone                          | FR-075, FR-057    | unit (hold Specification), integration, deployed e2e (a bypass-matrix row for an unresolved flag)                                   |
| N-05 | A suggestion never clears: no code path writes a clearance from a suggestion                                  | FR-075, ADR-0074  | unit (mutation test: a green re-run still needs the normal rule path), guard (no clearance writer imports the suggestion module)    |
| N-06 | Same suggestions in the in-review screen, with no line detail for a private match                             | FR-076            | unit, integration (a private match gives the generic message and no suggestion), component, Playwright, Maestro                     |
| N-07 | Search or model cannot run (budget, counter or provider): no suggestion, recipe waits for a person. The budget is OPEN | FR-076, FR-078    | unit, integration (ceiling denial is not retried)                                                                                   |
| N-08 | Suggestion call spend wiring. Pool, ceiling and mechanism are OPEN (decided when feature 020 starts)          | FR-078            | unit, guard (`llmSpendGuards.test.ts` set equality), integration                                                                    |
| N-09 | Label rule for an accepted suggestion, per the founder's answer to Q-1                                        | FR-077, 016-FR-015i | unit (label with and without an accepted suggestion), integration, component. Blocked on Q-1                                      |
| N-10 | Counsel review of the items section L adds                                                                    | FR-050 (016)      | none                                                                                                                                |

---
title: PR 91 — foundation hardening, status substrate, and portfolio respec
date: 2026-08-15
status: ready for ce-plan (all open questions resolved 2026-08-15)
origin: conversation (owner rulings, 2026-08-14/15)
evidence: docs/reviews/2026-08-14-pr91-findings/ (24 reports, 12 of them adversarial)
---

# PR 91 — foundation hardening, status substrate, and portfolio respec

## Summary

PR 91 hardens the three shipped features, fixes every verified finding, builds a durable per-entity
status substrate on DynamoDB, and re-specs features 004–014 so the worktrees can rebase onto a
coherent portfolio. No new user-visible feature ships in this PR; the import UI follows in 004's own
branch.

## Problem frame

Three shipped features (001 recipe core, 002 auth, 003 food data) carry defects that a 24-report review
found and verified, including a **compound GDPR failure where all three defence layers are
simultaneously non-functional**. Meanwhile features 004–014 were specified independently and have
drifted into contradiction — two features owned photo import, two claimed the same ALB priority, and
several specify foreign keys across database boundaries that cannot exist.

Separately, asynchronous work (bulk import, food resolution, OCR) has no way to tell a client what is
happening. Producers cannot deliver a message anywhere durable: the event emitter is a console stub and
the AWS SDK for the bus is a dependency of no package.

## Requirements

### R1 — Message substrate

- **R1.1** Any backend producer — Fargate service, Lambda, or worker — MUST be able to deliver a
  message asynchronously to permanent storage. Producers MUST NOT require VPC attachment, a database
  connection, or a migration to do so.
- **R1.2** Messages MUST be grouped by entity, and a consumer MUST be able to read **all** messages for
  a group. Per-group history, not just the latest.
- **R1.3** Messages MUST NOT be lost or dropped once accepted.
- **R1.4** Producing MUST be fire-and-forget. A producer does not await consumers, does not know they
  exist, and does not handle their failures.
- **R1.5** The substrate MUST cost nothing at idle and MUST scale to high volume without added latency
  or loss.
- **R1.6** Consumers, not the substrate, decide which message in a group wins. The substrate performs
  **no** compaction, no supersession, no watermarking.
- **R1.7** Message expiry MUST be enforced, and is a **cost control**, not hygiene — without it storage
  alone reaches roughly $330/month by month 12.
- **R1.8** The notification service MUST be **notified** when messages arrive. Client polling is
  explicitly rejected.
- **R1.9** Producers MUST NOT know the storage technology. They depend on a published port; exactly one
  adapter knows the store.

### R2 — Food placeholders and status

- **R2.1** The food service MUST create a placeholder row when a recipe references an unresolved
  ingredient, and MUST advance its status until source data completes the entry.
- **R2.2** Placeholder status MUST be readable from the database at any time, so a client connecting
  mid-flight renders correct state from a read.
- **R2.3** Every placeholder MUST have a reachable terminal state. A stalled placeholder MUST NOT leave
  a user waiting indefinitely.
- **R2.4** A shell entry is **not** a recipe written into the food database. The single-writer rule
  stands; the food service's own resolution pipeline creates and advances it.

### R3 — Shipped-defect remediation

- **R3.1** Account erasure MUST actually erase, across every service that holds the user's data, and
  the UI MUST NOT claim more than it does.
- **R3.2** Every alarm MUST be capable of firing and MUST reach a human.
- **R3.3** Nutrition selection MUST be deterministic. Energy in kJ MUST NOT be stored as kcal.
- **R3.4** Every finding in **`docs/reviews/2026-08-14-pr91-findings/00-INDEX.md`** MUST end as `fixed`,
  `rejected` (with a reason) or `deferred` (with a target). **203 findings across 18 reports**; 201 need a
  disposition (2 are REFUTED attacks that need none). Severity: **6 CRITICAL, 38 HIGH, 56 MED, 25 LOW**,
  plus adversarial verdicts and 43 unrated.
    - IDs are `<report>.<local>` because `A-1` and `P-1` are **reused across six documents**.
    - Eleven further reports are design/research narratives with no enumerable findings and are excluded
      from the count — listed explicitly in the index so their exclusion is visible rather than assumed.
    - The earlier figures of "112" and "174" were both artifacts of counting mid-review with a pattern that
      missed formats; the index is now the single authority.

### R4 — Standards conformance

- **R4.1** One file-naming regime for every package. No hyphens, no underscores. _(landed: 028f88c9)_
- **R4.2** One file, one thing — one class, one component, one functionality. No god files.
- **R4.3** Every rule in `CODING_STANDARDS.md` that CAN be mechanically enforced MUST be, and the
  document MUST NOT contain two rules that contradict each other.

### R5 — Portfolio respec

- **R5.1** Features 004–014 get spec, plan and task updates only — **no implementation** in PR 91.
- **R5.2** No two features may claim the same ALB listener priority, and none may exceed the ceiling.
- **R5.3** No spec may declare a foreign key across a database boundary.
- **R5.4** Feature 011 MUST specify a reaper removing its own stale jobs and artifacts after 3 days,
  cross-referencing ADR-0016's window so the two do not drift.
- **R5.5** Feature 011 MUST specify that the consumer selects the most recent message in a group **by
  timestamp**, and MUST state the single-writer-per-group invariant that makes timestamp selection safe.

## Key decisions

| #   | Decision                                                                                                         | Rationale                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **DynamoDB** (`PK=group`, `SK=timestamp`) as the substrate                                                       | Only DynamoDB and a Postgres table satisfied all six requirements; every deliver-then-delete product (SQS, SNS→SQS) fails R1.2 outright, EventBridge replay is unordered and ungrouped, Kinesis costs $10.95–29.20/mo at idle, MSK Serverless idles at $547.50/mo, and Valkey bills storage per GB-**hour** ($61.32/GB-month). Postgres was excluded by owner ruling: producers must not need database access. |
| D2  | Producers `PutItem` directly; **no outbox, no relay**                                                            | The outbox solves dual-write _correctness_ between two sources of truth. Here the row is the sole source of truth. Flip condition: if automation ever derives durable state transactionally from the message stream, revisit.                                                                                                                                                                                  |
| D3  | **DynamoDB Streams → Lambda** for notification                                                                   | Ordering is guaranteed per partition key, so a group arrives in order for free. GetRecords via a Lambda trigger is **not billed**. The stream is the notification; the table is the truth — a consumer down beyond the 24h stream window recovers by `Query`, not by loss.                                                                                                                                     |
| D4  | Expiry via **TTL**, 3 days                                                                                       | Cost control (R1.7). Caveat: TTL is best-effort within ~48h of expiry, so if 3 days is a hard privacy boundary it needs explicit deletion instead.                                                                                                                                                                                                                                                             |
| D5  | Port named **`publish` / `OutboundMessage`** in a shared package                                                 | The seam already exists as `EventBus.putEvent` inside food-service, documented as "source-agnostic". It is renamed (the old name implies a bus that isn't there) and promoted so any producer can use it. Adapters: Dynamo, Console (dev), InMemory (tests). Producers also get IAM scoped to `PutItem` on one table ARN, so the boundary is enforced by permission as well as by code.                        |
| D6  | **AWS Textract** as the default OCR provider                                                                     | Reverted from Tesseract on measurement: two independent runs put Tesseract at 16.8s and 37s on dense pages against `NFR-001`'s 10s, it is single-threaded so no memory tier helps, ML Kit's handwriting API reads stylus strokes rather than photographs, Tesseract scores 30–55% on cursive, and `004/research/tech-stack.md:41` had already evaluated and rejected it. The saving was ~$1.50/month.          |
| D7  | Mobile does on-device OCR for **printed** text and submits raw text                                              | 004 gains a first-class raw-text channel. The text is classified `imported_paid`, never `imported_physical`, so the premium gate keeps its enforcement point and `FR-025`'s no-caller-declared-provenance rule is not inverted.                                                                                                                                                                                |
| D8  | **Per-domain async processors**, converging only at recipe creation                                              | The post-extraction path is not identical across channels — OCR needs per-token confidence with geometry, a correction state, and different quota accounting. One shared processor would have grown flags. They share a **contract** in a shared package, not a base class or a runtime.                                                                                                                       |
| D9  | Nutrition is a **live reference**, with a carve-out                                                              | 006's spec independently reached the same conclusion. Carve-out: 009's recorded historical outcomes (`nutrition_compliance.actual_*` **and** `planned_*`) must pin with `computed_at`, since "actual" means historical fidelity.                                                                                                                                                                               |
| D10 | **Drop `lead_calories_per_serving`** — _stands; the amendment that reversed it was itself superseded, see KTD-3_ | Three reviews converged. Today cards read a frozen column while detail computes live, so the database holds two answers and `nutrition.ts:66-69`'s "can never disagree" is false. Dropping it is not an N+1 — two batched `ANY($1)` scans on existing indexes.                                                                                                                                                 |
| D11 | E2E = mocked Playwright for the UI state matrix + **local full stack** for the spine                             | No dependency on a per-PR deploy.                                                                                                                                                                                                                                                                                                                                                                              |
| D12 | Services run **1 task**, not 2                                                                                   | Two-task defaults are an HA posture against zero production traffic. Cost is not a constraint on this topology: ~$99/mo actual today, and the $360/mo figure that drove earlier alarm assumed a posture that isn't run.                                                                                                                                                                                        |

## Scope boundaries

**In scope — implementation:** features 001, 002, 003; all verified findings; the message substrate and
its port; food placeholder creation and status progression; standards conformance and its enforcement.

**In scope — specification only:** features 004 through 014, including 004's recipe placeholders and
raw-text channel, and 011's reaper and timestamp-selection rule.

**Explicitly out:**

- The import UI — 004's worktree is 16 commits ahead with the import spine, file channel and typed
  client already built; the missing piece is UI, and it lands there after rebase.
- 011's image branch and correction UI.
- Feature 014 beyond the substrate.
- Splitting god files — the check is added and violations enumerated; the splits are a separate task.

## Success criteria

- **SC1** A recipe is created, its ingredients resolve, a food placeholder is created, its status
  advances to resolved, and nutrition appears — provable end to end on the local full stack.
- **SC2** A producer publishes without knowing the store; swapping the adapter requires no producer
  change; an in-memory adapter serves the tests.
- **SC3** All messages for a group are retrievable in one query, in order.
- **SC4** Account erasure verifiably removes the user's data from every service that holds it.
- **SC5** Every alarm has a subscriber and a dimension set that can produce a datapoint.
- **SC6** `npm run lint` reports zero filename and god-file violations.
- **SC7** No spec declares a cross-database foreign key or a duplicate ALB priority.

## Dependencies and assumptions

- **A1** Producers authenticate to DynamoDB by IAM. Verified: no VPC or database access needed.
- **A2** The recipe→food HTTP call from a background processor still has **no service credential**. The
  proposed unblock is a second audience on the existing EdDSA erasure token, whose public key food
  already holds. This blocks the placeholder half, not the substrate.
- **A3** `CREATE INDEX CONCURRENTLY` **cannot run** — both migration runners wrap each file in a
  transaction. Any index work must account for this.
- **A4** Mobile on-device OCR is a build-posture change: it forces an EAS dev-client and retires Expo Go.

## Resolved open questions (owner, 2026-08-15)

All five are closed. Recorded with the reasoning so ce-plan does not re-open them.

- **Q1 — 006 keeps its own service and database.** 007's foreign key to `meal_plans` and 009's
  `meal_plan_nutrition_link` join table are reworked into cross-service calls. Note the ADR-0017
  amendment's _reasoning_ must be rewritten: both arguments originally given for the extraction were
  refuted (one circular, one resting on a premise that proved empirically false). The decision is an
  owner call about bounded contexts, not a measured trigger that fired — record it as such.
- **Q2 — Order the writes so the harmless failure wins.** Progress messages (`queued`, `processing`)
  are written **before** the row, since a premature one is corrected by the next message. Terminal
  messages (`succeeded`, `failed`) are written **after** the row commits, so the system never claims a
  success that did not happen. No reconciliation sweep.
- **Q3 — Reading B, streamed.** Recipes hold no nutrition copy; the recipe service calls the food
  service and **streams** the response so recipe data reaches the client first and nutrition follows as
  it arrives. Streaming goes to **both** platforms via a React Native streaming-fetch polyfill.
    - Fallback when food is slow or down: serve **heavily cached last-known values, clearly marked
      stale**, with a retry that goes **direct from the client to the food service** (both apps already
      hold a food client for ingredient search).
    - `recipes.lead_calories_per_serving` is dropped either way.
    - ⚠️ **Risk to carry into planning:** RN streaming-fetch polyfills are fragile and this sits on the
      critical read path for every recipe. Spike it before committing; fallback is two requests on mobile.
    - ⚠️ Streaming improves perceived latency but not load — a 20-recipe list can fan out to ~200 food
      lookups. The cache is what makes this viable, not the streaming.
- **Q4 — On-device OCR first, fall back to Textract on low confidence.** 011 only, and **docs only in
  PR 91 — no code**. The spec must name the failure mode explicitly: the heuristic's weakness is a
  result that is _wrong but confident_, which never trips the threshold. Requires a measurable
  threshold **and** a manual "re-run in the cloud" escape hatch.
- **Q5 — TTL stamped at 3 days; a target, not a deadline.** Actual removal lands within roughly 2 days
  after that. Free, no job, no alarm. If a retention period is ever stated publicly, the honest figure
  is ~5 days, not 3.

## Superseded questions

- **Q1** Feature 006's extraction into its own service has been refuted twice — first as circular
  reasoning, then because C-006-001's "three destructive sweepers" premise is empirically false (all
  three are per-row or hand-enumerated). Revert to ADR-0017 as written, or extract on new grounds?
- **Q2** The dual-write window: a producer dying between its state change and `PutItem` leaves no
  message. Accept it, order writes so the benign failure wins, or add a reconciliation sweep?
- **Q3** "Live reference" has two readings — one additive and reversible, one destructive and
  irreversible that changes meaning at deploy before any DDL. Which is meant?
- **Q4** Handwriting on Android: ML Kit cannot read handwriting from photographs. Does the mobile path
  fall back to Textract for handwriting, or is handwriting web-only until 011?
- **Q5** Is the 3-day expiry a hard boundary (needs explicit deletion) or a target (TTL is fine)?

## Amendment — card calories (owner, 2026-08-15) — ⛔ ITSELF SUPERSEDED, SAME DAY

> ## ⛔ THIS AMENDMENT NO LONGER HOLDS. Read this box before citing anything below it.
>
> **Superseded hours later by KTD-3** in
> `docs/plans/2026-08-15-001-feat-pr91-foundation-hardening-plan.md` (owner ruling, 2026-08-15).
> **D10 is reinstated and widened**: `recipes.lead_calories_per_serving` is dropped after all, and so is
> `recipes.has_partial_nutrition`, the four per-100g columns, and `ingredients.portions`.
>
> **Why it fell.** This amendment kept the stored column by promising to refresh it through the
> substrate. The owner then ruled that the recipe service does **not** consume food events (KTD-4) — so
> nothing refreshes the column, and a stored total is simply duplicated data with no keeper. The owner
> separately ruled that the recipe service **may** call food during list and search, which removes the
> constraint that forced the amendment in the first place ("lists and search touch zero food rows").
>
> **The premise that changed underneath it.** This amendment reasoned about "food details on a recipe
> list". The owner corrected that framing directly: _"We aren't showing food details on a recipe list —
> only in a recipe detail. That's the difference between the search page and a recipe page."_ A card
> needs one number, not a nutrition panel, and one batched call serves a whole page of them.
>
> **Its one durable consequence is gone too.** The claim below that this gives the substrate "its first
> real consumer" is void — the recipe-side refresh handler it describes is never built. Under the
> current plan the substrate ships with **producers only**; consumers arrive with feature 014.
>
> Three findings in the 2026-08-15 document review were raised against the plan for contradicting this
> amendment. They were **rejected** — the plan is correct and the amendment is stale. This box is the
> actual fix, recorded here so the next reader of this document does not repeat the same reasoning.

**Supersedes D10 ("drop `lead_calories_per_serving`").** The column **stays**, and becomes correct
rather than being removed.

Context that forced this: food _details_ are a detail-page concern, but **every recipe card renders a
calorie number** (`RecipeCard.tsx:205`, `RecipeCard.native.tsx:146`, selected by `search.dal.ts`). So
three settled decisions collided — drop the stored column, adopt Reading B, and keep showing calories
on cards. Any two are compatible; all three are not.

**Resolution — a deliberate narrow exception, not a reversal of Reading B:**

- The recipe keeps **one** derived value, calories per serving, owned by the recipe service.
- That value is **refreshed via the substrate** when a referenced food changes. This is Reading A
  applied to a single field.
- **Detail-page nutrition stays fully live** per Reading B — no stored copy, streamed from food.
- **Lists and search touch zero food rows**, exactly as today. The fan-out concern recorded earlier
  against list rendering does not apply and is withdrawn.

**Consequences to carry into planning:**

- This gives the message substrate its **first real consumer**: a recipe-side handler that updates the
  stored calorie total when a food it references changes. The substrate stops being speculative.
- `nutrition.ts:66-69`'s "can never disagree" claim becomes _eventually_ true rather than false — there
  is a refresh window. The assertion and its test must be rewritten to say that honestly, not deleted.
- ⚠️ **The refresh path needs an alarm.** A silently-stopped refresher reproduces exactly the staleness
  this decision exists to fix, and this codebase already has three live examples of a monitor that
  cannot fire. Whatever updates this column must be observable.

## Status of R4 (standards) — landed 2026-08-15

R4 is **complete**. Recorded here so ce-plan does not re-plan it.

| Req                                           | Status   | Evidence                                                                                                              |
| --------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| R4.1 one naming regime, no hyphens            | **done** | `028f88c9` (standard + lint), `c627679d` (511 renames, every reference repointed)                                     |
| R4.2 one file, one thing                      | **done** | `1f90abc7` (AST gate), `17af5a5d`/`05b8cd7b`/`c891ae04` (9 splits), `293a21af` (rulings recorded, split debt retired) |
| R4.3 mechanically enforced, no contradictions | **done** | `02ebf2cb` (rulings + `export *` ban + stale JSDoc), `72ff7884` (17 barrels converted)                                |

Verified on the committed tree: typecheck 54/54, lint 54/54 (including both new rules), build 30/30,
tests at baseline (one known pre-existing `specTaskIds` failure in `specs/008-cooking-mode/tasks.md`).

### Residuals — small, tracked, NOT blockers

- **The 6 generated schema barrels still use `export *`.** They are emitted by `@kitchensink/contract-gen`
  and asserted verbatim by three contract suites, so converting them is generator work plus its tests
  plus three suites. The tree-shaking harm is real — they feed the web and mobile bundles.
- **`packages/apps/commise/web/.auth/` is gitignored but not prettier-ignored**, so `format:check` fails
  for anyone who has run the local web E2E suite. One line in `.prettierignore`.
- **`AccountSuspendedError` / `ImpersonationBlockedError` have no thrower and no catcher** — only their
  own test and a pass-through re-export. Possibly dead public API; deleting exported surface of a shared
  package is an owner call.
- **`specs/008-cooking-mode/tasks.md` has duplicate task IDs** (T-018/019/020), failing `specTaskIds`.
  Pre-existing, and inside the 004+ spec-only scope, so it is fixed with the respec.

### ⚠️ Landmine discovered while doing this

**`CONTRACT_HASH` fingerprints the TEXT of every module a schema transitively reaches — including
re-export plumbing.** Converting `recipe-core`'s barrel moved the hash even though every exported shape
was byte-identical; causation was proved by reverting that one file and watching the hash return.

So **a purely cosmetic edit to a shared leaf's barrel will trip contract-skew detection for pinned
consumers**, with a diff that shows no shape change and therefore no obvious cause. Anyone debugging an
inexplicable skew failure should suspect this first.

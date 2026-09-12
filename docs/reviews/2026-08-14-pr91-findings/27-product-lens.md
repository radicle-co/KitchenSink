# 27 — Product lens: premise, sequencing, and identity

**Mode**: product-lens, adversarial on premise and strategy. **Date**: 2026-08-14.
**Target**: PR 91's settled scope (fix shipped 001–003 against ~112 findings; new 014 message substrate;
food-service placeholder rows; spec/plan/task-only for 004–014; **no user-visible feature ships**).
**Method**: every claim is grounded in a file in this repo or in a sibling worktree. Technical decisions are
not re-litigated; sequencing and product strategy are.

---

## Premise challenge + verdict

### The finding that reframes the whole question: 004 is not "specs but no code"

The plan's framing — "004 gets specs, no code" — is factually wrong, and correcting it changes the answer.

`git worktree list` shows `.worktrees/004-recipe-importing` on branch `004-recipe-importing`, **16 commits
ahead of `main` and 1 behind**, last commit `483a8600 feat(imports): the import spine, file channel, typed
client and a real-page accuracy corpus` (2026-08-07). On that branch:

| Artifact                                        | Evidence                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/services/recipe-service/src/imports/` | **18,672 non-test LOC** across `channels/`, `fetch/` (1,610), `extractors/` (1,451), `drafts/` (1,560), `jobs/` (1,223), `files/` (1,095), `blocklist/` (951), `confirm/`, `dedup/`, `quota/`, `policy/`, `normalize/`, plus `imports.controller.ts` / `imports.service.ts` / `imports.module.ts` |
| Typed client + hooks                            | `packages/clients/recipe-service/src/importQueries.ts`, `importHooks.ts`, with `__tests__/importHooks.test.ts`, `importQueries.test.ts`, `client.imports.test.ts`, `import.errors.test.ts`, `__integration__/imports.integration.test.ts`                                                         |
| UI                                              | **Absent.** `find packages/apps -type d -name '*mport*'` returns nothing on that branch.                                                                                                                                                                                                          |

`specs/004-recipe-importing/.forge-status.yml:93-98` still records `complete: 9 / total: 31` and says the
typed client (T-020) is "NOT started" — the file is stale by two feature commits; `importHooks.ts` exists.
The status artifact, not the code, is what the "no code" framing is reading from.

**So the real choice is not "start import vs. fix the foundation." It is "finish and land an import backend
that is ~80% built, or let it age another cycle while the service under it is rewritten."** That is a
materially different decision, and PR 91's scope statement does not appear to know it is making it.

### The strongest case that import should ship first

1. **004's own spec names it the onboarding barrier.** `specs/004-recipe-importing/spec.md:73` — "Importing
   removes the single largest barrier to onboarding — users already have recipes elsewhere." A recipe app
   whose only ingestion path is typing a recipe from scratch has a cold-start problem that no amount of
   internal quality fixes touches. Today's ingestion surface is exactly that: `web/src/app/[locale]/recipes/new`
   and `mobile/src/screens/RecipeCreateScreen.tsx`, and nothing else.
2. **The launch plan's own gate is blocked on it.** `specs/v1-launch-plan.md:104` makes an M1 exit criterion
   "Demonstrable end-to-end against real data: create a recipe, attach an ingredient pulled from USDA,
   **import a recipe from a URL**." M2/M3 enter on M1 exit (`:115`, `:141`), M4 (Beta) enters on M2+M3
   (`:165-167`). Deferring 004 does not delay one feature; it holds the entire eight-milestone ladder at M1.
3. **The remaining scope is smaller than the spec implies.** ADR-0019 accepts as a cost that "004 ships
   **without** photo import" (`0019:158`), and `004-FR-009` (Instagram) is gated on a Meta credential that
   does not exist (`spec.md:174-178`, D-002). Launch scope for 004 is therefore **URL + structured file**.
   Both are built on the branch. What is missing is the UI — and `10-import-ux.md` in this very review
   directory is a **549-line UI design specification for exactly that**, with **zero numbered findings**
   (it contributes nothing to the 112), written as implementation guidance and then declared out of scope.
   The design cost has already been paid inside this PR and is being shelved.
4. **The delay is not free — it is a monotonically growing merge cost.** PR 91's heaviest surface is
   `recipe-service` (all of F-R, F-DB3/4/10/11/13's schema changes, the `ingredients` service/DAL rework),
   which is precisely what the 004 branch forked from. Every commit PR 91 adds widens a diff that is
   currently 1 commit behind `main`.
5. **Zero users means zero learning.** Every finding in this corpus is a static-analysis finding. Not one of
   the 112 is a complaint, a metric, or an incident, because there is no user to produce one. Fixing 112
   unobserved defects is optimizing against a model of usage, not usage.

### The strongest counter-case

1. **The foundation miscomputes the app's headline number.** `16-adversarial-live-reference.md` A-1 shows
   `nutrientPer100g` matches on name substring and **ignores `unit`** (`ingredients.service.ts:65,131`) while
   the golden-record read has **no `ORDER BY`** (`food.dao.ts:434-447`) and USDA legitimately supplies both
   kcal and kJ energy rows (`food-service/src/db/schema/food.ts:191,226`). That is a ~4.184× error in
   calories, and under live reference it can **flip after the user has seen it**. Shipping import on top
   means every imported recipe inherits it, at import scale — `004-FR-026` permits 1,000 recipes per file
   (`spec.md:299`).
2. **The same recipe already shows two different calorie counts.** Cards read the frozen
   `recipes.lead_calories_per_serving` (`search.dal.ts:82,149,201`); detail computes live
   (`recipes.service.ts:365-386`); the account export ships the frozen one (`export.mappers.ts:60`). Three
   numbers, one recipe. Import multiplies the population that exhibits it.
3. **Merging 004 now merges it against a foundation about to move.** ADR-0019 relocates the photo channel to
   011 — that is `imports/ocr/` (1,003 LOC) and its tests, plus `instagram/` (1,343 LOC) which is dead until
   Meta approves. Landing the branch as-is imports ~2,350 LOC of code the same session's ruling has
   obsoleted or dead-ended.
4. **The owner's standing bar makes "ship it rough" unavailable.** Landing a half-tested import path
   contradicts the project's own non-negotiable testing policy; the honest options are "land it to the bar"
   or "don't land it," not "land it fast."

### Verdict — committed

**The premise is half right, and the half that is wrong is the expensive half.**

Right: fixing the ingredient→nutrition path before layering import on it is correct sequencing. Import
multiplies whatever that path does wrong by every imported recipe.

Wrong: **"no user-visible feature ships in this PR" is a self-imposed constraint that nothing in the repo
forces.** The cheapest user-visible capability available is the import UI; its backend is built, its typed
client is built, and its design specification was written _inside this PR_ and then excluded. The
justification for excluding it is not a technical dependency — it is the scope statement.

**My ruling: keep PR 91's foundation thesis, cut its scope by roughly half, and add the import UI so the PR
ends with a user able to paste a URL and get a recipe.** Specifically, within the no-split constraint:

- Land the ~15 findings that sit **on the path import traverses** — the kcal/kJ unit match, the
  card/detail/export coherence, `updateResolution` replace-not-COALESCE, `addByName` name reconciliation,
  the write-on-GET constraint, provenance-aware create (`004-FR-024/025`) — first, as their own strata.
- Land the self-contained, no-004-dependency work that is cheap and real: F-SEC (14), F-I1's ALB ceiling,
  and the CI-gate test findings (F-T4/9/11/16) **early**, so later commits are checked by them.
- Merge the `004-recipe-importing` branch into this branch (consolidation, not a split), drop `ocr/` and
  `instagram/`, and build the URL + file import UI from `10-import-ux.md`.
- **Defer**: the 014 message substrate, the 004–014 spec rewrite, F-DB12/F-DB15's `DROP INDEX` halves, and
  every finding whose fix is gated on an unresolved 004/011/014 decision (F-R5's own HALT flag at
  `01-recipe-service.md:347-350`, F-F3 item 4, F-D7, F-DB16).

If that reshaping is rejected and the PR ships as written, it is not a disaster — it is a real quality gain
on a real foundation. It is simply the second-best use of the cycle, and it postpones the only event that
can tell this project whether any of the 14 features matter.

---

## Opportunity cost of deferring 004

**What the delay actually costs.**

- **The milestone ladder stalls at M1.** `v1-launch-plan.md:104` names URL import as an M1 exit criterion;
  M2 (`:115`), M3 (`:141`) and M4/Beta (`:165-167`) chain off it. 004 is not one of eight Beta features — it
  is the gate on the other five.
- **Built, tested code decays.** 18,672 LOC + a typed client sit on a branch whose base PR 91 is about to
  rewrite. Merge cost here is not linear in time; it is linear in how much of `recipe-service` PR 91 touches,
  and PR 91 touches most of it.
- **The one design artifact this PR produced for users gets orphaned.** `10-import-ux.md` is 549 lines of
  cross-platform UI design with entry points, states, and precedent citations, and it is the only document in
  a 90,062-word review corpus that describes something a user would see. Under the settled scope it executes
  nowhere. `18-adversarial-scope.md:80-84` already flags it as "an orphaned implementation doc nobody will
  execute as written."
- **No learning is purchased with the delay.** Deferring a launch normally buys information. Here it buys
  more specification. `beta-exit-criteria.md:172-181` shows every engagement, quality and sentiment threshold
  still `pending owner sign-off — provisional defaults set 2026-05-13`. Those thresholds cannot be signed off
  without users, and users cannot arrive without a shippable loop.

**Is the foundation a genuine prerequisite, or adjacent?**

| Foundation work                                                              | Prerequisite for 004?                                                                                         | Evidence                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Provenance-aware create (`004-FR-024/025`)                                   | **Yes, hard.** `RecipesService.create` hardcodes `USER_CREATED` and "cannot create an imported recipe at all" | `specs/004-recipe-importing/spec.md:51-60`                                                |
| kcal/kJ unit-blind nutrient match                                            | **Yes.** Import creates recipes at scale on the defective path                                                | `16-…:78-97`; `ingredients.service.ts:65,131`; `food.dao.ts:434-447`                      |
| Card vs detail vs export coherence (A-2)                                     | **Yes.** Import populates the frozen column at write time; the divergence scales with imported volume         | `search.dal.ts:82`; `recipes.service.ts:365-386,488`; `export.mappers.ts:60`              |
| `addByName` writing a caller's raw string as a permanent global catalog name | **Yes.** Import is a bulk producer of unreviewed ingredient strings                                           | `16-…` A-6; `ingredients.service.ts:368-382` vs the prohibition it violates at `:257-262` |
| Food-service placeholder/shell rows                                          | **No — already shipped.** Needs hardening, not invention                                                      | `18-…:245-248`; `14-…` P-2                                                                |
| **014 message substrate**                                                    | **No. Adjacent, and a solved problem.**                                                                       | see below                                                                                 |
| The 004–014 spec rewrite (10 features)                                       | **No.** 004's launch scope is URL + file; both are specified and built                                        | `0019:158`; `spec.md:174-178`                                                             |
| F-DB12/F-DB15 `DROP INDEX`                                                   | **No**, and the reviewer says not to ship them yet                                                            | `09-data-model.md`, quoted at `18-…:96-102`                                               |
| F-I1 ALB priority ceiling, F-SEC                                             | **No**, but cheap, self-contained, and worth landing                                                          | `18-…:249-251`                                                                            |

**The message substrate is the sharpest case of adjacent-dressed-as-prerequisite.** 004's own progress
screen already specifies the delivery mechanism: "**Polling** — Bounded backoff; stops at a terminal state or
on unmount" (`specs/004-recipe-importing/product-spec/wireframes/import-progress.md:17`), with the state list
`queued · running · succeeded · duplicate-found · failed · abandoned-on-unmount` (`:24`). ADR-0019 §5 itself
says the database projection is authoritative and "the messages make it _live_, they are not the only source
of truth" (`0019:125-127`). The `jobs/` module on the 004 branch (1,223 LOC) already implements the polled
status endpoint. So the substrate buys a _smoother_ spinner, not a _possible_ one — for a service (014) that
is `Status: Draft`, unimplemented, carries 55 FRs and 192,420 words of specification, and holds the largest
test-evidence gap in the portfolio (620 untested rows, `v1-launch-plan.md:292`). Building durable
guaranteed-delivery messaging before the first user sees a progress bar is the clearest opportunity-cost
inversion in the plan.

---

## Trajectory evidence

Counted, not asserted:

| Measure                                                           | Value                                            |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| Words of specification in `specs/`                                | **1,735,983**                                    |
| Non-test TypeScript source lines in `packages/`                   | **127,009**                                      |
| Ratio                                                             | **≈ 13.7 spec-words per source line**            |
| Numbered FR/NFRs across the 14 `spec.md` files                    | **369**                                          |
| Features shipped                                                  | **3** (001, 002, 003)                            |
| Features with a full V-Model artifact set and zero implementation | 005, 006, 007, 008, 009, 010, 011, 012, 013, 014 |
| Words of review prose for this one PR                             | **90,062** across 17 documents                   |

Per-feature spec volume for things that do not exist: `014-notification-service` **192,420 words**;
`011-recipe-digitization` **148,674**; `005-ai-integration` **109,386**; `013-cooking-school` **42,263** for
a two-sided video marketplace. `009-nutrition-planning`'s entire spec set is 62,470 words — **this PR's
review corpus is 44% larger than that.**

The governing documents state the trajectory explicitly. `v1-launch-plan.md:30`: "**All 14 features are in
v1 scope. No features are deferred to v2.**" `beta-exit-criteria.md:172-181`: every threshold has been
`pending owner sign-off` since 2026-05-13. `beta-exit-criteria.md:40-41` requires "On-call rotation defined
for the duration of Beta; pager alerting wired" and "a documented incident-response runbook" before the
waitlist opens — for a solo developer.

**Direct answer: this is heading toward an ever-more-perfectly-specified system, not a shippable v1.** Three
supporting facts, each citable: (1) the ratio — 1.7M words of spec against 127k lines of code, with ten
features fully specified and zero implemented; (2) the shape of this PR — the largest single work item in
months delivers no user-visible capability while adding a spec rewrite across ten features; (3) the gate
design — a "Beta" that requires eight features, a 24/7-capable on-call rotation, an NPS sample of n≥100, and
a payments-compliance review, none of which a zero-user solo project can satisfy, and all of which sit
_before_ the first user.

The counter-signal is real and should be stated: the specification discipline is what makes 18,672 LOC of
import code landable by one person with agents, and the review corpus found genuine defects (the kcal/kJ
error is a serious one). The problem is not that specification happens; it is that specification is the
**only** thing that has happened for eleven features, and PR 91 proposes more of it.

---

## Product identity

**The core, and it is coherent**: 001 recipes · 002 auth · 003 ingredients · 004 import · 006 meal planning ·
007 grocery lists · 008 cooking mode. Get recipes in, plan the week, shop for it, cook it. That is a product
with one buyer (a home cook), one loop, and one value proposition, and `beta-exit-criteria.md:79` names the
right metric for it ("signup → first saved recipe ≤ 3 minutes").

**Adjacent, defensible**: 011's digitization half. It is a second import channel with real depth
(handwriting, batches, per-token confidence, correction UX). But 011 is two products in one feature number:
ADR-0019 itself has to rule "**Do not collapse the image service and Circles**" (`0019:88-90`), because 011
also owns Family Circles, a private invite-based sharing primitive with its own deployable
(`specs/011-recipe-digitization/spec.md:28` — "Three new packages"). A sharing primitive is not a
digitization feature; it is a social layer that arrived inside an OCR spec.

**Adjacent products being built into the same app:**

- **009 Nutrition Planning is a trainer-client health SaaS.** "A personal trainer or diet-conscious user
  creates nutrition plans… the trainer-client model" with a `trainer_clients` table
  (`009/plan.md:88-95`), classified as **GDPR Article 9 special-category health data**
  (`009/plan.md:26-34,197,418`), triggering a DPIA and physical data isolation as ADR-0017's recorded flip
  condition (`009/plan.md:167`). Different buyer (a trainer), different compliance regime, different sales
  motion — bolted onto a recipe app with zero users.
- **012 Creator Profiles is a creator network.** `@handle` pages, follows, follower feeds, embed widgets, a
  tip jar and a creator-earnings surface (`012-FR-031`…`034`). `v1-launch-plan.md:262` records the
  consequence honestly: marketplace payments "need their own spec, including the money-transmission and tax
  posture that splitting third-party revenue implies." That is a regulated business, not a feature.
- **013 Cooking School is, in its own words, "a two-sided video learning marketplace… touching video
  infrastructure, payments, AI drafting, and creator identity"** (`013/spec.md`). It is in v1 scope
  (`v1-launch-plan.md:47`, M7). This is a second company sharing a repository.
- **014 Notification Service** is infrastructure, correctly identified as cross-cutting, but 55 FRs and
  192k words of it before a single notification has a user to reach.

**Verdict on identity: the product knows what it is for the first seven features and then stops.** Features
009, 012 and 013 are three distinct product lines with three distinct buyers (trainer, creator, educator) and
three distinct compliance regimes (Article 9 health data, money transmission, video/payments), all held
inside a "v1" that explicitly defers nothing. Nothing in the corpus records this as a deliberate positioning
bet — it reads as accumulation, which is the tell. The bet may be right; it is currently implicit, and an
implicit bet of this size is the thing to make explicit before another word of 013 is written.

---

## Live reference as user-facing behaviour

**Framed as product, the question is: what does a user think "my recipe" is?**

For a recipe they authored, the mental model is a document — the thing they wrote, unchanged until they
change it. For a recipe's _derived_ nutrition, the model is softer, because users know nutrition is an
estimate. So the answer is not obvious, and live reference is defensible. But three things in the repo make
the current position untenable as _product behaviour_, independent of the architecture.

**1. This repo already ruled the opposite way, for a lower-stakes field, and nobody noticed the conflict.**
`specs/001-commise-recipe-app/spec.md:136` (FR-011), on cloning a collection:

> "The clone is a snapshot at clone time… future changes to the source collection **MUST NOT propagate
> automatically**… MUST expose a user-initiated '**Pull updates from source**' action… opt-in per invocation."

That is precisely the rejected design — pin plus explicit user-initiated refresh — chosen for _collection
membership_. A dieting user's calorie count is a higher-stakes number than which recipes are in a folder, and
it gets the weaker guarantee. The inconsistency is a positioning statement ("your content is stable, your
numbers are not") that no document has made deliberately.

**2. The user does not currently get one answer, or even two — they get three.** The card reads the frozen
`recipes.lead_calories_per_serving` (`search.dal.ts:82,149,201`), written only at create/update/clone
(`recipes.service.ts:488,649,779`) and skipped entirely when only the title changes (`:647`). The detail
computes live from the catalog (`:365-386`). The account export ships the frozen value
(`export.mappers.ts:60`). So one recipe reports one number on the list, another on the detail, and the list's
number in the user's data export. **No user expects that, and no framing of "live vs snapshot" produces it.**
It is a bug that a real user hits within one session of scrolling from a list to a detail — and the codebase
asserts it is impossible: `packages/shared/recipe-core/src/nutrition.ts:66-69` claims the two "**can never
disagree**." The repo holds itself to the opposite standard for the analogous field: 001-FR-013a
(`spec.md:148`) demands the rating aggregate be "consistent with the ratings it summarizes **at all times**"
and enforces it with a database trigger. Calories get neither trigger nor constraint.

**3. Under live reference, one user's typo becomes every user's ingredient name.** `addByName` writes the
caller's raw trimmed string as the shared catalog row's name and seeds the search vector with it
(`ingredients.service.ts:368-382`), and it is never reconciled when the food later resolves. The sibling path
`addByFoodId` refuses to do this and says why, 110 lines earlier: it would "attach an arbitrary label to a
real food in a catalog that is ownerless and shared by every user — **mislabeled nutrition for everyone**"
(`:257-262`). As product behaviour: a shared, ownerless catalog with an unmoderated write path is a
user-generated-content surface nobody has designed a UGC policy for.

**Product verdict.** Live reference is the right _default_ for a forward-looking cooking app — 006 reached it
independently with reasoning (`specs/006-meal-planning/spec.md:345-347`) — but it is only honest product
behaviour if three things are true, and none is today:

- **One number.** Pick card-live or column-maintained and enforce it; delete the false "can never disagree"
  claim either way. This is the blocker, not the philosophy.
- **Disclosed.** If a saved recipe's calories can change, the nutrition panel must say it reflects current
  food-database values, and — once a timestamp exists on `ingredients` — when it last changed. The existing
  partial-nutrition disclosure is the natural home. Silent change is the version users will call a bug.
- **Bounded to forward-looking surfaces.** Recorded past outcomes (009's `nutrition_compliance.actual_*`)
  must pin at record time. "What I actually ate on 1 June" retroactively changing in August is not a
  freshness feature; it is a broken diary, and it is free to carve out now because 009 does not exist.

---

## What to cut / keep

**Cut, to reach a usable product fastest:**

1. **The 004–014 spec rewrite in this PR.** Reviews 11–15 found ADR-0019 self-contradictory in load-bearing
   places (`14-…` P-3, P-4, P-8, P-10, P-11, P-12, P-13). Rewriting six features' tasks and plans against a
   contested ADR risks doing a 90-file rewrite twice.
2. **The 014 message substrate.** Polling is already the specified design (`import-progress.md:17`), the
   polled endpoint is already built (`imports/jobs/`, 1,223 LOC), and ADR-0019 §5 already makes the DB
   projection authoritative. Build the substrate when a second consumer exists.
3. **Instagram (`004-FR-009`)** — 1,343 LOC on the branch, gated on a Meta credential that does not exist
   (D-002, `spec.md:174-178`). Do not merge dead code.
4. **F-DB12 / F-DB15's `DROP INDEX` halves**, per the reviewers' own instruction that they "should not ship
   on reasoning alone" (`18-…:96-102`). The additive `CREATE INDEX CONCURRENTLY` halves can land.
5. **013 Cooking School, and 012's monetization surface, out of v1.** A two-sided video marketplace and a
   money-transmission posture are not v1 of a recipe app. `v1-launch-plan.md:30`'s "no features deferred to
   v2" is the single highest-leverage line to reverse.
6. **009's trainer-client half out of v1.** It imports Article 9 health-data obligations and a DPIA
   (`009/plan.md:26-34,167`) into a product with zero users. A personal macro target does not require it.
7. **011's Circles half out of the first launch**, explicitly. ADR-0019 already refuses to collapse it;
   say out loud that it is not in the launch path.
8. **The enterprise launch apparatus in `beta-exit-criteria.md` §2.2/§2.4** — on-call rotation, pager
   alerting, 24/7 launch-week coverage, NPS with n≥100, a rehearsed emergency-revoke procedure. Keep error
   tracking, structured logging, a privacy policy, ToS and a feedback channel; cut the rest until there is a
   user to page someone about.

**Keep regardless of anything above:**

1. **The kcal/kJ unit-blind nutrient match, plus a deterministic `ORDER BY`.** A 4.184× error in the headline
   number of a food app is not a quality nicety.
2. **One calorie number per recipe** across card, detail and export — and delete `nutrition.ts:66-69`'s false
   claim, which will otherwise cause the next engineer to skip the invalidation.
3. **`updateResolution` replacing rather than `COALESCE`-ing the macro block**, so a row's four macros share
   one as-of basis.
4. **`addByName` adopting the golden-record name on resolution**, keeping the user's wording on
   `recipe_ingredients.display_text`.
5. **Provenance-aware create (`004-FR-024/025`).** Without it no import can produce an imported recipe.
6. **Constraining the write-on-`GET` at `/api/v1/ingredients/:id/status`** — a shared, ownerless row rewritten
   by any authenticated poller is a product-visible correctness problem, not just an architectural one.
7. **F-SEC (14 findings) and F-I1's ALB priority ceiling** — self-contained, no 004 dependency
   (`18-…:249-251`).
8. **The CI-gate test findings (F-T4/9/11/16), landed early** so the rest of the pass is checked by them
   rather than concurrent with them (`18-…:192-198`).
9. **The TDD and quality bar itself.** It is the reason an 18,672-LOC import backend written largely by
   agents is landable at all. Cutting scope is the lever; cutting rigor is not.

---

## Where the plan is right

- **The findings are real and the inventory is honest.** An independent count reproduces exactly 112
  (`18-…:9-18`), and reviewers flagged their own unverifiable recommendations as caveats rather than facts.
  This is not a make-work pass.
- **Sequencing quality before import is directionally correct.** Import multiplies whatever the
  ingredient→nutrition path does wrong by every imported recipe, at up to 1,000 recipes per file. The
  instinct to fix the multiplier first is right; only the _scope_ of "fix" is wrong.
- **Live reference as a philosophy holds for forward-looking surfaces**, and 006 reached the same conclusion
  independently with recorded reasoning (`006/spec.md:345-347`). That is genuine corroboration, not
  post-hoc agreement.
- **The food-service placeholder/shell model is well-chosen and already shipped** — five independent passes
  converge that it needs hardening, not invention (`18-…:245-248`).
- **The recipe-is-a-method prohibition survives intact.** A shell is a food in a pending state, not a recipe
  written into the food database, and the one-writer rule is untouched (`0019:129-134`, confirmed at
  `14-…:507-512`).
- **Moving photo/OCR to 011 resolves a genuine two-owner conflict.** Two accepted specs each owned the photo
  channel; the ruling is supported on the evidence (`14-…` P-14). The mobile on-device / web server-side
  split is a sound cost decision that also keeps the mobile path usable offline.
- **Declining to write code against a contested ADR is right.** The mistake is only in what follows from it:
  "don't build on unsettled specs" should lead to settling the two questions that gate real code
  (FR-045's watermark, FR-026's sequence naming) and shipping the settled channel — not to rewriting ten
  features' specs.

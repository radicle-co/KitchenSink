---
title: 'feat: A cached, corrected, two-engine ingredient parse pipeline — and the structured entry surface it does not serve'
type: feat
date: 2026-08-23
origin: docs/brainstorms/2026-08-19-ingredient-resolution-quality-requirements.md
---

# feat: A cached, corrected, two-engine ingredient parse pipeline

## Summary

Replace the leading-quantity-only ingredient parser on the **import** path with a pipeline: a human
correction tier that outranks every machine, a parse cache keyed on engine version, and two independent
engines — a Python CRF Lambda and an LLM parse — run in parallel and **compared** rather than chained.
Neither engine sees the other's output. Agreement caches; disagreement takes a field-level winner and
flags the line.

The interactive write path is **not** a consumer of this pipeline and never becomes one. It is already
structured — `recipeIngredientInputSchema` requires a resolved `ingredientId`, and `parseIngredientLine`
has exactly one non-test caller in the repository, the offline cookbook importer. But that surface has
three gaps the pipeline throws into relief: the unit field has no vocabulary, there is no preparation
field, and there is no dry/wet attribution. Those are a wire-contract change and are planned here in the
same document, deliberately, because both halves turn on the same two facts — what a measurement is, and
where identity ends and preparation begins.

⛔ **The frontend half is BLOCKED on mockups.** Units U10–U14 must not begin until the Figma Make output
lands (`docs/mockups/briefs/recipe-ingredient-entry-figma-make-prompt.md` is the brief). The backend half,
U1–U9, has no such dependency and proceeds now.

---

## Problem Frame

### What the parser does today, and why it is not enough

`parseIngredientLine` (`packages/shared/recipe-import-core/src/ingredientLine.ts:216`) reads the **leading**
quantity phrase and treats everything after it as the food name. That produces one `ParsedIngredientLine`
with a single `name`, a single `unit`, and a quantity modelled honestly as `exact | range | absent`.

Three shapes defeat it, all measured 2026-08-23:

1. **A second measurement.** `2 cups and 1 tablespoon flour` reads as 2 cups, with `and 1 tablespoon`
   folded into the name and `reviewReasons` **empty** — nothing downstream knows the persisted value
   understates the line. Partially addressed since (`measurement_in_name`, `splitMeasurement.ts`), but the
   segmentation is incomplete; see U16.
2. **More than one food on one line.** `salt and pepper to taste` is two foods sharing a measurement. The
   contract has one `name` and no place to put the second.
3. **Identity versus preparation.** `Garlic, minced` persists as a food named "Garlic, minced". The 001
   wireframe does the same thing, so the conflation is in the design as well as the code.

### Why two engines, and why they must not see each other

Measured today, the two engines fail in **opposite** directions:

- The **CRF** (`ingredient-parser-nlp`, MIT, trained on 81k sentences, 95.62% sentence accuracy) is
  deterministic, native to composite amounts, and exact on fractions. It is blind to historical units and
  its `foundation_foods` resolution is wrong often enough to be unusable — it mapped soy flour incorrectly
  in the sample.
- The **LLM parse** (Nova Micro, the 511-byte prompt resolved 2026-08-23) separates identity from
  preparation cleanly, handles multi-food lines, and reads historical measures. It is nondeterministic
  even at temperature 0, and it is the weaker of the two on numbers.

Chaining them — call the CRF, judge its output, escalate on failure — was rejected for a reason that is
both a design argument and an owner instruction: **there is nothing intelligent judging the CRF's result**,
so an escalation trigger would have to be invented, and any trigger we invented would be a fourth
hand-rolled heuristic of exactly the kind this plan exists to remove. Worse, feeding the CRF's failed parse
to the model as context makes the second call a _re-try of the first_ — the model anchors on the answer it
was shown. ⛔ **Nothing from the CRF's output, and no signal derived from it, is ever placed in the LLM's
prompt.** The prompt sees the source line and nothing else.

So both engines run on every cache miss, in parallel, blind to each other. **Disagreement is the signal.**
That is what replaces the judge we do not have.

### What this costs

Nova Micro at the measured prompt size is $0.000011 per line — $0.54 for 50,000 distinct lines. The cache
means each distinct line is paid for once. This is not the expensive part of the system; the CRF Lambda's
cold start is.

### The precedent that governs the comparison

⚠️ `convertHistoricalUnit` returns a **stated** pair and a **restated** pair, and an earlier defect showed
only the restated one to the verification gate — presenting `0.5 cup` beside a source reading `one gill of
milk` and asking whether they agree. That manufactured a false disagreement about a line parsed correctly.
Any comparator built here compares the **stated** pair. Migration `0027_ingredient_stated_measure.sql`
persists it.

---

## Scope Boundaries

**In scope**

- The import parse path: `cookbook-import`, and the seam 017's capture waterfall will feed.
- The parse cache, the correction tier, the comparator, and both engines.
- The structured-entry contract gaps: unit vocabulary, preparation, attribution.
- The two stashed open items (U15, U16).

**Out of scope**

- **Food identity resolution.** `resolutionCascade.ts` already owns tiers 1–3 and the termination rule.
  This pipeline produces the _name_ the cascade then resolves; it does not resolve anything itself.
  ⛔ The CRF's `foundation_foods` output is **rejected outright** — accepting it would be a second,
  unowned resolution authority beside the cascade, and it is measurably wrong.
- **The verification gate.** It is post-resolution by construction (`resolutionCascade.ts` states this
  explicitly) and is not a tier of anything this plan builds.
- **A user-facing ingredient-line parser.** The write path stays structured. Nothing here is wired to it.
- **017's capture waterfall.** It produces the text this pipeline consumes; it is planned separately.
- Fixing the shared-`baseStage` USDA key overrun found during research — logged, not planned here.

---

## Key Technical Decisions

### KTD-1 — Both engines always; the comparator is the judge

Rejected: CRF-first with escalation on a confidence signal. The CRF emits per-component confidence, but
using it as an escalation gate makes a hand-tuned threshold the arbiter of when we pay for a model — the
same class of hand-rolled heuristic the pipeline replaces, and one nobody can calibrate without the
disagreement data this design produces. Running both is cheaper than being wrong, and it yields the
adjudication corpus we have never had.

### KTD-2 — Field-level winner, and the flag must be SHAPE-AWARE, not binary

On disagreement: **amounts from the CRF** (exact fractions, deterministic, composites native),
**identity and preparation from the LLM** (measured better on both), **historical units from the LLM**
(the CRF is blind to them).

⛔ **Measured 2026-08-23, and it reshapes this decision: the two engines agree on all three fields for
only 49.17% of ingredient lines** (Nova Micro, n = 1,379; Pro ties at 49.53%). Per field the picture is
better — measure 75.6%, food names 63.3%, preparation 69.0% — so the 49% is a _conjunction_ of three
imperfect agreements, not a catastrophe in any one. But it means a binary "disagree ⇒ flag" rule flags
**half the corpus**, which is not a review queue; it is the corpus with extra steps. A flag that fires on
half of everything is how a real signal gets muted — the same failure `contractSkew.ts` names.

So the comparator classifies the disagreement's **shape**, and only some shapes reach a human. Measured
distribution (Nova Micro, ingredient lines):

| shape                                                                      |   n | disposition                                                                  |
| -------------------------------------------------------------------------- | --: | ---------------------------------------------------------------------------- |
| `differ` (unstructured name disagreement)                                  | 354 | ⚠️ **the genuine adjudication list** — 25.7% of lines                        |
| `quantityDiffers` (units agree, numbers do not)                            | 114 | CRF wins, record both                                                        |
| `amountCountDiffers` (different NUMBER of amounts read)                    |  92 | CRF wins; this is the composite case U16 touches                             |
| `unitDiffers`                                                              |  81 | CRF wins, record both                                                        |
| `crfUnitInName` (CRF swallowed the unit into the food)                     |  25 | **LLM wins silently** — the CRF is demonstrably wrong (`"a little vinegar"`) |
| `crfSizeField` (CRF routed `large`/`small` to a field we have no slot for) |  24 | see U1 — a contract hole, not a disagreement                                 |
| `modelSplitsFoods`                                                         |   7 | **LLM wins silently** — this is the multi-food case the CRF cannot express   |
| `modelPrepInCrfName`                                                       |   4 | **LLM wins silently** — identity-vs-prep, the LLM's measured strength        |

That reduces what a human ever sees from ~700 lines to the 354 `differ` cases, and it does so on evidence
rather than by tuning a threshold.

⚠️ Still observe-only at first: a flagged line imports. U11's error asymmetry transfers directly — a wrong
agreement passes data that would have shipped anyway; a wrong disagreement withholds a correct line, which
is worse than today. Observe-only is the resting posture, not the fallback.

⚠️ **These rates are measured on one 1919 cookbook** and are upper bounds (1,148 blocks were skipped
whole, 673 of them for `too_few_ingredients`). Historical prose is the hardest text this pipeline will
ever see; a modern line like `2 cups all-purpose flour` should agree far more often. Do not carry 49% into
a capacity estimate for modern imports without re-measuring.

### KTD-3 — An unavailable engine is not a disagreement

`contractSkew.ts` states the rule: _"ABSENCE IS SILENCE, never a mismatch… Reporting those as skew would
make every pre-publication deployment noisy, which is how a real warning gets muted."_ If the CRF Lambda
throws or the LLM is denied by the ADR-0024 ceiling, the outcome is `single-engine`, carrying which engine
answered — never `disagree`. Collapsing the two is how a transient degradation becomes a permanent fact
about an ingredient, the same error `resolutionCascade.ts` calls out for `unavailable` vs `consulted`.

### KTD-4 — One cache row per engine, not one per line

The nearest precedent, `recipe_ingredient_verifications`, stores `model_id` as an **attribute** and
versions the _derivation_ — swapping models does not invalidate cached verdicts. That is right for a
judgement and wrong here. A comparison pipeline needs both engines' outputs to coexist, so the cache is
keyed `(lineDigest, engine, engineVersion)` and the merged result is derived, not stored as the only row.
A CRF version bump re-partitions only the CRF rows; the LLM half survives, and the comparator re-runs
against the new pairing.

The key module copies `verificationKey.ts` wholesale in shape: `{version}:{sha256hex}`, a **JSON array**
preimage (never a concatenation — `unit:'cup' + foodId:'X'` and `unit:'cupX' + foodId:''` collide, and
that is the worst possible cache hit because it looks like a saving), NFC + whitespace normalization with
case **not** folded, and an exported `PARSE_KEY_VERSION` carrying the ⛔ bump rule. The digest arrives as a
Port so `recipe-core` stays a zod-only dependency leaf — `contract.test.ts` asserts that property because
web and mobile bundle it.

### KTD-5 — The cache stores a digest and a parse; the correction table stores the person

Two tables, two erasure treatments, and the split is deliberate.

- **`ingredient_parse_cache`** is keyed by digest and stores structured output. It holds no owner link,
  the same property that keeps `recipe_ingredient_verifications` out of the erasure sweep. ⚠️ Its
  `foods[].name` is a fragment of user-typed text; the mitigation is that the row is shared installation-
  wide and keyed by digest, so it carries no person-to-row link to erase. This is asserted, not assumed —
  U5 adds the test.
- **`ingredient_parse_corrections`** holds what a cook typed and who typed it, so it takes the memo
  treatment from migration `0026`: nullable `owner_id`, a partial index `WHERE owner_id IS NOT NULL`, the
  text column's `NOT NULL` dropped in the **same** expand-first migration as the sweep, and a
  **de-identifying `UPDATE`, never a `DELETE`** — the row is consulted by every user's pipeline, so
  deleting it would silently un-correct that line installation-wide. `owner_id` and the text move as a
  pair or not at all.

### KTD-6 — The correction tier reuses `mappingScopePolicy`, applied to a different subject

The scope question is identical knowledge: a held grant writes globally on first correction; every other
correction stays author-scoped until a second independent user corroborates it. That is one business rule,
so it has one representation. What differs is the _subject_ — a parse rather than a phrase→`food_id`
mapping — which is a parameter, not a second rule. ⚠️ If implementation finds the policy's inputs cannot
be satisfied without distorting them, that is evidence the two are not the same knowledge after all;
duplicate rather than over-DRY, and record why.

### KTD-7 — The CRF is a new deployable, and the exception is written, not assumed

ADR-0017 sets **"no new deployable service"** as the default. ADR-0019 §3 is the template for the
exception and its three grounds fit almost verbatim: the workload is CPU-shaped and bursty rather than
request-shaped, it carries a vendor dependency the recipe service should not link, and it scales on a
different axis from recipe CRUD. ADR-0019 also fixes the consequence: **the new deployable owns no
database**, so the parse cache lives in the recipe database, not beside the engine.

Shape: **a new package with its own stack and no `esbuild.mjs`.** The W2 packaging guard
(`serviceInfraWiringInvariants.test.ts:591`) skips a service with no `esbuild.mjs` — its own comment
anticipates exactly this ("it packages its Lambdas some other way"). That is the honest route. A container
image would instead force an amendment to `RecipeWorkersStack.test.ts:511`, which reads
`fn.Properties?.Handler` unguarded and whose docstring explicitly warns against letting a real Lambda
"leave the guard by looking like a provider."

⛔ Three things this owes, none optional. **(a)** A Python runtime pin beside `NODE_LAMBDA_RUNTIME` with a
sibling of `lambdaRuntime.test.ts` — cdk-nag's `AwsSolutions-L1` is family-generic and will flag
`python3.13` the moment CDK ships a newer Python. **(b)** A GR-008 ruling: the rule says every workspace
targets Node 24 and does not contemplate a second runtime. **(c)** Its **own** packaging guard. W2 skipping
is honest but it is also a hole, and it is the same hole `handle-sync-worker` fell through — that Lambda
shipped 4.6 KB of raw `tsc` output against siblings of 436 KB–981 KB and died on every cold start with
`ERR_MODULE_NOT_FOUND`, while _"two guard tests missed it because both enumerated the same five names…
a copy of a list cannot detect that the list is incomplete."_

### KTD-8 — The LLM leg is a new consumer of the ADR-0024 ceiling, not a new ceiling

There is ONE ceiling: $100/month, prod only, enforced by reserve-then-settle against
`verification_spend`. The parse leg reserves and settles through the same counter with its own
`callSite`, so a runaway in either path is bounded by the same dollar figure. ⛔ Settle is never retried;
any outcome with no billed response refunds in full. Sandbox and `pr-{N}` call ungated, per ADR-0024.

⚠️ This raises a real question the plan does not close: the ceiling was sized for verification alone, and
017 also proposes charging its capture tiers to it. Three consumers on one $100 ceiling means the first to
burn it denies the other two. Recorded as an open question, not decided here.

### KTD-9 — `ParsedIngredientLine` becomes a projection, not a widened interface

The new pipeline yields multiple foods, each with a preparation, plus a stated measure. Widening
`ParsedIngredientLine` in place would break its one caller and, worse, would make the _narrow_ shape the
canonical one. Instead a new `ParsedLine` is the canonical output, and `ParsedIngredientLine` becomes a
documented **projection** of it — first food, measure flattened — so today's caller keeps compiling while
the richer fact is available to anything that wants it. New members arrive as **required keys with
nullable values, never optional**, so every construction site becomes a compile error rather than
silently keying the old way.

---

## Implementation Units

### Backend — proceed now

#### U1 — The `ParsedLine` contract and its projection

**Goal.** One canonical parse result carrying many foods, per-food preparation, and the stated measure;
`ParsedIngredientLine` preserved as a narrowing projection.

**Files.**

- Create: `packages/shared/recipe-import-core/src/parsedLine.ts`
- Modify: `packages/shared/recipe-import-core/src/ingredientLine.ts`, `.../src/index.ts`
- Test: `packages/shared/recipe-import-core/src/__tests__/parsedLine.test.ts`

**Approach.** `ParsedLine` carries `raw`, `statedMeasure`, `quantity` (the existing `exact|range|absent`
union), `unit`, `foods: readonly { name, prep }[]`, `reviewReasons`, and `provenance` naming which engine
produced each field. `projectToIngredientLine(parsed)` returns today's shape and documents what it drops.

⛔ **A contract hole the measurement exposed, and this unit must close it.** The CRF emits a `size` field
— `large`, `small` — and our shape has nowhere to put it (`crfSizeField`, 24 lines). Dropping it loses
what the source said; folding it into `name` recreates the identity-vs-prep conflation this whole plan
exists to remove (`large onion` is not a distinct food from `onion`); folding it into `prep` is a lie,
because a size is not something the line tells the cook to do. It is a third thing — an unmeasured
qualifier of the food — and it needs its own nullable member. Decide it here, with the 24 lines in hand,
not at the call site later.

**Execution note.** Test-first. The projection's lossiness is the thing under test.

**Test scenarios.** Multi-food line projects to the first food and raises a review reason naming the
dropped ones · a single-food line round-trips with no review reason · preparation is never concatenated
into `name` in either direction · a stated measure survives projection · `absent` quantity is preserved,
never coerced to `0` or `1` (R40) · every construction site of the old shape still compiles.

**Verification.** `npm run test --workspace=packages/shared/recipe-import-core` green; `parseIngredientLine`'s
existing suite unmodified and passing.

---

#### U2 — The CRF engine: package, Lambda, runtime pin, packaging guard

**Goal.** `ingredient-parser-nlp` reachable as a deployed function, with the guards its novelty requires.

**Files.**

- Create: `packages/services/ingredient-parser/` (Python source, its own CDK stack under `infra/`, no
  `esbuild.mjs`), `packages/infra/security/src/pythonLambdaRuntime.ts`
- Create tests: `packages/infra/security/src/__tests__/pythonLambdaRuntime.test.ts`,
  `packages/services/ingredient-parser/infra/__tests__/packaging.test.ts`
- Modify: `docs/architecture/decisions/0004-minimize-nat-egress.md` (the `nat-consumers` table, **only if**
  the function is VPC-attached — it should not be; it needs no database)

**Approach.** A zip-packaged Python Lambda (32 MB zipped, 102 MB unzipped — inside the 250 MB limit, and
CDK publishes assets through S3 so the 50 MB direct-upload limit does not bind). No VPC attachment: it
holds no state and reaches no database, so it stays off the NAT entirely. Its response is an **inbound
boundary** under ADR-0015 §3 — validated against an authored zod on receipt, before it becomes anything.

⛔ The packaging guard is the unit's real deliverable. It must **derive** what it checks from the
filesystem or the synthesized template — never enumerate a list — and carry a non-vacuity floor, per the
shape every guard in `packages/infra/global/__tests__/` was rewritten into after a hand-maintained list
failed.

**Execution note.** Test-first, and the guard tests come before the stack.

**Test scenarios.** The synthesized function's runtime equals the pinned constant · the pin equals the
newest Python runtime CDK knows (cdk-nag L1 parity) · the asset actually contains the model artifact and
the handler module · the guard fails when the model artifact is removed (mutation check) · the guard's
subject set is non-empty · no `InterfaceVpcEndpoint` is introduced · a malformed engine response is
refused at the boundary rather than propagated.

**Verification.** `npm run test --workspace=packages/infra/global` green including `natEgressConsumers`;
stack synthesizes; a deployed invocation returns a parse for a known line.

---

#### U3 — The LLM parse leg

**Goal.** An independent parse from Bedrock, charged to the ADR-0024 counter, structurally unable to see
the CRF.

**Files.**

- Create: `packages/services/recipe-workers/src/parsing/llmParse.ts`,
  `packages/shared/recipe-core/src/parsing/parsePrompt.ts`
- Modify: `packages/services/recipe-workers/src/verification/spendArithmetic.ts` (a second `callSite`)
- Test: `packages/services/recipe-workers/src/parsing/__tests__/llmParse.test.ts`

**Approach.** The prompt is the resolved 511-byte form, versioned by an exported constant that
participates in the cache key. Response validated against an authored zod; a `malformed_model_output`
stop reason is recorded as a structured-output failure and **never silently retried**, taking the same
fail-closed route as `ServiceUnavailableException`.

**Model: Nova Micro**, on measurement rather than assumption. On ingredient lines it returns a
schema-valid answer 99.07% of the time against Pro's 99.64%, and the two are a statistical tie on CRF
agreement (49.17% vs 49.53%) — so Pro buys 0.57 points of compliance for **20.9× the cost**
($0.2385 vs $0.0114 per 1,000 lines). Nova Lite is rejected: it fences 77.7% of its answers in
` ```json `, and its agreement row rests on a self-selected 29% slice.

⛔ **The zod must accept `"measure": null` as well as `""`.** That single behaviour is 503 of Micro's 508
non-compliant responses and 267 of Pro's 268 — it fires almost only where the line states no measure, i.e.
the model is answering correctly in a shape we did not specify. Rejecting it would discard ~1% of good
answers and mis-attribute a schema decision as a model failure. ⚠️ `null` and `""` must normalize to the
**same** absent-measure value, or the cache key partitions on a distinction that carries no meaning.

⚠️ Claude Haiku 4.5 remains **unmeasured, not rejected** — it could not be invoked from this account
(`ResourceNotFoundException: Model use case details have not been submitted`). The Bedrock invocation-id
plan is the prerequisite for measuring it.

⛔ The prompt builder takes the source line and nothing else. Its signature must make a second argument
impossible, so that "pass the CRF's output as context" is a compile error rather than a code review.

⚠️ In-flight collision: a running agent is adding Nova rate entries to `spendArithmetic.ts`, and
`docs/plans/2026-08-23-001-fix-bedrock-invocation-id-and-iam-plan.md` (P3, P5 outstanding) is changing how
the invocation id resolves. Land after it, or rebase onto it.

**Execution note.** Test-first.

**Test scenarios.** The builder cannot be handed engine output (type-level) · a line containing
instruction-like text is treated as data · a malformed response fails closed and refunds in full · a
ceiling denial is transient and retries under `maxReceiveCount` · reservation charges `input + maxTokens`
before the call · settle carries the period key captured at reserve, not recomputed · an over-cap line is
rejected, never truncated.

**Verification.** Unit suite green; one live invocation against sandbox returns a schema-valid parse.

---

#### U4 — The comparator

**Goal.** A pure policy deciding what the merged parse is and what the disagreement was.

**Files.**

- Create: `packages/shared/recipe-import-core/src/domain/parseComparator.ts`
- Test: `.../src/domain/__tests__/parseComparator.test.ts`

**Approach.** Specification/policy module, the sibling of `mappingScopePolicy` and `evaluateProvenance`:
pure, total, table-testable, no I/O. Inputs are two `ParsedLine | EngineUnavailable` values; the output is
a merged `ParsedLine` plus a `ParseAgreement` discriminated union — `agree`, `differ` (naming the fields),
`single-engine` (naming which), `neither`.

⛔ Compares the **stated** measure pair. ⛔ `single-engine` is never `differ` (KTD-3).

**Execution note.** Test-first. This is the unit whose test table is the design.

**Test scenarios.** Identical parses agree · differing amounts take the CRF and report `differ` · differing
food identity takes the LLM · a historical unit the CRF missed takes the LLM and does not report a
disagreement on the measure · one engine unavailable yields `single-engine`, never `differ` · both
unavailable yields `neither` and resolves nothing · a restated measure never enters the comparison ·
merging is deterministic under argument order.

**Verification.** Unit suite green; mutation check — inverting any winner rule fails ≥2 tests.

---

#### U5 — The parse cache

**Goal.** One row per `(lineDigest, engine, engineVersion)`, with a version-bump rule that cannot rot
silently.

**Files.**

- Create: `packages/shared/recipe-core/src/parsing/parseKey.ts`,
  `packages/services/recipe-service/src/database/migrations/0028_ingredient_parse_cache.sql`,
  `packages/services/recipe-service/src/database/schema/ingredientParseCache.ts`,
  `packages/services/recipe-service/src/ingredients/dal/parseCache.dal.ts`
- Test: `packages/shared/recipe-core/src/parsing/__tests__/parseKey.test.ts`,
  `packages/services/recipe-service/__tests__/integration/ingredients/parseCacheSchema.integration.test.ts`

**Approach.** Per KTD-4 and KTD-5. Migration lands with the long `--` header the repo's convention
requires, stating the key choice, the alternatives rejected, and the `EXPAND-ONLY (ADR-0022)` clause. SQL
files live in **recipe-service's** migration directory even though recipe-workers reads the table — SQL
filed elsewhere is never applied.

**Execution note.** Test-first, and the schema assertion runs against a real database. _"A constraint is
not believed until a real database has refused something."_

**Test scenarios.** Two different preimages never collide · the JSON-array preimage distinguishes
`unit:'cup'/foodId:'X'` from `unit:'cupX'/foodId:''` · case is not folded · a version bump partitions
cleanly and old rows stay reachable by prefix · the same line under two engines yields two rows · the
table holds no owner column and no user-identifying text beyond the parse · `recipe-core` still has no
non-zod runtime dependency (leaf property).

**Verification.** Integration tier green against Docker Postgres; `contract.test.ts` leaf assertion green.

---

#### U6 — The correction tier

**Goal.** A cook's correction outranks both engines, scoped by the existing policy, and is erasable.

**Files.**

- Create: `.../migrations/0029_ingredient_parse_corrections.sql`,
  `.../schema/ingredientParseCorrections.ts`, `.../ingredients/dal/parseCorrections.dal.ts`
- Modify: `packages/services/recipe-workers/src/handlers/accountErasureWorker.ts` (a twelfth numbered
  step, and the docstring above `eraseRecipeRows` in the same edit)
- Test: `.../__tests__/integration/erasure/parseCorrectionErasure.integration.test.ts`,
  `packages/services/recipe-workers/src/handlers/__tests__/accountErasureWorker.test.ts`

**Approach.** Per KTD-5 and KTD-6. Consulted **before** the cache, because a correction that lost to a
cached machine parse would be a correction that does nothing.

⚠️ There is no repo-wide gate asserting that every owner-bearing table is covered by the erasure sweep.
Both `ingredient_resolution_mappings` and `ingredient_resolution_memos` shipped without coverage and were
retrofitted; this table would be the third instance of the same class. **Propose the gate in this unit**,
not just the row.

**Execution note.** Test-first, integration-first for the sweep.

**Test scenarios.** A correction outranks a cached parse · a correction outranks both live engines ·
author-scoped corrections do not leak across users · a grant-holder's correction writes globally · a
second independent corroboration promotes an author-scoped correction · erasure NULLs `owner_id` and the
text **together**, never one without the other · erasure never deletes the row · the sweep succeeds
against a row whose text column is already NULL (idempotent) · the new gate fails when a table with an
`owner_id` is absent from the sweep.

**Verification.** Integration tier green; erasure suite green.

---

#### U7 — Pipeline orchestration, and the import wiring

**Goal.** Correction → cache → both engines in parallel → comparator → cache write, wired into
cookbook-import.

**Files.**

- Create: `packages/services/recipe-workers/src/parsing/parsePipeline.ts`
- Modify: `packages/tools/cookbook-import/src/proseRecipe.ts`
- Test: `packages/services/recipe-workers/src/parsing/__tests__/parsePipeline.test.ts`,
  `packages/tools/cookbook-import/tests/parsePipeline.integration.test.ts`

**Approach.** The orchestration owns exactly one rule — the order — mirroring `resolutionCascade.ts`'s
discipline. A tier that throws is contained and reported, never equated with a miss.

⚠️ `proseRecipe.ts` calls `parseIngredientLine` on successively-shorter **suffixes** of a clause, keeping
the leftmost that parses. That is a prose-scanning strategy, not a parse, and it must survive: the
pipeline replaces what happens to the chosen suffix, not how the suffix is chosen. Getting this wrong
silently changes which text is treated as an ingredient across the whole corpus.

**Execution note.** Test-first. Characterize `proseRecipe`'s suffix selection before touching it.

**Test scenarios.** Order is correction → cache → engines · a cache hit calls no engine · a correction hit
reads no cache · both engines are invoked concurrently, not sequentially · a CRF failure still produces a
`single-engine` result · agreement writes both cache rows · the golden corpus's recipes parse with no
regression in line count · the confectioner's-sugar case (a previously dropped clause) survives.

**Verification.** `cookbook-import`'s golden-corpus regression suite green; a full re-import run compared
against the last recorded run.

---

#### U8 — The oracle, on top of the comparison harness that now exists

⚠️ **Half of this unit shipped in `0ed88804`.** `packages/tools/cookbook-import/src/parseComparison/`
(nine modules, 317 unit tests, an integration tier against the real Python CRF) already measures the two
engines against each other over 2,584 real lines, and CI installs the pinned CRF. Do not rebuild it.

What it deliberately does **not** do is adjudicate: the report states outright that it _"sizes and names
the disagreement; it does not adjudicate it."_ That is what remains — an **oracle** for the 354 `differ`
cases, without which KTD-2's winner rule stays a guess and Micro-vs-Pro stays unresolved.

**Goal.** A committed, seeded, non-vacuous oracle deciding which engine is right on the adjudication list.

**Files.**

- Create: `packages/tools/cookbook-import/tests/__fixtures__/parseOracle.ts`
- Modify: `packages/tools/cookbook-import/src/parseComparison/parseAgreement.ts` (shape-aware disposition
  per KTD-2's table — the shapes are already classified; the dispositions are not)

**Approach.** ⛔ The oracle is **not the previous parser** — _"chaining a rewrite to its immediate
predecessor lets a drift introduced in step N be blessed forever by step N+1."_ It is the requirement
stated literally: slow, hand-written, and adequate to be right.

⛔ And it is committed. The precedent is explicit: _"an unreproducible equivalence proof protects the
change that was made and nothing after it."_ Seed from the trial index so a failure reports a seed rather
than "it happened once." Assert the corpus covered every regime — anti-vacuity is mandatory, because
randomised suites fail silently by generating uninteresting data.

⚠️ Read the actual lines of any generated corpus before believing any rate computed from it. The
verification bake-off's false-disagree rate moved 7.06% → 2.32% purely from corpus phrasing defects, and
that document names this as its strongest transferable lesson. The existing `generateBakeOffCorpus` has a
known 13.8%-unitless defect and must not be used here.

**Test scenarios.** Every regime (single amount, composite, range, multi-food, historical unit, prep,
subjective measure) is represented and asserted to be · disagreement rate is reported, not asserted to a
threshold · a seeded failure is reproducible from its seed alone.

**Verification.** Suite green and reported; the disagreement rate recorded in the report file for KTD-2's
calibration.

---

#### U9 — ADR-0025

**Goal.** Record the new deployable exception and the pipeline's load-bearing decisions where they can be
found before they are undone.

**Files.**

- Create: `docs/architecture/decisions/0025-two-engine-ingredient-parse-pipeline.md`
- Modify: `docs/architecture/decisions/README.md` (index entry — `docCrossReferences.test.ts` requires
  both an index entry and an inbound pointer), `CLAUDE.md` (the deliberate-decisions list)

**Content.** The ADR-0017 exception on ADR-0019 §3's three grounds and the "owns no database"
consequence; the no-poisoning rule and why the prompt builder's signature enforces it; stated-vs-restated;
`single-engine` ≠ `differ`; the rejection of `foundation_foods`; the Python runtime and GR-008 ruling;
and the residual risks — three consumers on one ADR-0024 ceiling, an uncalibrated field-level winner, and
a packaging guard that is new rather than proven.

**Verification.** `npm run test --workspace=packages/infra/global` green (cross-reference gate).

---

### Frontend — ⛔ BLOCKED on mockups

These units must not start before the Figma Make output exists. The brief is
`docs/mockups/briefs/recipe-ingredient-entry-figma-make-prompt.md`.

#### U10 — A unit vocabulary, and a canonical/subjective distinction on the wire

**Goal.** The autocomplete has a list to bind to, and the wire can tell `cup` from `handful`.

**Files.** Modify `packages/shared/recipe-core/src/units.ts` (export a deduped vocabulary derived from the
already-private `UNIT_ALIASES` — ~67 entries), `packages/shared/recipe-core/src/recipeRequestBounds.ts`,
`packages/services/recipe-service/src/recipes/recipes.schema.ts`, `packages/schemas/recipe/**`.

⛔ Wire contract with a `CONTRACT_HASH`. The vocabulary is **derived from the existing table**, never a
second hand-written list — a copy of a list cannot detect that the list is incomplete.

⚠️ Design question the mockup must answer before this is built: is a subjective unit a _different field_,
or the same field with a flag? The former makes illegal states unrepresentable; the latter is a smaller
change. Do not decide it from the code.

**Test scenarios.** The exported vocabulary equals the normalizer's own domain (no drift) · a canonical
unit round-trips · a subjective unit round-trips and is marked · an unknown unit is accepted, never
rejected · `CONTRACT_HASH` moves and the client is regenerated.

#### U11 — The preparation field

**Goal.** A real preparation field on the wire and in both UIs, distinct from `notes`.

⚠️ `notes` already reaches the wire and no UI writes it. Resolve what it is before adding a sibling: either
`notes` **becomes** preparation (and its docstring is wrong), or it stays a display override and
preparation is genuinely new. Do not ship both undecided.

**Files.** `recipe-core/src/recipeRequestBounds.ts`, `recipes.schema.ts`, `packages/schemas/recipe/**`,
a migration, `RecipeIngredientsFields.tsx`, `RecipeIngredientsFields.native.tsx`, `form/model.ts`.

**Test scenarios.** Preparation is never concatenated into the food name on read or write · an empty
preparation omits the key rather than sending `''` · both platforms render and submit it · the localized
label exists on both platforms.

#### U12 — Attribution (dry/wet) — _pending an owner decision_

⛔ Not buildable as specified. USDA carries nothing that derives it: `foodCategory` is a taxonomy, not a
moisture state, and the Water nutrient (which we do not ingest) gets the cooking sense backwards — flour
at 12% water is dry, honey at 17% is wet. It is a per-line declaration or it does not exist. Build only
if the mockup includes it and the owner confirms it is declared.

#### U13 — Picker-first "Add ingredient"

**Goal.** Remove the dead end. Today the button appends a row that `validateRecipeForm` rejects and
`toCreateRecipeInput` silently drops.

**Files.** `packages/apps/commise/features/recipes/src/form/RecipeIngredientsFields{,.native}.tsx`,
`RecipeCreateContainer.tsx`, `mobile/src/screens/RecipeEditor.tsx`.

**Test scenarios.** The button opens the picker · no unresolved row can be created from the happy path ·
an unresolved row from a restored draft still surfaces its reason · Playwright (web) and Maestro (mobile)
flows cover the loop end to end.

#### U14 — The USDA on-demand affordance

**Goal.** Wire the "Search USDA for '{query}'" seam that mobile already renders inert.

⛔ Not per-keystroke, and not debounced-live. The documented limit is 1,000 requests/hour and the
interactive lane is ~100/hr (`RollingWindowLimiter` pauses the drain at 90%). At 50 concurrent users a
perfect one-call-per-settled-query autocomplete is still 3× the _whole_ budget.

**This unit is a revival, not a design.** `docs/plans/2026-07-26-ingredient-search-usda-blended-autocomplete.md`
(status: proposed, unbuilt) already specifies seed → blend → on-demand, and names two open risks: the
`channel` split of `source_call_log` is a migration rather than config (F-W1), and seeding 8k foods turns
the change-refresh worker into a sustained consumer of the same window unless seeded rows are excluded
(F-C2). Read it first.

---

### Stashed items, folded in

#### U15 — SC-007's load fixture vs. the head-term retrieval branch — ⛔ owner ruling needed

Recorded at `specs/003-usda-food-data/tasks.md:1208`. Commit `8c70d742` added
`OR rank_tokens @> ARRAY[${head}]::text[]` to `FoodSearchDao.relevanceQuery`, and the k6 SC-007 headroom
fell from 5.6× to 1.5×. Undecided whether the fixture or the query is wrong. **Blocking for the heavy
tier's credibility** — until it is resolved, an SC-007 pass means less than it did.

#### U16 — `parseIngredientLine` folds measurements into the food name

Recorded at `specs/003-usda-food-data/tasks.md:1249`. Partially addressed 2026-08-23 by the
`measurement_in_name` review reason and `splitMeasurement.ts`; the segmentation is incomplete.

⚠️ Verify rather than assume closure. U7 replaces what happens to a chosen suffix on the import path, so
the defect may be closed there — but `parseIngredientLine` remains exported from `recipe-import-core`'s
barrel, and a projection of `ParsedLine` inherits whatever the projection drops. Close it explicitly with
a test, or state plainly that it survives in the projection and why that is acceptable.

---

## Requirements Trace

| Requirement                                                | Where                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| R11, R12 (ordered tiers, fall-through)                     | U7 — the parse pipeline mirrors the cascade's discipline; it does not join it |
| R13 (only lexical runs synchronously)                      | Scope Boundaries — the write path is not a consumer                           |
| R19, R20 (a user's edit outranks; records who/when)        | U6                                                                            |
| R21 (every LLM-derived result records the model)           | U3, U5 (`engineVersion` in the key)                                           |
| R23 (deterministic termination on ceiling/timeout)         | U3, KTD-3                                                                     |
| R29 (splitter does not split on a consumed `and`)          | U16                                                                           |
| R31 (`*ful` family; one table serves parse and conversion) | U10 (the vocabulary is derived from that table)                               |
| R32–R35 (historical units, citation, provenance)           | KTD-2 (LLM wins historical units), U4 (stated pair)                           |
| R36, R37 (ranges preserve both bounds)                     | U1                                                                            |
| R39 (value-corrupting lines refused)                       | U1, U7                                                                        |
| R40 (no fabricated quantity)                               | U1                                                                            |
| Origin Q8 (which surfaces run the cascade)                 | **Answered: import only** — owner ruling 2026-08-23                           |
| Origin Q9 (where the LLM tier executes)                    | **Answered: recipe-workers, async**                                           |

---

## Risks & Dependencies

1. **Three consumers on one $100 ceiling.** Verification, this parse leg, and 017's capture tiers. The
   first to burn it denies the other two. ADR-0024 needs an allocation rule or a per-`callSite` sub-budget;
   neither exists. **Open — see below.**
2. **A new runtime with a new guard.** The packaging guard for the Python Lambda is written for this
   change, so it has never caught anything. `handle-sync-worker` is the precedent for what an unguarded
   Lambda asset costs.
3. **KTD-2's winner rule is sized but not adjudicated.** The disagreement rate is now measured (49.17%
   agreement; 354 unstructured `differ` cases) and the shapes are classified — but _nobody has decided who
   is right_ on the adjudication list. The winner rule is evidence-shaped, not evidence-backed, until U8's
   oracle lands. Observe-only until then.
   3a. **Every measured rate comes from one 1919 cookbook, and is an upper bound.** 1,148 blocks were skipped
   whole. Historical prose is the hardest input this pipeline will meet; nothing here has been measured
   against a modern ingredient line, which is what 017's capture waterfall will actually deliver.
4. **`proseRecipe`'s suffix scanning is load-bearing and easy to break silently.** U7 characterizes before
   changing.
5. **In-flight collision on `spendArithmetic.ts`** with the Bedrock invocation-id plan (P3/P5 outstanding)
   and a running agent adding Nova rate entries.
6. **The frontend half is gated on an artifact that does not exist yet.** U10–U14 have no start date.
7. **Retrieval, not parsing, was the dominant failure** in `docs/reports/2026-08-22-001-ingredient-resolution-measurement.md`,
   which also records that a whole unit was _"complete as specified, and the specification was aimed at the
   wrong surface."_ This plan should be re-checked against that finding before U2's cost is committed.

---

## Deferred to Implementation

- Which Python runtime version to pin, and whether GR-008 takes an amendment or a waiver.
- Whether the CRF Lambda is invoked per line or per batch (cold start amortizes very differently).
- Whether `notes` becomes preparation or gains a sibling (U11).
- Whether a subjective unit is a separate field or a flagged one (U10) — the mockup decides.

## Open Questions

1. **⛔ How is the ADR-0024 ceiling allocated across three consumers?** Blocking for U3's ship, not for its
   build.
2. **⛔ U15's fixture-vs-query fork** — owner ruling.
3. **U12 (attribution)** — declared per line, or dropped?
4. Does the disagreement flag ever _block_ an import, or stay observe-only permanently? Answerable only
   after U8.

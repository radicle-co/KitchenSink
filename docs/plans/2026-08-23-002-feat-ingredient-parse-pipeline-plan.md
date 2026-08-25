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
field, and there is no way to group ingredients into the sections recipes actually use. Those are a wire-contract change and are planned here in the
same document, deliberately, because both halves turn on the same two facts — what a measurement is, and
where identity ends and preparation begins.

⚠️ **The mockups have LANDED** (`docs/mockups/figma-make/`), and the owner has ruled that their valid
changes come into THIS plan rather than a separate effort. So the document now spans two tracks: the parse
pipeline (U1–U9, backend, **ready to build today**) and the interactive surface (U10–U19, which the
mockups govern). ⛔ They are deliberately independent — nothing in U1–U9 waits on a UI decision, and the
build order keeps it that way. Parts of the mockup are unfinished; the frontend section names which.

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
- The structured-entry contract gaps: unit vocabulary, preparation, ingredient grouping.
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

⛔ **CORRECTED 2026-08-23 by KTD-2b, in two ways.**

**(1) Placement is no longer a winner question at all.** Once the ruling exists, the comparator
CANONICALIZES both engines' answers through it before comparing — a modifier goes where the rule says
regardless of which field each engine filed it in. Those cases stop being disagreements rather than being
won. That is strictly better than picking a side: a winner rule would keep re-deciding, per line, a
question that has one answer.

**(2) On placement, the LLM was the wrong choice, and by a clear margin.** Scored against the ruling over
the contested modifier words: the **CRF's filing matches it 125 times (68%), the LLM's 58 (32%)** — better
than two to one. "Identity and preparation from the LLM" was inferred from the earlier bake-off's
aggregate and does not survive contact with the axis it actually governs. The canonicalization in (1)
makes the winner rule moot for placement, so nothing needs to be reassigned — but the sentence above must
not be read as evidence the LLM files modifiers better, because it does not.

⚠️ The LLM's measured strengths that DO survive: multi-food lines (`modelSplitsFoods`), historical units,
and pulling a unit out of a food name (`crfUnitInName`). Those are different questions from placement.

⛔ **Measured 2026-08-23, and it reshapes this decision: the two engines agree on all three fields for
only 49.17% of ingredient lines** (Nova Micro, n = 1,379; Pro ties at 49.53%). Per field the picture is
better — measure 75.6%, food names 63.3%, preparation 69.0% — so the 49% is a _conjunction_ of three
imperfect agreements, not a catastrophe in any one. But it means a binary "disagree ⇒ flag" rule flags
**half the corpus**, which is not a review queue; it is the corpus with extra steps. A flag that fires on
half of everything is how a real signal gets muted — the same failure `contractSkew.ts` names.

So the comparator classifies the disagreement's **shape**, and only some shapes reach a human. Measured
distribution (Nova Micro, ingredient lines):

| shape                                                                      |   n | disposition                                                                       |
| -------------------------------------------------------------------------- | --: | --------------------------------------------------------------------------------- |
| `differ` (unstructured name disagreement)                                  | 354 | ⚠️ **the genuine adjudication list** — 25.7% of lines                             |
| `quantityDiffers` (units agree, numbers do not)                            | 114 | CRF wins, record both                                                             |
| `amountCountDiffers` (different NUMBER of amounts read)                    |  92 | CRF wins; this is the composite case U16 touches                                  |
| `unitDiffers`                                                              |  81 | CRF wins, record both                                                             |
| `crfUnitInName` (CRF swallowed the unit into the food)                     |  25 | **LLM wins silently** — the CRF is demonstrably wrong (`"a little vinegar"`)      |
| `crfSizeField` (CRF routed `large`/`small` to a field we have no slot for) |  24 | canonicalised into `name` — U1, U4. `large` is an adjective, so KTD-2b decides it |
| `modelSplitsFoods`                                                         |   7 | **LLM wins silently** — this is the multi-food case the CRF cannot express        |
| `modelPrepInCrfName`                                                       |   4 | **LLM wins silently** — identity-vs-prep, the LLM's measured strength             |

That reduces what a human ever sees from ~700 lines to the 354 `differ` cases, and it does so on evidence
rather than by tuning a threshold.

### KTD-2a — `differ` is four things, and three of them need no human (measured 2026-08-23)

All 354 `differ` cases were read out and compared by **token multiset** — what words each engine used,
regardless of which field it filed them in. That split is mechanical and reproducible; it tunes nothing.

| bucket                                                   |   n | share | disposition                               |
| -------------------------------------------------------- | --: | ----: | ----------------------------------------- |
| **Placement only** — identical words, different fields   | 184 | 52.0% | **a rule, not a human** — see KTD-2b      |
| **Function words only** — differ by `that/have/been/of…` |  21 |  5.9% | normalize stopwords before comparing (U4) |
| **Duplication only** — one side counts a word twice      |  19 |  5.4% | dedupe; it is an LLM defect (U4)          |
| **Genuine content difference**                           | 130 | 36.7% | the real adjudication list                |

⛔ **The adjudication list is therefore ~130 lines — 9.5% of ingredient lines, not 25.7%.** Small enough to
read end to end rather than sample, which is what U8's oracle should do.

⚠️ **And a large share of `differ` is not a model disagreement at all — it is the EXTRACTOR.** Reading the
sample: `one tablespoon of butter in a frying-pan`, `one pound of flour into a deep bowl`,
`one pint of milk for five minutes`, `two pints of water overnight`, `four tablespoons of flour to it` —
and `a large preserving kettle`, which is equipment. That is residual **instruction** text: a vessel, a
duration, a target. Neither engine is wrong; both are handed prose that should never have reached a
parser. The CRF folds it into the name, the LLM files it as prep, and the comparator scores a
disagreement. It also inflates bucket 4 — `three cups of milk for twenty minutes` differs only because
the CRF dropped the trailing clause and the LLM kept it.

This is `proseRecipe`'s clause segmentation, already leaking, and it inflates **every rate in the report**.
Fixing it comes BEFORE adjudicating anything, or the oracle spends its effort judging text that is not an
ingredient line. See the build order below.

### KTD-2b — ⛔ RESOLVED (owner ruling, 2026-08-23): where a modifier belongs

`one-half cup of chopped onions` → the CRF says `name=onions, prep=chopped`; the LLM says
`name=chopped onions`. **Both read the line correctly.** What is missing is a rule in our own schema
saying where a modifier belongs — and its absence is the single largest disagreement class in the system.

**The ruling.** A **past participle is preparation** (`chopped`, `grated`, `melted`, `sifted`, `minced`,
`stoned`, `beaten`). An **adjective is identity** (`sweet`, `brown`, `pastry`, `Russian`, `fresh`, `red`,
`green`). **Temperature is preparation** (`hot`, `cold`, `boiling`, `lukewarm`, `warm`) — the middle case,
committed deliberately.

This is now the definition `prep` carries system-wide, including the write-path field in U11.

**Verified against the 354, and it does not settle as many as first claimed.** Applying the ruling
mechanically:

|                                                                 |       n | note                      |
| --------------------------------------------------------------- | ------: | ------------------------- |
| Contest a genuine **food modifier** — the ruling decides        | **128** | 36% of `differ`           |
| Contest **instruction residue**, not a modifier — U7a's problem |      69 | the ruling does not apply |
| No contested word after normalization                           |      12 | U4 absorbs these          |

⛔ **Correction to KTD-2a: the ruling settles ~128 lines, not 184.** The 184 figure counted every
placement-only case, and 69 of those are contested over words like `into`, `spider`, `overnight` and
`bowl` — the extractor's residue wearing a placement disagreement's clothes. Fixing U7a and applying this
ruling are the same 197 lines between them, but they are not interchangeable and the ruling alone does not
reach the 69.

⚠️ **Two implementation traps, both hit while verifying this.** `red` and `green` end in `-ed`/`-en` and
are colours, not participles — a naive suffix test mis-files them as preparation. And `-ed` alone is not a
participle test; the vocabulary needs an explicit irregular list (`cut`, `ground`, `beaten`) plus an
adjective exception list. This is a small lexicon, and per the library-first gate it should be checked
against an existing POS tagger before being hand-rolled — the CRF package already ships one.

⚠️ **Accepted consequence.** `cooked green peas` files `cooked` as preparation and `green` as identity;
`dried figs` files `dried` as preparation. Both are arguably identity to a cook. The ruling is a
definition, not a claim about English, and this is the edge it buys clarity with.

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

⛔ **RESOLVED (owner ruling 2026-08-24): the ceiling is GLOBAL, and is not sub-divided per consumer.** One
$100/month pool serves the verification gate, this parse leg, and 017's capture tiers alike, first come
first served.

That is the same argument ADR-0024 already made when it rejected the daily sub-ceiling: a sub-budget
_"never enforced the monthly figure it sat under… and it denied legitimate bulk work."_ A per-`callSite`
cap is the same mistake on a different axis — it would refuse a legitimate import while the global figure
sat nowhere near $100, and it would need re-tuning every time a consumer's share of the work moved.

⚠️ **Accepted consequence, stated so nobody reports it as a defect: the first consumer to burn the pool
denies the other two.** A large import can starve the verification gate for the rest of the month. The
gate fails CLOSED and its messages retry under `maxReceiveCount` before hitting the DLQ, so that outcome
degrades rather than corrupts — but it is a real coupling, and it is the price of not sub-dividing.

⛔ **What does NOT follow: that spend needs no attribution.** Not capping per consumer makes it MORE
important to know which one spent, not less — when the pool empties, "who burned it" is the first question
and the counter cannot answer it today. So `callSite` is carried on the EMF spend metric as a **dimension**
while the ceiling stays a single number. Attribution without partitioning.

⚠️ Note the shape: this is the same defect just found in food's `source-rolling-window-count`, which
carries a `source` dimension and no `stage`, so prod and every preview co-mingle into one series and no
call can be attributed. Do not ship the spend metric with that gap — a dimension on the metric is cheap; a
dimension retrofitted after an incident is not.

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

### Build order

KTD-2a reordered this. The three cheap things that shrink the problem come first, and the expensive
human-judgement unit comes last, on the residue they leave:

1. ~~**KTD-2b's modifier rule**~~ — **DONE** (owner ruling 2026-08-23). Settles 128 of 354.
2. **U1** — the contract, including the size qualifier and KTD-2b's `prep` definition.
3. **U4** — the comparator: canonicalize placement through KTD-2b (128), then normalize stopwords and
   duplicates (40).
4. **U7a** — `proseRecipe`'s segmentation, which is inflating every rate measured so far.
5. **Re-run the comparison harness**, record the deltas against §3 of the report.
6. **U2, U3, U5, U6, U7** — the engines, the cache, the correction tier, the orchestration.
7. **U8** — the oracle, on the ~130 lines still standing.
8. **U9** — ADR-0025, written once the above have stopped moving.

⛔ **The UI track (U10–U19) runs INDEPENDENTLY and does not gate any of the above.** Within it the order
is: **U17 first** — it fixes a live defect (`Next` unreachable on native) and settles where every other
control lives, so building U10–U14 against an unsettled action model means building twice. Then U18 (the
step model, because it is typed and everything renders inside it), then U10–U14 (ingredient entry), then
U19's three independent pieces last.

⚠️ **Two defects are folded in here per the owner's ruling and are NOT gated on any mockup decision**:
`Next` scrolling away on native (U17), and the 768–1023px band where the shipped chrome has neither a
hamburger (`HomeTopBar.tsx:93`, `md:hidden`) nor a sidebar (`HomeSidebar.tsx:67`, `lg:flex`) — so tablet
navigation survives only via the bottom tab bar. The second is app-shell, not wizard, and is the one piece
here that touches `HomeChrome` rather than `features/recipes`.

⚠️ Steps 1–5 are cheap and they change what the rest is measured against. Doing them after U2's Python
Lambda would mean committing the expensive infrastructure decision against numbers we already know are
inflated.

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

⛔ **`size` is NOT a member of this contract — owner ruling 2026-08-24, reversing an earlier draft.**

The CRF emits a `size` field (`large`, `small`), our shape has nowhere to put it, and the collision is
real: `crfSizeField` is 24 lines for Nova Micro and **57 for Haiku 4.5**. An earlier revision of this unit
concluded it therefore needed its own nullable member. That was wrong, for a reason worth recording
because it is the same mistake in a new place: **it let a third-party parser's output shape our schema.**

`large` is an adjective, and KTD-2b already rules that **an adjective is identity** — it belongs in the
food's name. There is no exception here that does not also reopen `sweet`, `brown` and `Italian`. So the
CRF's `size` is **canonicalised into `name`** by the comparator (U4), exactly as placement is, and
`crfSizeField` stops being a disagreement rather than being modelled around. That is 81 lines across the
two models resolved by applying a rule we already have, instead of by adding a field.

⚠️ Two consequences, accepted. `large onion` and `onion` are distinct names, so whether they resolve to
the same catalog food is the **resolution cascade's** question, not this contract's — which is the correct
layer for it, and the cascade already has curated mappings for exactly that. And the write path grows no
size control (the mockup's was removed on the same ruling): a cook wanting precision states a mass.

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

⛔ **Canonicalize the CRF's `size` into `name` first.** `large`/`small` is an adjective, so KTD-2b files
it as identity. 24 lines for Micro, 57 for Haiku. See U1 for why this is a canonicalisation and not a new
contract member.

⛔ **Then canonicalize placement through KTD-2b's ruling before comparing** — 128 lines. A past participle and
a temperature are moved to `prep`, an adjective to `name`, on BOTH engines' answers, and only then are
they compared. Needs the modifier lexicon (check the CRF package's POS tagger before hand-rolling it) and
its two traps: colours ending in `-ed`/`-en`, and irregular participles a suffix test misses.

⛔ **Then normalize the rest** — 40 more lines of the `differ` bucket, free (KTD-2a):

- **Stopwords.** `that have been boiled soft` and `boiled soft` are the same reading; the CRF keeps the
  relative-clause scaffolding and the LLM drops it. 21 lines.
- **Duplicates.** The LLM sometimes emits a modifier into BOTH `name` and `prep` (`name: "chopped celery",
prep: "chopped"`). That is a defect in one answer, not a disagreement between two. 19 lines.

⚠️ Normalizing for COMPARISON must not normalize what is STORED. The stored parse keeps the line's own
words; only the comparator's view is normalized. Conflating the two would quietly rewrite the corpus.

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

⛔ **U7a — the segmentation defect, and it now gates U8.** KTD-2a found that a large share of `differ` is
this module handing both engines text that is not an ingredient line: a vessel (`butter in a frying-pan`),
a duration (`milk for five minutes`), a target (`flour to it`), and at least one piece of equipment
(`a large preserving kettle`). The clause is accepted, the trailing instruction rides along, and the two
engines mangle it differently — the CRF into the name, the LLM into prep.

Close it BEFORE the oracle runs. Two things follow. The oracle must not spend its judgement on text nobody
meant to parse; and **every rate in the report is inflated by this**, so the comparison harness is re-run
afterwards with the deltas recorded, never with the old figures quietly replaced.

⚠️ This is a segmentation decision, not a regex to bolt on. A clause carrying an ingredient AND an
instruction is ordinary in this corpus, and the honest outcome may be a `line_is_instruction` review
reason — the sibling of `measurement_in_name` — rather than a silent trim. Dropping the tail is
value-corrupting when the tail was a second food (`one-half pound chocolate in one cup of water`).

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
the disagreement; it does not adjudicate it."_ That is what remains — an **oracle**, without which KTD-2's
winner rule stays a guess.

⛔ **RUNS LAST, and its subject is now ~130 lines, not 354.** KTD-2b removes 184, U4's normalization
removes 40, and U7a removes the extractor's residue from what is left. Running this unit before those
three would adjudicate mostly-decidable cases and text nobody meant to parse — paying a human to settle
questions a rule already answers.

⚠️ At ~130 the oracle reads the list **end to end**. Sampling was a concession to 354; it is not needed
here, and a census removes the seeded-sample caveat entirely.

⛔ **The oracle is not me, and not a model from either engine's family.** The bake-off measured
self-preference at −31.5 points; an LLM adjudicating an LLM's parse against a CRF's is the same failure
with an extra step. Either the owner rules, or the oracle is a written rubric applied by diverse lenses
with the rule recorded — never a single model's opinion presented as ground truth.

**Goal.** A committed, non-vacuous oracle deciding which engine is right on the residual list.

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

### Frontend — the mockups have LANDED (2026-08-25)

The Figma Make output is archived at `docs/mockups/figma-make/` and compared against shipped in that
directory's README. ⛔ **The mockup is NOT uniformly ahead of what ships.** Three shipped decisions
POST-DATE it and must not be regressed by a visual port:

| shipped behaviour                                                       | why it must survive                                                                                                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Difficulty models **"Not stated"** as a fourth, first-class option      | the mockup has three and defaults to `Easy`; `toUpdateRecipeInput` turns removal into an explicit wire `null`, and a visual port deletes that state |
| `goNext` is gated by `canAdvanceFromStep` and **voices the refusal**    | the mockup's `goNext` advances unconditionally into an empty form                                                                                   |
| The discard guard compares **structurally** against a captured baseline | the mockup uses a three-field heuristic and guards only one of the three exits shipped guards                                                       |

⚠️ **And parts of the mockup are unfinished — the owner ran out of Figma Make credit.** Do not port:
`Save Draft` (no handler at either breakpoint), the duplicate desktop `Publish` (two controls, two labels),
`Add Photo`/`Add Timer` (chrome with no state), the mockup's Dietary chips (they write into the SAME array
as Categories — a state bug), the `md:` chrome cutover (see U17), or the un-guarded inline picker (below
`md` it renders SIMULTANEOUSLY with the bottom sheet).

⛔ `DESIGN_SYSTEM.md` is **not authoritative for anything**. It carries a THIRD seafoam (`#5BA8A0`, the
un-darkened one) contradicting the mockup's own `theme.css`, and declares "focus indicators: 2px solid
seafoam rings" — which would import the failing colour as a compliance rule. Its radius ramp, shadow ramp,
sidebar width and tab count are all stale against that same CSS. Shipped matches the CSS.

#### ⛔ Owner rulings, 2026-08-25 — the wizard's action model

1. **Below `lg`: a bottom action bar carrying Previous · Save Draft · Next**, genuinely PINNED. Above
   `lg`: the Previous / step-counter / Next row sits in the sticky header instead.
2. **`lg`, not `md`.** The mockup's bar is `md:hidden`, so it does not exist at 768–1023px at all — the
   tablet band falls back to the desktop header row. That is the unfinished half, not a specification.
   `lg` also matches shipped's own chrome cutover.
3. **Pinned means OUTSIDE the scroll container**, with `env(safe-area-inset-bottom)`. The mockup's
   `sticky bottom-0` pins only because of its exact flex structure; one layout change and it drifts back
   into flow. ⚠️ On native this is the fix for a REAL SHIPPED DEFECT: `Wizard.Controls` sits inside the
   `ScrollView` (`RecipeEditor.tsx:205`), so a cook must scroll past the whole ingredient list to reach
   `Next`.
4. **Save Draft leaves the kebab below `lg`**; the kebab's remaining item, Cancel, is replaced by a
   **header back arrow** routed through the existing discard guard. Desktop keeps `Preview` + kebab.
5. **Step 4 becomes Review; Photos move into Details.** Typed change across `WIZARD_STEPS`,
   `RecipeWizardStep`, `STEP_ERROR_FIELDS` and `WizardMessages.stepNames`'s 4-tuple.
6. **Meal type becomes a fixed vocabulary**; tags and dietary flags stay free text, and free text stays
   filterable.
7. **Build the SpeedDial FAB, wiring only Create from Scratch.** Scan / Import / AI belong to features
   004 and 005 and are not this plan's to promise.
8. **Build auto-save for real.**

#### Frontend — ingredient entry

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

#### U12 — Ingredient groups (replaces dry/wet attribution — owner ruling 2026-08-24)

**Goal.** An ingredient line may carry a section label, and the list renders sectioned when any line has
one: "For the marinade", "For the topping", or "Dry" and "Wet".

⛔ **Dry/wet as a per-line toggle was DROPPED, and the reasoning should not be re-litigated.** USDA derives
nothing usable — `foodCategory` is a taxonomy, not a moisture state, and the Water nutrient (which we do
not ingest) gets the cooking sense backwards: flour at 12% water is dry, honey at 17% is wet. More
decisively, dry/wet is a property of the FOOD, not of a recipe's use of it — flour is dry every time — so
a per-line control asks a cook to restate a fact about flour on every recipe they ever write. Where it
genuinely matters to a cook it means **mixing order**, which is the same axis as "For the sauce". One
field serves both.

⚠️ **This is the one addition with code evidence.** `parseIngredientLine` already detects `group_header`
(`ingredientLine.ts:250`) for lines like "For the sauce:" — and the recipe schema has nowhere to put it,
so it is flagged and discarded. This unit gives that signal somewhere to land.

⚠️ **Free text, not an enum.** "Dry" and "Wet" are two labels among many, and a closed set cannot express
"For the crust". Autocomplete over labels used in this recipe plus common ones; accept anything new.

⚠️ **An ungrouped recipe must stay a flat list with no section chrome.** Most recipes will never group,
and those must not look unfinished — the mockup is where that is verified.

**Files.** `recipe-core/src/recipeRequestBounds.ts`, `recipes.schema.ts`, `packages/schemas/recipe/**`,
a migration, both `RecipeIngredientsFields` variants, `form/model.ts`.

**Test scenarios.** A grouped recipe round-trips its labels and their order · an ungrouped recipe sends no
group key at all (never `''`) · reordering within a group preserves order · moving a line between groups
preserves its other fields · a label is scoped to its recipe, not global · `group_header` from an import
lands as a group rather than a review reason.

#### U17 — The wizard's action model, and the pinned bar (owner rulings 2026-08-25)

**Goal.** Previous · Save Draft · Next in a genuinely pinned bar below `lg`; the same three in the sticky
header above it; a back arrow replacing the kebab's Cancel below `lg`.

**Files.** `features/recipes/src/wizard/Wizard.tsx` + `.native.tsx`, `wizard/messages.ts`,
`mobile/src/screens/RecipeEditor.tsx`, `mobile/src/screens/RecipesScreen.tsx`,
`web/src/components/recipes/RecipeCreateContainer.tsx` + `RecipeEditContainer.tsx`.

⛔ **This fixes a shipped defect, and that is the acceptance test.** `Wizard.Controls` is inside the
`ScrollView` (`RecipeEditor.tsx:205`), so `Next` scrolls away beneath a long ingredient list —
`useScrollResetOnChange` exists because four Maestro flows caught the consequence. Pinning it is the cure,
not a restyle.

⚠️ **`lg`, not `md`.** The mockup's bar is `md:hidden` and therefore ABSENT at 768–1023px. Adopting its
breakpoint would ship the gap rather than close it.

⚠️ **Native needs a header at all.** `RecipesScreen.tsx:171` renders pushed surfaces bare — no title, no
back affordance. The back arrow is therefore a NEW shared `Wizard.Header`, not a restyle of something.

**Test scenarios.** The bar is reachable without scrolling on a recipe with 30 ingredients (Maestro + a
Playwright viewport case) · it clears the gesture bar (`env(safe-area-inset-bottom)`) · at 768px the bar is
present, and at 1024px the header row is · Save Draft is absent from the kebab below `lg` and present
above · the back arrow routes through the existing discard guard, not around it · `Next` still refuses an
invalid step and still voices why.

#### U18 — Step 4 becomes Review; Photos move into Details

**Goal.** The mockup's step model, adopted deliberately rather than by visual port.

⛔ **A typed change that moves four things together**: `WIZARD_STEPS` (`wizard/model.ts:10`),
`RecipeWizardStep` and `STEP_ERROR_FIELDS` (`form/model.ts:645,648-659`), and `WizardMessages.stepNames`,
which is a `readonly [string, string, string, string]` (`wizard/messages.ts:13`). The tuple's arity is the
compiler's guard — let it fail rather than widening it first.

⛔ **Review REPLACES Preview** (owner ruling 2026-08-25). The top-bar `Preview` button and its
`role="dialog"` overlay (`Wizard.tsx:230-290`) are DELETED, not kept alongside — two surfaces rendering the
same data drift, and each would need its own tests. It also frees the top-bar slot that Save Draft vacates
below `lg`. ⚠️ Accepted cost: a cook can no longer sanity-check from step 1 without walking forward.

⛔ **Photos behave like every other field** (owner ruling 2026-08-25). Today they are the ONE thing that
demands a server round-trip before it can be touched — `RecipePhotoUploaderContainer` takes a required
`recipeId` and every operation keys on it, so the create path renders "Save this recipe first" instead of
an uploader (`RecipeCreateContainer.tsx:145`). Moving that notice to step 1 would greet every new recipe
with a disabled control. Instead photos live in form state like `title` and `ingredients`, and flush when
the recipe first has an id — normally from auto-save (U19), which the same ruling confirms saves DRAFTS.

⚠️ **The one genuinely new failure mode, to be designed rather than discovered**: the create endpoint takes
JSON and photos go through a separate `useRecipePhotoUpload` mutation, so a save is create-THEN-upload. A
create that succeeds while an upload fails leaves a recipe whose photo did not land. Define that outcome —
retry, surface, or discard — before building; do not let the two calls look like one.

⚠️ **Ordering consequence**: this makes U19's auto-save a PREREQUISITE for U18 on the create path, and U19
is currently scheduled last. Either move auto-save earlier or accept a first-save flush without it.

#### U19 — Meal type, the SpeedDial, and auto-save

**Goal.** Three independent owner rulings that share the creation surface.

- **Meal type is a fixed vocabulary**; tags and dietary flags stay free text and stay filterable. New wire
  field + migration. ⚠️ The mockup writes its Dietary chips into the SAME array as Categories — a state
  bug. Model them as separate axes.
- **SpeedDial FAB, wiring only Create from Scratch.** ⚠️ It replaces today's inline button
  (`RecipeList.tsx:68`). Scan / Import / AI belong to 004 and 005; do not render them at all rather than
  rendering them dead — the repo's convention for a not-yet-real destination is an `aria-disabled`
  "coming soon" nav item, and promising a stopped feature is worse than omitting it.
- **Auto-save, built for real.** ⛔ Not a label. Nothing ships today (`grep autosav` → nothing), and the
  mockup's "Auto-saved 2 minutes ago" is a hardcoded literal. A debounced draft write has to interact with
  `useRecipeEditor`'s `expectedVersion` and its 409/conflict statechart, so a lost-update path is the risk
  to test, not the timer.

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

1. **Three consumers on one $100 ceiling — now a RULING rather than a gap** (KTD-8, 2026-08-24). The pool
   is global by decision. The residual risk is unchanged in substance: a large import can starve the
   verification gate for the rest of the month. It degrades rather than corrupts (the gate fails closed and
   retries), and the mitigation is attribution — a `callSite` dimension on the spend metric — not a
   sub-budget.
2. **A new runtime with a new guard.** The packaging guard for the Python Lambda is written for this
   change, so it has never caught anything. `handle-sync-worker` is the precedent for what an unguarded
   Lambda asset costs.
   2a. **⛔ Every rate measured so far is inflated by the extractor.** KTD-2a found `differ` is substantially
   `proseRecipe` handing both engines instruction text and equipment. Until U7a lands, the 49.17% agreement
   figure, the shape distribution, and the Micro-vs-Haiku-vs-Pro tie are all measured on a corpus that
   includes lines nobody meant to parse. The tie is robust (three models, same corpus); the absolute rates
   are not.
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

0. ~~**KTD-2b — is a modifier identity or preparation?**~~ **RESOLVED, owner ruling 2026-08-23**: past
   participle → preparation, adjective → identity, temperature → preparation. Verified against the corpus:
   settles 128 lines. Step 1 of the build order is unblocked.
1. ~~**How is the ADR-0024 ceiling allocated across three consumers?**~~ **RESOLVED 2026-08-24**: it is
   global and not sub-divided — see KTD-8. U3's ship is unblocked; what it now owes is a `callSite`
   dimension on the spend metric so the pool's consumers can be told apart.
2. **⛔ U15's fixture-vs-query fork** — owner ruling.
3. ~~**U12 (attribution)**~~ **RESOLVED 2026-08-24**: dry/wet dropped; replaced by free-text ingredient groups.
4. Does the disagreement flag ever _block_ an import, or stay observe-only permanently? Answerable only
   after U8.

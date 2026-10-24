---
title: Ingredient resolution — the funnel, earned autonomy, and the correction flywheel
date: 2026-08-30
status: ready-for-planning
origin: ce-brainstorm dialogue (owner, 2026-08-29/30) + two adversarial research passes + live measurement
relates_to: docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md (U5, U6, U10, U11, U14, U28, U29)
---

# Ingredient resolution — the funnel, earned autonomy, and the correction flywheel

## Problem frame

Recipe lines and bare food names must resolve to catalog `food_id`s. The bind is the moment a guess
becomes a published fact: everything downstream (nutrition, logs, search) trusts it silently, and a wrong
bind poisons every number computed from it (~900 confidently-wrong binds in the 448-recipe import). The
owner's bar: wrong-confident is the business-critical failure; abstention is nearly free.

**Measured baseline (2026-08-29, real catalog, shipped ladder):** single-token staples ~45% top-1
(all failures are canonical-default misses); multi-word 4/4; one false catch at wide margin
(`cinnamon` → `Cinnamon buns, frosted`) that would have skipped verification and published wrong.

**Research ceiling:** the strongest 2026 systems reach 70–90% on real out-of-distribution text
(FoodSEM: 98% on-benchmark → 36.9% on Open Food Facts). Human inter-annotator agreement on this task is
33–71%. Own-eval numbers WILL overstate live performance; evaluation must use correct-SETS, not single
correct rows.

## The flow (confirmed by owner, 2026-08-30)

One unified fall-through funnel serves both entry points (bare name from the picker; recipe text to parse).
Each stage settles only what it is certain of; the residue falls through. Error costs are asymmetric:
a false fall-through costs one LLM call (~$0.000034); a false catch poisons published nutrition.

```
input (name or line)
  → corrections / caches / curated (free, exact — first refusal, fixed order)
  → lexical shortlist stage (retrieve U6 → rank U5 ladder + FNDDS popularity prior)
  → [parse if line] two-engine CRF ∥ LLM (ADR-0026; independence preserved)
        ↺ validator loop on the LLM leg ONLY: foodness verdict (new, categorized)
          + measurement verdict (EXISTING verifyLine gate — reuse, do not duplicate);
          failure context feeds the parser LLM retry; max 3; then merge with CRF
  → verification gate (one call, no loop) — until a band earns autonomy
  → disposition (below)
```

| situation                                                       | behavior                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| curated hit / earned-autonomy band                              | silent bind (shadow-sampled ~5%)                                        |
| ambiguous, nutritionally immaterial (≤10% energy+macros spread) | silent bind to ranked default, provenance recorded                      |
| ambiguous and material                                          | `ambiguous` state → U14 UX (inline live; batched review post-import)    |
| gate disagrees with a confident proposal                        | withheld, needs-review (undetected-wrongness path)                      |
| not a food after retries exhausted                              | un-parseable; line saved, nothing bound, no food entity created         |
| genuinely novel food                                            | PENDING food entity created, queued for USDA sync (U29), demand-counted |

## Decisions

**D1 — The lexical stage is a shortlist-builder with ZERO initial authority.** It ranks and proposes; the
gate holds the pen. Skip authority is EARNED per band (rung × margin-band × query-shape) from measured
gate agreement (bar ≥ ~99.5% over ≥ ~200 observations; exact numbers are calibration), and is REVOCABLE:
authorized bands stay shadow-sampled and lose autonomy on decay. KTD-3's hand-designed skip conditions
become eligibility floors, not grants. Rationale: the cinnamon false catch proves a-priori thresholds
wrong; each skip saves ~$0.00003 while a false catch risks the product's core promise.

**D2 — The band log is the training set, and it graduates into calibration.** Every gated decision records
(rung, margin-band, query-shape, verdict). Progression as data accrues: Platt scaling (hundreds of points)
→ isotonic (≥~1,000) → small learned ranker (logistic/GBDT over rung, trigram, embedding cosine,
popularity prior; low thousands). Margin becomes calibrated P(match). Guards: human corrections stay in
the label mix (a ranker trained only on gate verdicts learns the gate's blind spots); per-population
calibration (1919 corpus ≠ modern user text — exchangeability is violated by construction, so conformal
set size is a soft ambiguity signal only, never a certified guarantee); abstention stays active for
out-of-distribution shapes regardless of learned confidence.

**D3 — Canonical defaults come from an FNDDS/WWEIA consumption-frequency prior, not editorial opinion.**
One-time ETL joining FNDDS food-code frequencies to SR Legacy names, exposed as a ranking FEATURE beside
the ladder (Instacart pattern). Solves the entire measured staple-failure class ("flour" → all-purpose,
not carob). No published packaging of this exists — differentiation, and data engineering rather than ML.

**D4 — Funnel-honesty repairs land regardless of everything else** (they protect even the interim state):
(a) skip eligibility is CONJUNCTIVE — margin AND nutrient-equivalence (≤10% energy+macros), never OR;
(b) the name-head rule takes the LAST token of a multi-word first comma segment ("Cinnamon buns" → head
"buns"; "Pepper, banana" stays "pepper") so natural-order product names stop crowning the modifier;
(c) singleton shortlists never skip.

**D5 — The retry loop lives on the PARSE side only, and only where the critic adds information.** The
foodness verdict ("not a food — it is an <animal|equipment|action|…>") is NEW information a parser retry
can use; feeding it back is a conscious carve-out from the poisoning rule (which remains absolute for
cross-engine contamination — the CRF never sees anything). Resolution gets ONE gate verdict, no loop: two
LLMs arguing without new evidence converge on what satisfies the critic (Goodhart), not truth; a
deterministic proposer cannot adapt to fool its judge. Attempt provenance rides every merged result so
comparator agreement rates stay honest. Max 3 retries → un-parseable.

**D6 — In-loop validators are dedicated calls that REUSE the gate's machinery (owner ruling 2026-08-30,
resolving Q1).** The foodness and measurement validators fire immediately on each parser-LLM response,
INSIDE the retry loop — the publish-time gate cannot feed a retry, so extending its verdict was the wrong
shape. Both validators run in the same recipe-workers Lambda under the existing single Bedrock grantee
(layer 4b untouched, no second role), share the gate's answer-reader/reserve-then-settle/refusal
machinery as a library, and carry their own `callSite`s in the one $100 pool. The publish-time verifyLine
gate still judges the merged result afterward: the loop validates attempts, the gate validates what
ships. ADR-0024 owes one dated update naming the new consumers; its core (reserve-then-settle, ceiling,
prod-only, single grantee) stands unchanged.

**D7 — Ambiguity routes to the human ONLY when material.** The nutrient-equivalence bound is the
interruption test: immaterial ambiguity binds the ranked default silently (interrupting on every "pepper"
makes the product feel broken on the most common words in cooking); material ambiguity surfaces through
U14 (inline live; batched "N of M lines need your choice" post-import). Every pick feeds U10's
corroboration flywheel — Cronometer's correction-retrained importer (82%→92%) is direct precedent.
The ambiguity UX cannot replace the gate: cinnamon was CONFIDENT-wrong — no ambiguity flag fires;
detected uncertainty goes to the human, undetected wrongness to the gate.

**D8 — User-authored foods amend the single-writer ruling, deliberately and narrowly.** T150's rationale
(a recipe is a method, not a substance) is preserved — these are substances. The amendment needs its own
ADR: `source='user'` provenance, never masquerading as verified data; author-only editing initially;
community nutrition editing only behind a later moderation design. Peer-reviewed evidence: 27–37% of
crowdsourced entries carry >20% energy error; every scaled competitor fixed this with verified layers,
not better crowdsourcing. Corroboration-gated promotion (U10) is the trust mechanism.

Owner rulings 2026-08-30 (closing Q3 a-c):

- **Data shape**: macros-only at launch (calories/protein/carbs/fat + optional portions); feature 009
  owns the additive expansion to full nutrient rows (note added to `specs/009-nutrition-planning/spec.md`).
  The author may edit EVERYTHING in a food they own.
- **Erasure**: delete if unreferenced, orphan if referenced. Obligations: a cross-service reference check
  at erasure time, the mid-erasure reference race closed, and an orphaned food's owner pseudonymized the
  same way a tombstoned user's recipes are.
- **Visibility**: author-PRIVATE until promoted. Three consequent designs the D8 ADR must resolve:
  (a) the ADR-0020 cache split — the edge-cached nutrition endpoint serves only promoted foods; private
  foods ride an authenticated uncached path; (b) the rule for a public recipe referencing a private food
  (viewers get line name + recipe-side nutrition summary, not the entity; clone behavior needs a
  decision); (c) the promotion trigger — picking-based corroboration is impossible for an invisible food,
  so promotion likely keys on cross-author agreement (same normalized name, compatible macros, distinct
  authors — detectable via the per-author dedup index). Design in the plan.

**D9a — User-authored foods are a sibling CREATE endpoint; provenance is the route, never a field.**
`POST /foods/authored` → 201 + complete entity, beside add-by-name's 202 + PENDING. No `source` on the
wire — walking through the authored door IS the server-set provenance (AIP-203; the repo's own
by-name/by-food precedent and its documented rejection of flag-switched contracts). Author edit =
`PUT /foods/{id}` behind a pure `authorshipPolicy` (fourth ADR-0023-shape policy module). Never-synced is
structural: no `food_sources` crosswalk row. Dedup splits into two partial uniques (catalog-unique where
unowned; per-author where owned) — a one-way door designed in the D8 ADR. Recipe linking reuses `by-food`
admission unchanged. ⛔ The add endpoint does NOT grow rich user data: the shared ownerless row cannot
serve two trust levels, and per-line `user*` macro fields already carry user nutrition where the user has
authority. Research: 2026-08-30 API design pass (Google AIP-133/136/151/203, Azure LRO guidance, GitHub
template-repo split, Stripe symmetric-variant counterexample, OpenAPI discriminator codegen breakage).

**D9b — Recipe create stays POST; upsert is rejected with prejudice.** Create-only fenced fields
(`source`, `sourceLine`, `statedMeasure`) exist to block re-classification and gate-memo steering; upsert
cannot distinguish first-write from re-write and reopens both. Retry-safety, if ever needed, is an
`Idempotency-Key` on POST (import pipeline first). Optional food linkage confirmed good design: required
`ingredientId` on the wire, `foodId?` on the ingredient row behind it (anti-corruption seam), data-state
branching over the `FoodResolutionStatus` union. Minor tightening owed: `superRefine` pairing status with
foodId on the domain schema.

**D9 — API: one resource per operation, no polymorphic bodies.** `POST /recipes` (structured, foodId
optional per line) stays; parsing is an async job resource (`POST /recipe-parse-jobs` → 202 → poll → user
reviews → ordinary create); corrections are `PATCH` on the ingredient line (foodId set = bind; freeform =
re-enter pipeline). Full REST review at plan time with the mandatory staff-architect pass.

**D10 — Owner's pattern preference, recorded:** reactive/observable pipeline (RxJS is NestJS-native) for
the in-service filter chain; the `PENDING → RESOLVED` lifecycle remains the inter-process contract
(observables do not cross queue boundaries). Evaluate shape at plan time; the cascade's Chain of
Responsibility semantics (fixed order, first refusal, tested consultation sequence) are non-negotiable.

**D11 — Cheap adds from research, in scope:** synonym-reformulation retry before abstention
(FoodOntoRAG; "aubergine"→"eggplant", costs nothing); optional CPU cross-encoder rerank rung between
ladder and gate (33M-param class, fuses as a feature — similarity ≠ identity, it never overrides the
ladder); budget-aware abstention policy (near ceiling exhaustion the defer-to-LLM arm vanishes; a static
threshold misbehaves).

## Requirements

- R1. The lexical stage never binds without an earned band, a gate agreement, or a human pick.
- R2. Every gated decision is recorded (rung, margin-band, query-shape, verdict) — the band table.
- R3. Bands earn autonomy from measured agreement; authorized bands are shadow-sampled; decay revokes.
- R4. Funnel-honesty repairs (D4 a–c) ship with the tier itself.
- R5. FNDDS popularity prior built and fused as a ranking feature.
- R6. Foodness validator returns categorized verdicts; parse retry loop bounded at 3; un-parseable is a
  recorded terminal state; the line itself is always saved.
- R7. Measurement validation reuses verifyLine; no second measurement LLM.
- R8. Attempt provenance is carried on every merged parse result.
- R9. Material ambiguity surfaces through U14 on both platforms; immaterial binds silently with recorded
  provenance; corrections flow through U10 corroboration→promotion.
- R10. PENDING food entities for novel names, demand-counted, queued for source sync (U29); corroborated
  correction-promoted foods marked complete and excluded from USDA sync.
- R11. User-authored foods carry distinct provenance; nutrition editing gated per D8's amendment ADR.
- R12. Evaluation uses correct-SETS (adjudicated, U1 protocol) and reports against the measured ceiling;
  every ladder/prior/calibration change owes the corpus-wide bind diff (ADR-0026 lesson).
- R13. Parse API is a separate async job resource; recipe create keeps optional per-line foodId.

## Scope boundaries

**In:** everything above. **Deferred:** recipe-context-aware tie-breaking (breaks per-phrase memoization);
community nutrition moderation design; cross-encoder fine-tuning; conformal methods beyond soft signals.
**Out:** re-parse loops on resolution ambiguity (a correct parse cannot be improved by retrying);
per-consumer LLM sub-budgets (ADR-0024 §4c); any weakening of ADR-0026 engine independence; recipes as
food entities (T150 stands).

## Outstanding questions

All four owner rulings are IN (2026-08-30): Q1 → dedicated in-loop validators, same role (see D6);
Q3a → macros-only + 009 expansion; Q3b → delete-if-unreferenced / orphan-if-referenced;
Q3c → private-until-promoted + pseudonymized orphan owner. Remaining items are design-time, not rulings:

- Q2. The agreement bar and minimum-n for band autonomy (calibration, from the first corpus run).
- Q4. Whether the popularity prior applies at retrieval or only at rank fusion.
- Q5. The promotion trigger for private authored foods (cross-author agreement mechanism — plan-time
  design, see D8).
- Q6. Clone behavior for a recipe referencing a private authored food (plan-time design, see D8).

## Research references

FoodOntoRAG arXiv:2603.09758 (90.7% real-world; architecture validates ours; synonym-retry) ·
FoodSEM arXiv:2509.22125 (98%→36.9% OOD collapse) · EnsembleLink arXiv:2601.21138 (unsupervised expert
fusion as pre-label bridge) · Splink docs (disclaims single bag-of-words fields — skip record-linkage
frameworks) · PMC9980422 (dietitian IAA 33–71%) · JMIR 2020 / PMC7641788 (crowdsourced nutrition error
rates) · Cronometer recipe-importer blog (correction retraining 82%→92%) · Instacart embeddings blog
(popularity as ranking feature) · FNDDS 2021–2023 documentation (consumption-frequency source) ·
arXiv:2002.10199 (Platt vs isotonic crossover) · JMLR 24/21-0048 (reject-option) · arXiv:2202.13415
(conformal beyond exchangeability) · ACL Findings 2025 (embedding name bias).

---
title: Foodness-validator prompt optimization — seven rounds, a false summit, and a 43% loss reduction
date: 2026-08-30
type: measurement
relates_to: docs/plans/2026-08-30-001-feat-resolution-funnel-earned-autonomy-plan.md (U6, KTD-E)
---

# Foodness-validator prompt optimization

Ralph-loop optimization of the parse-validator prompt (`{isFood, taxonomy}` over one string), on
Amazon Nova Micro, under a pre-registered protocol: 50k labeled words (7,793 catalog names; hand-built
equipment/unit/tricky lists; ~42k blocklist-filtered dictionary words), stratified dev/holdout split,
paired McNemar significance, asymmetric loss (food-loss FN ×3, junk-pass FP ×1), two-strike stop rule,
holdout touched only for final numbers. ~275k calls, ≈ $2.60 total.

## The champion

The v1 system prompt (definition · untrusted-data line · JSON shape · culinary example · ingredients
line · recognition line) **plus three few-shot MESSAGE TURNS** — the turns are the entire difference:

```
user:      blorvik
assistant: {"isFood": false, "taxonomy": "unknown word"}
user:      springform pan
assistant: {"isFood": false, "taxonomy": "equipment"}
user:      lady fingers
assistant: {"isFood": true, "taxonomy": "biscuit"}
```

## Holdout results (untouched data, one pass each)

|                        | v1 (system only) | v1 + turns          |
| ---------------------- | ---------------- | ------------------- |
| accuracy               | 96.99%           | **98.26%**          |
| weighted loss          | 335              | **190 (−43%)**      |
| food-loss FN           | 17               | **8**               |
| junk-pass FP           | 284              | **166**             |
| equipment              | 93.1%            | **100%**            |
| units / tricky / plain | 100 / 100 / 100  | **100 / 100 / 100** |

Confirmation (10,999 fresh dev words, paired): +187/−41 flips, p<0.0001 — the screen effect replicated
without winner's-curse shrinkage. ~45% of residual dict "FPs" are measured label noise (the model
correctly knows obscure real foods — `liquorice`, `pekoe`, `bullaces`); effective accuracy ≈ 99%.

## ⛔ The false summit — the report's most important finding

Rounds 1–5 tested instruction-level variants, declared the v1 prompt the maximum (two-strike stop rule),
and KILLED five hypothesis families. The owner directed a scientific re-attack on the negative results;
**round 6 refinements overturned most of the kills**:

| family               | weak form (killed)                                     | refined form (result)                            |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| few-shot             | system-prompt example lines — p=0.0001 WORSE           | **real message turns — the champion, −43% loss** |
| certainty            | blanket "answer false if unsure" — failed confirmation | scoped to single words — p<0.0001 better         |
| consistency          | JSON field reorder — FN doubled                        | procedural phrasing — p<0.0001 better            |
| polysemy             | (untested in 1–5)                                      | one rule line — p<0.0001 better                  |
| negative enumeration | broad AND scoped — both p<0.0001 worse                 | stands killed (the one true kill)                |

Compositions added nothing on top of the turns (round 7: all p>0.15; KISS tiebreaker) — the turns
absorb what the clauses fix. Lesson, recorded for every future prompt experiment in this repo: **a
family kill is only as good as the strongest form tested; "no significant improvement" stop rules
measure the search's exhaustion, not the space's.** Also on the record: one harness bug (unguarded
JSON.parse — now three-valued), one voided confirmation (salvage reused 80% of the selection set —
caught by a disjoint check, redone clean), one depleted-strata screen (patched with a supplement).

## Model + operational notes

- **Nova Micro** is the validator model: ties Nova 2 Lite overall but beats it decisively on
  units-as-names (93% vs 83%) — the exact class the validator exists to catch — at ~¼ the price.
- **Claude Haiku 4.5 is not invocable on this account** (Bedrock's Anthropic use-case form was never
  submitted — an owner account action). The KTD-E cross-family pair rule is therefore unsatisfiable
  today; re-run this bake-off when/if Haiku unlocks.
- Residual known miss: `date` (calendar sense) — carried by the polysemy rule if ever needed, or a
  curated mapping. Reader-side consistency cross-check (taxonomy vs boolean) remains a free win:
  most residual errors are internal contradictions.
- Raw data: 30+ runs in the session scratchpad (`r1..r7, rF, hold*`); word sets, variants JSON, and
  the paired scorer alongside. Corpus files are scratchpad-only by rule and not committed.

## Update (2026-08-31) — the SHIPPED module's verification runs (plan U6)

The pinned artifact now ships as `@kitchensink/recipe-core/parsing/foodness-prompt` +
`foodness-answer` (SHA `67fa4c10…` over the canonical structured serialization of system + turns), and
two live runs were made THROUGH the shipped modules (`packages/shared/recipe-core/scripts/foodnessHoldoutRun.ts`):

**1. Tolerance-band verification over the committed holdout** (`src/parsing/__fixtures__/foodnessHoldout.tsv`,
10,002 words): overall **98.13%** (band ≥ 97.5% ✓), food-loss FN **9** (band ≤ 12 ✓), junk-pass FP 167,
could-not-judge 11 (the reader's new consistency cross-check absorbing hedges), equipment/units/tricky/plain
**100/100/100/100**. The shipped module reproduces the champion within the band — the ±0.13pt drift vs the
report's 98.26% is inside run-to-run variance on an unpinned model version, exactly the class the band exists
to absorb.

**2. The parsed-name population** (KTD-E's transfer caveat, measured): the 771 unique food names the 1919
replay's LLM leg produced. **81.1% isFood=true, 146 false, 0 could-not-judge.** The false verdicts are
overwhelmingly the validator doing its job on mis-segmented residue — `Bake`→verb, `a bowl`→equipment,
`Cook gently`→instruction, `butler`→occupation, `baking-pan`→equipment — i.e. exactly the material the
retry loop (U7) exists to bounce. **Known residual, recorded before any policy treats 98.26% as the
operating point:** a `<state> water/fat` class reads false with a food-shaped taxonomy (`boiling water`→
liquid, `cold water`→liquid, `hot fat`→ingredient — 9 of the 146). These are real ingredients; in the U7
loop each costs retries and, exhausted, an un-parseable line — the curated-mapping tier is the named
safety net, and the retry context ("not a food (liquid)") gives the parser a correction signal. The
inverse-contradiction shape (`isFood: false` + food-shaped taxonomy) is deliberately NOT gated by the
reader's cross-check — gating it needs a food-shaped-taxonomy list that the open taxonomy would rot.

# The validator loop over the full corpus — and the foodness judge's operating point on parsed names

**Date:** 2026-09-19 · **Run:** `scripts/validatorCorpusDiff.ts`, the full 1919 _International Jewish
Cook Book_, 2,490 ingredient clauses, Nova 2 Lite at `--concurrency 6`, **$7.15**.

This is the corpus-wide diff ADR-0026 names as the check any change to the parse loop owes — a unit
suite structurally cannot verify it, because the three food losses that taught the rule were found only
this way. It is also, separately, the verification run `foodnessPrompt.ts` says is owed: that file's own
transfer caveat records that the 98.26% holdout measured **catalog names and dictionary words**, while
production input is **parsed names**, and that the operating point on that population "is measured by
this unit's verification run, never assumed."

## 1. Census

| kind               | lines |
| ------------------ | ----- |
| `unchanged`        | 1,618 |
| `retried-changed`  | 210   |
| `no-food-returned` | 557   |
| `not-a-food`       | 73    |
| `unavailable`      | 32    |

## 2. The check that matters: silent food losses

**`kind === 'food-loss'` is 0.** That bucket is reached only when a first attempt named a food, the
final named none, and _neither_ terminal review reason was set — a loss nothing flagged.

92 lines (3.69%) did go from a named food to none, and every one carries an explicit terminal record:
`no-food-returned` 46, `not-a-food` 40, `unavailable` 6. None lands as a clean parse, and under the
no-cache-failures ruling none is remembered.

## 3. The attempt bound holds

| attempts | 1     | 2   | 3   | 4   | (unavailable) |
| -------- | ----- | --- | --- | --- | ------------- |
| lines    | 1,618 | 736 | 31  | 73  | 32            |

Maximum observed is 4 — `MAX_PARSE_ATTEMPTS`, i.e. one call plus three retries. 840 lines (33.7%)
retried at all; 73 (2.9%) spent the whole budget.

The three stop rules compose as specified, and the numbers separate them:

- **R2** (foodless twice, stop) is the 736-line mass at exactly two attempts.
- **R4** (same answer twice, stop) reaches the bad-name class deliberately: **44 of the 73
  `not-a-food` lines stop at attempt 2**, not at the budget.
- **R3** (full budget for a parser still producing new readings) is the other side: **43 of the 73
  cap-hits end `no-food-returned`**, having produced a different reading each time.

⚠️ The cap-hit count and the `not-a-food` count are both 73 and are **not the same 73** — only 23 lines
are both. The coincidence is worth stating so nobody later reads one figure as the other.

## 4. What caches, on this corpus

1,845 of 2,490 rows (74.1%) name at least one food. That is an **upper bound on what the cache keeps**,
not the count: `bindsNothing` also excludes `name_is_source_line`, and the diff report does not record
`reviewReasons`, so the true figure is at or below it.

The 645 rows naming no food re-parse on every submission. ⚠️ That proportion is a property of **this
corpus's segmentation**, not a production forecast — the harness parses
`buildParseCorpus(harvestSourceTexts(...).clauses)`, and in a 25-line random sample 24 are cooking
instructions mis-segmented as ingredient lines (`rub to a cream`, `put on a platter`, `set in a cool
place`) and one is a truncated ingredient. Production ingredient lines do not arrive that way.

## 5. ⛔ The finding: the foodness judge on PARSED NAMES

Every distinct parsed name the corpus produced (728) was judged once through the shipped artifact
(`buildFoodnessPrompt` + `readFoodnessAnswer`, Nova Micro, $0.0081):

| verdict         | names | share |
| --------------- | ----- | ----- |
| food            | 646   | 88.7% |
| not a food      | 82    | 11.3% |
| could not judge | 0     | —     |

Most of the 82 are **correct**: 14 equipment (`colander`, `jelly-bag`, `preserving kettle`), colors
(`brown`, `white`), verbs (`mix`, `boiled`), adjectives (`large`, `whole`), `spoonful`, `four and
one-half pounds`, and the two cleaning-recipe chemicals this book really does contain (`ammonia`,
`Babbitt's lye`).

About eleven reject a real ingredient, and on most of them **the model contradicts itself** — it answers
`isFood: false` under a taxonomy that names a food category:

| taxonomy returned | names rejected                            |
| ----------------- | ----------------------------------------- |
| `beverage`        | `boiling water`, `hot water`, `ice-water` |
| `ingredient`      | `cold water`, `hot fat`, `boiling fat`    |
| `liquid`          | `drippings`                               |
| `spice`           | `mace`                                    |
| `bone`            | `soup bone`                               |

A second group is internally consistent and still wrong, under the prompt's deliberate "only say a
string names a food if you recognize it" rule: `whites`, `rind`, `pie plant` (rhubarb), `green kern`
(freekeh), `kitchen bouquet`, `schalet dough`.

### The pattern is the modifier, and it cuts both ways

Probed directly against the same artifact:

```
water        FOOD        hot water / cold water / boiling water / ice-water   NOT-FOOD
egg whites   FOOD        whites                                               NOT-FOOD
lemon rind   FOOD        rind                                                 NOT-FOOD
```

A temperature word **attached** flips a food to not-a-food; a head noun **stripped** of its modifier
does the same. Both shapes are properties of parsed names, and neither is in the holdout population —
which is precisely the transfer the artifact's docstring refused to assume.

## 6. Blast radius and containment

The loop is wired into the production parse Lambda (`recipe-workers/src/handlers/parseLine.ts`), not
only the operator CLI, so this is the shipped path. Production deploys no parse Lambda today.

Containment is real but partial: every affected line carries a review reason and none is cached, so
nothing is silently published — but a cook whose recipe says `four quarts cold water` gets that line
held for review rather than parsed.

## 7. What was deliberately NOT changed

A narrower repair was considered and **rejected on this run's own data**: reading `isFood: false` under
a food-naming taxonomy as `could-not-judge`, which R25 treats as absence. It fails because the
vocabulary it needs has false members — `liquid` → "substance" and `bouquet` → "flowers" are _correct_
rejections, and `flour smooth` → "ingredient", `acid flavor` → "ingredient" and `sweet sour` →
"flavor" are parse artifacts, not ingredients. Reclassifying them to absence makes `validate` return
`null`, and the line then lands **cached with `needsReview: false`** — the exact class the empty-list
check at the top of `validate` was added to repair. It would buy ~9 genuine repairs and pay ~5–7
regressions in the direction U11 ranks unacceptable.

Re-tuning the prompt is a **new experiment** by that artifact's own rule, on a pre-registered protocol,
and a 728-name sample from one book is not the population to re-tune against. Recorded here for the
owner's ruling rather than hot-patched.

## 8. Residual

Every rate here comes from one 1919 cookbook — the limit ADR-0026's residual already states, unchanged
by this run. The 32 `unavailable` rows are spread across 24 separate 40-line batches with no shared
line shape, so they read as transient transport failures on the ungated operator path, not a systematic
class.

## 9. What this run changed — the judged subject

⛔ **The temperature class was never a prompt defect, and the lexicon it appeared to need already
exists.** `modifierLexicon.ts` has filed `hot`/`cold`/`boiling` as preparation since KTD-11b, and
`canonicaliseFood` — the comparator's own "ONE normalisation that also applies to what is STORED" —
already moves them: `cold water` merges to `{ name: 'water', prep: 'cold' }`, verified against the real
function. **The stored data was never wrong.**

The judge, however, is an engine-port decorator over the LLM leg, so it runs UPSTREAM of that merge and
was handed `cold water` — a string this pipeline never stores. Measured here: the judge answers FOOD for
`water` and `fat`, and NOT-FOOD for `cold water`, `hot water`, `boiling water`, `hot fat` and
`boiling fat`. Placement changes the name on exactly **5 of the 82 rejected names**, covering 18
line-instances and **10 of the 73 terminal `not_a_food` lines (14%)**.

`validate` now judges `canonicaliseFood(food).name` and reports a genuine rejection under the name the
MODEL wrote, so the retry is shown its own words. No prompt byte moved; `FOODNESS_PROMPT_SHA256` is
untouched, and no experiment was needed.

⚠️ **THE 5-of-82 FIGURE IS ONE-DIRECTIONAL, and the other direction was measured separately.** It counts
only names already rejected. Placement also APPENDS: an identity word in `prep` moves INTO the name, so
`{ name: 'sugar', prep: 'granulated' }` is now judged as `granulated sugar` — a name that PASSED before
could in principle fail now, and that is invisible to the count above. Probed against the real judge over
12 purchasable forms (`granulated`/`powdered`/`brown sugar`, `canned tomatoes`, `large eggs`, `fresh
parsley`, `sweet butter`, `sifted flour`, `condensed milk`, `blanched almonds`, `small onion`, `sour
cream`): **0 regressions**. The asymmetry is explicable — the judge fails on TRANSIENT state
(temperature), not on identity modifiers, which are how catalog foods are named in the first place.

⚠️ `ice-water` is NOT in this set — it is a single hyphenated token, so placement does not split it, and
it remains a real rejection. So do `drippings`, `mace` and `soup bone`, which carry no modifier.

## 10. Owed, with the blocker named

**Eight curated mappings** (`ingredient_resolution_mappings`, `scope = 'global'`): `pie plant` → rhubarb,
`green kern` → freekeh, `kitchen bouquet`, `schalet dough`, `mace`, `soup bone`, `whites` → egg white,
`rind`. ⚠️ This is a CURATION task, not a code change, and it is blocked on two things that do not exist
yet: a catalog `food_id` for each target, and a write path for a global mapping (`seed.ts` does not touch
this table). Do not "unblock" it by loosening the prompt's recognition clause — that clause is what
produces the 100% equipment score.

**Segmentation is the larger mass and is NOT started here.** 645 lines returned no food; of a 25-line
random sample, 24 were cooking instructions mis-segmented as ingredient lines. `no-food-returned` leads
`not-a-food` **7.6 : 1** (557 vs 73), and on 511 of those 557 the first attempt also named nothing — so
the foodness judge never ran at all. 1,355 of 3,475 attempts (39.0%) were spent on lines that ended with
no food. It has an open question already recorded in this repo (the pronoun-food case, `a small one` →
`foods: ['one']`), and it deserves a plan rather than an increment.

**Intermediate products are a class nothing can currently catch.** **109** food mentions in the final
answers are recipe OUTPUTS stored as recipe INPUTS, counted over a named vocabulary (⚠️ a lexicon, so a
floor rather than an exhaustive count). The six largest — `dough` 29, `cream` 24, `batter` 15, `syrup` 11,
`sauce` 9, `soup` 8 — are 96 of them. The
foodness judge passes every one of them CORRECTLY, because they genuinely are foods, so no prompt, no
lexicon and no validator can ever detect this by construction. Unscoped.

## 11. ⚠️ A limitation of this harness, stated because the numbers above depend on it

`validatorCorpusDiff.ts` runs the **LLM leg alone** — it builds `createValidatedLlmEngine` over
`createLlmEngine` and nothing else: no CRF, no `compareParses`, no merge. Production passes `crf`
unwrapped and decorates only the LLM, and `crfRescuedTheFoods` fires when the LLM's list is empty and the
CRF's is not. So every food-loss figure here **overstates production loss by an unmeasured amount**, and
only the 17 lines whose final list is non-empty (0.68% of the corpus) are beyond the rescue's reach.

The engine is importable locally (`ingredient_parser` on Python 3.10), so a CRF-enabled re-run is
feasible at roughly the same cost as this one. Until it is run, the whole-list figures are an upper bound
on loss, not a measurement of it.

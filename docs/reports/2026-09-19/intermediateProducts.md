# Intermediate products stored as ingredients — the scope of the problem

**Date:** 2026-09-20 · **Status:** SCOPED, NOT STARTED. Nothing here is built, and one of the two obvious
designs is already ruled out (see §5).

## 1. The class

A recipe OUTPUT appearing in another recipe's INPUT list: `dough`, `cream`, `batter`, `syrup`, `sauce`,
`soup`. `validatorLoopCorpusDiff.md` §10 counts 109 such mentions over the 1919 corpus, of which those six
terms are 96 — ⚠️ **counted over a named vocabulary, so a floor rather than an exhaustive count**, and taken
from one book. Every figure below inherits both limits; this document mints no new number and none should be
quoted from it as a measurement.

The line `roll out the dough` and the line `one cup of flour` are read by the same pipeline, and the first
one resolves `dough` against the food catalog like any other name.

## 2. ⛔ Why no control in the parse leg can catch it — by construction, not by omission

The foodness judge answers FOOD for every one of these terms, and it is **right**: `dough` is a food, `cream`
is a food, `soup` is a food. There is no prompt wording, no lexicon entry and no validator verdict that
separates "the cream you buy" from "the cream this recipe told you to whip", because the difference is not a
property of the string. A judge shown only the string cannot see it.

And the judge is shown only the string on purpose. ADR-0026 §1 pins `buildParsePrompt` to one parameter in
invariant position, and `ParseEnginePort.parse` takes source lines and nothing else — the seam that keeps the
two engines independent. **Adding recipe context to the parse leg is not a small change to this pipeline; it
is the thing this pipeline is built to refuse.** Any design that begins "tell the model what recipe the line
came from" is answered by that rule before it is evaluated on its merits.

## 3. What context actually exists, layer by layer — the table that decides where this can live

| layer                                                                             | has the line | has the recipe's title / steps                                                                                                                                      | has the corpus's other recipes |
| --------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `buildParsePrompt`, `ParseEnginePort.parse`                                       | yes          | **no, and pinned so** (ADR-0026 §1)                                                                                                                                 | no                             |
| `runParsePipeline`                                                                | yes          | no — its inputs are `readonly string[]`                                                                                                                             | no                             |
| the deployed parse job (`recipe_parse_jobs`, `recipe_parse_job_lines`)            | yes          | **no — the table carries `owner_id` and `status`, and the line rows carry `source_line`; there is no recipe id and no title.** A parse job is a paste, not a recipe | no                             |
| `cookbook-import`'s comparison corpus (`harvestSourceTexts` → `buildParseCorpus`) | yes          | **no — the harvest flattens each candidate to its clause texts, and the corpus de-duplicates book-wide**, so a clause's containing recipe is gone                   | no                             |
| `toCandidateRecipe`'s `RecipeCandidateOutcome`                                    | yes          | **yes** — `title`, `ingredients[].sourceText`, `steps`, `droppedLines`                                                                                              | yes, across a run              |
| `POST /api/v1/recipes` (what a cook submits)                                      | yes          | yes                                                                                                                                                                 | no                             |

⛔ **The deployed pipeline has no recipe context at all.** That is the single most important line of this
document: the production parse leg is not merely forbidden recipe context, it does not possess it. A parse
job is a paste of lines owned by a cook. Detection therefore cannot be added to the parse leg by relaxing a
rule — there is nothing to relax it toward.

Detection can only live **downstream of parsing, where a whole recipe exists**, or — in the import tool
only — **upstream of the corpus flattening**, at `toCandidateRecipe`.

## 4. The three candidate signals, and what each is actually worth

**The recipe's own outputs (a sibling recipe's title).** "Is there a recipe in this book titled `Pie
Dough`?" This is the only signal that speaks to intermediacy rather than to phrasing, and it exists only
where a corpus of recipes exists — the import tool, not a cook's paste. It is also unreliable in the
direction that matters: a 1919 cookbook titles its pastry recipe `Plain Paste`, and the line that uses it
says `dough`. **Unmeasured.** §6 is a measurement of exactly this before anything is built on it.

**Position in the recipe.** Already present, already carried: `LineOrigin` (`ingredient` vs `dropped`)
distinguishes a clause the extractor accepted as an ingredient from one it did not. ⚠️ But §4 of the corpus
report has already measured the confound — in a 25-line random sample of the 645 foodless lines, 24 were
cooking instructions mis-segmented as ingredient lines. **An unknown share of the 109 is therefore the
segmentation mass §10 already owes a plan, not a separate class**, and the two must be separated by
measurement before either is designed. ⚠️ That mass now has a plan in flight —
`docs/plans/2026-09-20-001-feat-instruction-lines-never-reach-the-parser-plan.md`, whose §3 rules that
the repair belongs at line ADMISSION and not in the clause segmenter — so §6 below is worth running
AFTER it lands, when the population it leaves behind is the one this class is actually about. Answering "how many are mis-segmented instructions" is nearly free,
and it may shrink this problem to something not worth building for.

**The line's verb.** `roll out the dough` states an action. This is the segmentation layer's question, and
that layer already owns exactly this shape of vocabulary — ADR-0026 §7a's vessel rule and `measuresNoSubstance`
are both there, and both were settled by position rather than by the word alone. A verb test would detect a
mis-segmented instruction; it would not detect `two cups of thick cream` in a genuine ingredient list, which
is the half of the class that is not a segmentation defect.

**A made-product lexicon** — the vocabulary §10's own count was taken over — is NOT a fourth signal, and
§7 of that report already rejected the shape: every one of the six terms has a purchasable sense (heavy
cream, maple syrup, canned soup, tomato sauce). A lexicon can say "this word is sometimes a made product";
it cannot say "this occurrence is one".

## 5. What it would break

⛔ **The design to refuse first.** "Register the recipe that produces `dough` as a food so the line can
resolve to it" is the recipe-to-food write-back **DECIDED NO** (001 T150, 2026-08-08; amended but not
weakened by ADR-0029): a recipe is a method, not a substance. The fact that it presents here as a resolution
bug makes it more tempting, not less. Nothing in this class may create a food row.

⛔ **A recipe-scoped verdict cannot be cached per line.** `ingredient_parse_cache` is keyed on the line
alone and is global across users — `findForLines` carries no owner predicate — so a decision that depended on
the surrounding recipe would be served to a different recipe's identical line. Anything recipe-scoped belongs
beside the recipe, not in that table.

⚠️ **Labelling trades a wrong answer for an absent one.** Today `dough` resolves to whatever the catalog
offers and contributes that food's nutrition to the recipe summary. Marking the line as an intermediate means
it contributes none. That is very likely the right trade and it is still a **product decision with a visible
consequence** — 001's nutrition summary changes for affected recipes — so it is an owner ruling, not an
engineering judgement.

## 6. The first bounded increment: a measurement, not a mechanism

**Do not build a detector first.** Build the number that tells you whether a detector has anything to detect.

Over the operator's already-downloaded book — ⛔ no network, no Gutenberg fetch (ADR-0023), no Bedrock, no
CRF — run the in-repo pure stages `segmentCookbook` → `toCandidateRecipe`, and for each accepted candidate
report, per lexicon term:

1. the `LineOrigin` split of its mentions (`ingredient` vs `dropped`) — **how much of this is segmentation**;
2. whether the same book carries an accepted candidate whose `title` contains that term — **does the
   sibling-recipe signal exist at all**;
3. the per-term breakdown, because `cream` and `dough` may not behave alike and a single rate would hide it.

It spends nothing, it runs offline, and it can **kill the idea cheaply**: if few mentions have a sibling
recipe, the only signal left is the lexicon §7 already rejected, and the honest answer is to fold what
remains into the segmentation plan §10 owes rather than to open a second workstream.

## 7. Deliberately not proposed

No prompt change (§2), no new engine leg, no food-service write of any kind (§5), and no detector ahead of
§6's measurement.

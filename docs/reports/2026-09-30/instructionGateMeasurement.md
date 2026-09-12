# Instruction gate: the free measurement (plan 001 §6)

**Date:** 2026-09-30. **Plan:** `docs/plans/2026-09-20-001-feat-instruction-lines-never-reach-the-parser-plan.md`.
**Code measured:** `readsAsInstruction`, with its vocabulary in `instructionLexicon.ts`. It was measured in
`recipe-import-core` and now lives in `packages/tools/cookbook-import/src/parsing/lineAdmission.ts`, unchanged. It
runs in the cookbook import only (see Decisions). Nothing here spent Bedrock.

## How to reproduce

```bash
cd packages/tools/cookbook-import
npx tsx scripts/instructionGateCorpusDiff.ts \
  --nyt ../../../.local-sandbox/corpora/nytIngredients.csv \
  --book <path to pg12350.txt> \
  --out <report.json>
```

- Run 1 reads the NYT ingredient corpus: 179,207 rows, each with a `name` a person wrote. A skipped row with a name
  is a false refusal.
- Run 2 reads the 2,490 clauses harvested from the 1919 book (Gutenberg #12350, downloaded by hand, ADR-0023). The
  local CRF names the foods in each clause. A skipped clause the CRF named something in goes on a list a person reads.

## Result

| Rule                                        | NYT skipped | NYT false refusals | 1919 skipped | 1919 false refusals (read by hand) |
| ------------------------------------------- | ----------- | ------------------ | ------------ | ---------------------------------- |
| Verb first, no quantity of a food           | 26          | 25                 | 529          | many                               |
| Closed-world (shipped in the Specification) | 0           | 0                  | 151          | 0 of 151                           |

The first rule failed the ship gate on both runs. The NYT false refusals were real ingredient-list lines that open
with a verb: `Add salt to taste`, `Sprinkle of sugar`, `Grease and flour for pan`, `Season with salt and pepper`,
`serve with rice`, `Fry bacon slices`. In the 1919 book many skipped clauses are the only place a food is stated:
`add a carrot`, `Boil a few potatoes`, `cut up an onion`, `sprinkle a little salt`, `Soak some bread`.

The closed-world rule has two conditions. The line opens with an imperative cooking verb. Every other word is a
number or is known to name no food: a function word, an adverb, a method adjective, a vessel or a no-substance
measure. If a line holds an unknown word, the rule lets it through, because an unknown word is how a food appears.
A quantity of a food needs no condition of its own, because the unit or the food after the number is an unknown
word. An earlier draft kept a separate quantity condition, and it misread `three-quarters of an hour` as an amount
of food; without it the rule skips 15 more method lines and still no ingredient. All 151 skipped 1919 clauses are
method lines that name no food, for example
`bake in a moderate oven one hour`, `put in a bowl`, `strain through a sieve`, `bring to a boil`,
`Grease a deep dish`.

The rule reads words the way the not-a-food lexicon does: split on whitespace, drop punctuation, and keep a
hyphenated word whole. That fold keys `frying-pan` and `stew-pan` as vessels, so `put in a stew-pan` is now skipped.
It also makes `well-heated` and `dish-pan` unknown words, so `bake for twenty minutes in a well-heated oven` and
`turn it into a dish-pan` now reach the parser. All three are method lines, so the false-refusal count does not
move. The first measurement split words on letters and skipped 152.

A word belongs to a quantity phrase only when every letter of it lies inside the phrase. So `(four` is part of
`four and a half`, but `eggs` in `Beat 2eggs` is judged as a word, and the line reaches the parser. Neither corpus holds
a verb-led line with a food glued to its number, so this case is pinned by unit tests, not by these runs.

## What it costs

The rule is safe and it catches little.

- In the 1919 book it skips 151 clauses. The 2026-09-19 report counted 645 clauses that returned no food, so the
  gate saves about a quarter of that waste.
- In modern ingredient lists it skips nothing: no NYT row is a pure method line.
- Modern whole-recipe pastes are not measured. Their method lines usually name a food
  (`Add the onions and cook until soft`), which the closed-world rule lets through, so the catch there is likely
  small.

## Decisions

The owner decided all three on 2026-10-01: _"Cookbook import only."_

1. Is the catch worth building? Only in the cookbook import. The rule moved into `cookbook-import`, and
   `runImport.ts` keeps a skipped clause from both parse engines. The clause is still imported, with the
   extractor's own reading. The paste path is unchanged, so no set of modern pastes is needed.
2. Does a skipped method line ever become a recipe step on the paste path? No. The paste path does not run the
   gate, so it skips no line.
3. Can recipe-service depend on recipe-import-core? It does not need to. recipe-service gains no dependency, and
   recipe-import-core no longer exports the rule.

⚠️ What the import saves, measured 2026-10-01: nothing on this book. The import sends only the clauses the
extractor accepts, and it skips 0 of the 1,842. All 151 skipped clauses above are clauses the extractor drops, and
the import never sends a dropped clause to an engine. An accepted clause starts at its amount, and the rule needs a
verb first. The 151 reach an engine only in the paid corpus runs (`scripts/validatorCorpusDiff.ts`,
`scripts/parseModelComparison.ts`), which send the whole corpus. The gate does not filter those runs. A filter
there changes the 2,490 lines that their reports count. The owner ruled on 2026-10-01 to keep the gate in the import
and leave the paid runs unfiltered.

A whole-book import with the local CRF and no model created the same 350 recipes and 1,809 lines before and after
the change. Every create body was byte-identical.

The paid run (run 3, the full pipeline with the CRF enabled, about $2.80) was not needed to answer these.

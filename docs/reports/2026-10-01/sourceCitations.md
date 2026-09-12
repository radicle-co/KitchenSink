# The seed's source citations (curated plan U24)

This report records how the 390 roots with no USDA item got their citations on 2026-10-01. The plan is
`docs/plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md` (R50, KTD-20, KTD-22, U24). ADR-0052 records the
sources and the policy.

## Result

`packages/services/food-service/src/foods/seed/data/sourceCandidates.tsv` lists 886 candidates for 376 roots. Each
candidate names its dataset, and each key was read from its own table before it was listed. The seed image resolves
every candidate against its dataset's extract and asserts that each root cites the policy's choice. The committed
seed composes, so the policy agrees with all 390 citations.

| Choice                                       | Roots |
| -------------------------------------------- | ----- |
| USDA FNDDS                                   | 83    |
| CIQUAL 2025                                  | 60    |
| USDA SR Legacy or Foundation, same substance | 40    |
| CoFID 2021                                   | 30    |
| Japan's Standard Tables                      | 12    |
| Matvaretabellen 2026                         | 9     |
| Livsmedelsdatabasen 2026-07-01               | 2     |
| Canadian Nutrient File 2015                  | 7     |
| USDA Branded product (kept)                  | 133   |
| No numbers                                   | 14    |

Each table's extract is committed under `data/<source>/` with its pins. `npm run seed:table-extract` rebuilt every
extract from the pinned published files, and each one was reproduced byte for byte. An independent Python reader
of the same files agreed with every extractor value for value.

Livsmedelsdatabasen's upstream is its whole-table workbook, `LivsmedelsDB_202610020056.xlsx` (version 2026-07-01),
downloaded from the agency's search site and pinned like every other published file. An earlier draft captured its API
responses for the 38 candidate keys instead; the workbook reproduced 226 of those 228 values exactly, and the two that
differ are traces the workbook states as 0, on foods no root cites. The owner ruled on 2026-10-01 to use the data under
CC BY 4.0 (ADR-0052 §8), and that static downloads belong in the seed. Its carbohydrate is
available carbohydrate calculated by difference, so it is stored as `CHOAVLDF`. Its 40 candidates moved from the
held list into `sourceCandidates.tsv`, and the policy chose it for two roots: dip mix, which had no numbers, and
Madeira, which cited a generic FNDDS entry. Every other root kept a higher-ranked candidate.

## Judgement calls

- A candidate's grade follows the plan's definitions. Exact is the same food in the same state. Same substance is
  the same food in another form. Close is a near variant, such as another cultivar, cut or preparation with similar
  macros. Generic is only a broader category.
- Seven grades were raised from generic to close under those definitions: blood oranges, brown jasmine rice (three
  tables), frozen mixed fruit and garlic paste. Ranch dip stays generic, because the table's dip has twice the
  Branded product's energy.
- Fifteen roots had two candidates that ranked equally. The policy now refuses a tie instead of using file order,
  so each was settled by grade. A brand-specific entry is close (the KIND bar, Chex Mix, mirin-style seasoning). A
  broader entry is generic (average black olives, plain white salt, salty light miso, the real-seafood salad beside
  the surimi one). Duplicate SR Legacy and Foundation stand-ins keep one item.
- The root "whole duck" gained SR 172408 (duck, meat and skin, raw) as a same-substance stand-in, which the policy
  ranks first. It is the item of the root "duck meat". The root "frozen whole duck" cited the same stand-in and
  differed only in storage, so it became a synonym of "whole duck" (owner, 2026-10-01).
- No entry is graded exact for two roots, because an exact citation names its root at live search (R19, owner
  2026-10-01). CIQUAL 1023 ("Brandy, Armagnac or Cognac type") and Livsmedelsdatabasen 1921 ("Cognac or brandy")
  each stand for two foods, so each is graded close for every root that lists it. Armagnac and cognac now cite
  FNDDS 2710699 (brandy), close, and brandy keeps the same entry as exact.
- "Pizza crust" and "polenta" each split in two, because each mixed two states (owner, 2026-10-01). Baked "pizza
  crust" cites CIQUAL 96778 (pizza dough, prepacked, cooked), and the new raw "pizza dough" cites CIQUAL 37001.
  Ready-made "polenta" cites CoFID 11-905 (polenta, hydrated), and the new "dry polenta" cites CIQUAL 9614
  (pre-cooked, raw). Each Branded product stays a candidate and loses to a table entry with energy.
- A citation below exact lends numbers and names no root. 49 root citations are close or generic USDA entries
  that no item owns, over 37 distinct keys, so a live hit on one of those keys shows under USDA's own description.
  Every same-substance stand-in cites an item that a root owns, so its hit still shows under that root.
- Foundation 748608 (extra virgin olive oil) is a declared alias of olive oil, and SR 168812 (Italian ice) is an
  excluded restaurant item. Both stay citations rather than root items.

## Held candidates

`heldSourceCandidates.tsv` beside this report lists 74 candidates that cannot be cited yet:

- 73 from BLS 4.0, which needs an operator download from blsdb.de.
- 1 CIQUAL entry, 18046, whose values have more than three decimal places.

When BLS arrives, its extractor is written against the downloaded file and these candidates join the next pass.
About 25 roots then change citation.

## Roots with no numbers

14 roots have no admissible candidate: absinthe, almond extract, Angostura bitters, bottled yerba mate, cooking
sauce, drinking vinegar, ground sumac, juniper berries, marinade, orange bitters, salad kits, sambal oelek, star
anise and white tea. Four of them (Angostura bitters, bottled yerba mate, orange bitters and sambal oelek) have a BLS
candidate in the held list.

The FoodOn cross-references (NCBITaxon species and EFSA FoodEx2 codes) led to candidates for three roots that had
none before: marjoram (CoFID 13-891, close), shad roe (Japan 10222, close) and makrut lime leaves (CIQUAL 11080,
generic).

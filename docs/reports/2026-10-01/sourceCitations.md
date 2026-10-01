# The seed's source citations (curated plan U24)

This report records how the 389 roots with no USDA item got their citations on 2026-10-01. The plan is
`docs/plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md` (R50, KTD-20, KTD-22, U24). ADR-0052 records the
sources and the policy.

## Result

`packages/services/food-service/src/foods/seed/data/sourceCandidates.tsv` lists 842 candidates for 374 roots. Each
candidate names its dataset, and each key was read from its own table before it was listed. The seed image resolves
every candidate against its dataset's extract and asserts that each root cites the policy's choice. The committed
seed composes, so the policy agrees with all 389 citations.

| Choice                                       | Roots |
| -------------------------------------------- | ----- |
| USDA FNDDS                                   | 82    |
| CIQUAL 2025                                  | 59    |
| USDA SR Legacy or Foundation, same substance | 41    |
| CoFID 2021                                   | 29    |
| Japan's Standard Tables                      | 12    |
| Matvaretabellen 2026                         | 9     |
| Canadian Nutrient File 2015                  | 7     |
| USDA Branded product (kept)                  | 135   |
| No numbers                                   | 15    |

Each table's extract is committed under `data/<source>/` with its pins. `npm run seed:table-extract` rebuilt every
extract from the pinned published files, and each one was reproduced byte for byte. An independent Python reader
of the same files agreed with every extractor value for value.

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
- Both whole-duck roots gained SR 172408 (duck, meat and skin, raw) as a same-substance stand-in, which the policy
  ranks first. It is the item of the root "duck meat".
- Foundation 748608 (extra virgin olive oil) is a declared alias of olive oil, and SR 168812 (Italian ice) is an
  excluded restaurant item. Both stay citations rather than root items.

## Held candidates

`heldSourceCandidates.tsv` beside this report lists 118 candidates that cannot be cited yet:

- 73 from BLS 4.0, which needs an operator download from blsdb.de.
- 41 from Livsmedelsdatabasen, which waits for the owner's ruling on its download terms.
- 3 for "pizza crust" and "polenta", which wait for the owner's ruling on splitting those roots.
- 1 CIQUAL entry, 18046, whose values have more than three decimal places.

When BLS arrives, its extractor is written against the downloaded file and these candidates join the next pass.
About 25 roots then change citation.

## Roots with no numbers

15 roots have no admissible candidate: absinthe, almond extract, Angostura bitters, bottled yerba mate, cooking
sauce, dip mix, drinking vinegar, ground sumac, juniper berries, marinade, orange bitters, salad kits, sambal oelek,
star anise and white tea. Several of them have a BLS or Livsmedelsdatabasen candidate in the held list.

The FoodOn cross-references (NCBITaxon species and EFSA FoodEx2 codes) led to candidates for three roots that had
none before: marjoram (CoFID 13-891, close), shad roe (Japan 10222, close) and makrut lime leaves (CIQUAL 11080,
generic).

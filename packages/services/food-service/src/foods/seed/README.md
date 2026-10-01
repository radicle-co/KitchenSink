# Food catalog seed

The food catalog's seeded rows come from the committed curated seed in `data/` (the curated catalog plan,
`docs/plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md`). Plan units U3 to U7 build the deploy seed
step that applies it on every stage. Nothing else writes a seeded row: the hand tools that used to
(`seed:usda-bulk`, `catalog:clear`, `catalog:reseed`) are retired (plan U16).

## What is committed

- `data/curatedCatalog.jsonl`, `data/catalogChanges.json` and `data/namingRules.md`: the curated seed, parsed by
  `catalog/curatedSeedFormat.ts` and composed over the USDA baseline by `catalog/seedImage.ts`.
- `data/usda/srLegacy201804.zip` and `data/usda/foundation20260430.zip`: the SR Legacy and Foundation
  downloads, pinned by name and SHA-256 in `data/usda/sourcePins.json` and read through
  `archive/usdaSourceArchive.ts`.
- `data/usda/brandedExtract20260430.jsonl`: the cited Branded products (see below).
- `data/foodPopularity.jsonl`: the FNDDS popularity weights (see below).

To move to a new USDA release, commit the new archive and its pin together. The seed digest
(`@kitchensink/db-schema-guard`'s `readSeedManifest`) then names the change.

---

## The seed-owned refresh exclusion (F-C2, curated catalog plan U4)

A seeded root's item carries a natural key, which makes `food_item.seed_owned` true (0018 replaced the old
`origin` column with it). The live change-refresh scan (`FoodSourcesDao.listResolvedBackingItems`) selects
`status = 'RESOLVED' AND NOT seed_owned`.

**This exclusion is correctness-critical, not a quota nicety.** A bulk crosswalk row's `item_version` is a
content hash (`bulk:<sha256>`), which can never equal an API `publicationDate`. Without the gate:

1. every sweep would see "changed" and re-enqueue the food **forever**, and the drain's
   `mergeChangedSources` would **overwrite the lab-analyzed bulk nutrition with API values**; and
2. ~8k live re-fetches per sweep would drain the **shared 1,000/hr per-IP USDA window** (~8h/sweep),
   starving interactive demand — for nothing, since SR Legacy never changes upstream.

Seeded foods change only when the committed seed changes. Seed-owned foods are excluded from **nothing
else** — they are fully searchable and readable like any other golden record.

**Do not** move this marker to `food_sources.fetch_state`: that column is CHECK-constrained to
`fetched`/`error` and is overwritten by every `upsertSource`.

---

## Design notes

- `src/sources/usda/bulk/` owns the bulk file format — it and `usda.adapter.ts` are the only places USDA's
  native `fdc_id` is named (FR-IDN-2). It emits source-agnostic `CanonicalCandidate`s.
- The bulk mapper is **not** a reuse of the adapter's private `mapToCanonical` (different schema entirely),
  but it **does** import the adapter's `(name, unit)` canonicalization so a bulk value and a live value for
  the same nutrient resolve to one `nutrient` dictionary row (DB-5). Bulk `UG` is mapped to the API's `µg`
  for exactly that reason.
- Peak memory is bounded by the **selected** set, not the file size: `food.csv` is filtered first, then the
  nutrient/portion files are streamed and retained only for the selected `fdc_id`s.

## FNDDS/WWEIA consumption prior (`seed:fndds-prior`, plan U5; curated seed plan U1)

Regenerates the committed `data/foodPopularity.jsonl`: one raw consumption weight per SR Legacy item,
`{"item":"fdc:N","weight":W}`, sorted by FDC id. It writes no database. The curated seed carries the file, so
every stage ranks search the same way (R45); an item's weight is the sum of its source rows' weights, and the
seed derives the prior fraction from that sum. **Nothing deployed fetches USDA or CDC.**

Every input is pinned by SHA-256 in `data/usda/sourcePins.json` (`fnddsPrior`), and a file that does not match
its pin is refused before it is read:

1. **FNDDS survey foods** (FDC): `FoodData_Central_survey_food_csv_2024-10-31.zip` from
   `https://fdc.nal.usda.gov/download-datasets`, passed as the zip itself (`survey_fndds_food.csv` +
   `input_food.csv` are read from inside it).
2. **SR Legacy** (the NDB→fdc_id crosswalk): read from the COMMITTED `data/usda/srLegacy201804.zip`, so the
   weights key to exactly the items the seed holds.
3. **NHANES day-1 intake frequencies**: `wweia_day1_frequencies.csv`, derived from the cycle's `DR1IFF_L.xpt`
   (`https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/DR1IFF_L.xpt`). XPT is a SAS transport format
   with no maintained Node reader, so this is a documented pandas step. The tool reads only the `DR1IFDCD`
   and `weighted` columns; the pinned file also carries `events` and `grams`, so this step derives the same
   weights but not the same bytes, and a re-derivation needs a new, deliberate pin:

    ```bash
    python3 - <<'PY'
    import pandas as pd
    df = pd.read_sas('DR1IFF_L.xpt', format='xport')
    df.groupby('DR1IFDCD').agg(weighted=('WTDRD1', 'sum')).to_csv('wweia_day1_frequencies.csv')
    PY
    ```

Then:

```bash
npm run seed:fndds-prior --workspace=packages/services/food-service -- \
    --survey-zip …/FoodData_Central_survey_food_csv_2024-10-31.zip \
    --intake-csv …/wweia_day1_frequencies.csv [--write]
```

The run reports the SR-Legacy match rate (95.3% of intake weight on the 2021-2023 cycle) and
**fails loudly** if any coverable row of the 14-query staple set received no prior. Three staples are NAMED
structural exceptions (`fnddsPrior.ts` `STAPLE_EXPECTATIONS`): vanilla extract and mace never appear as
FNDDS ingredients, and olive oil decomposes only to post-SR-Legacy NDBs. By default it then compares its output
with the committed file and exits non-zero on any difference; `--write` rewrites the file.

## Branded Foods extract (`seed:branded-extract`, curated seed plan U1, KTD-20)

`data/usda/brandedExtract20260430.jsonl` holds the rows of every Branded product `data/sourceCandidates.tsv` lists
under USDA. The 449 MB upstream download is not committed; its name and SHA-256 are pinned beside the extract's.
Rebuild and compare by hand (CI never runs this):

```bash
npm run seed:branded-extract --workspace=packages/services/food-service -- \
    --upstream …/FoodData_Central_branded_food_csv_2026-04-30.zip [--write]
```

It exits non-zero unless the rebuilt extract equals the committed one byte for byte. `--write` rewrites the
extract and prints its SHA-256; it never edits `sourcePins.json`, whose pins are changed by hand.

## Other cited tables (`seed:table-extract`, curated seed plan U23, KTD-20)

A root with no USDA item cites the best admitted table (`docs/architecture/decisions/0052-food-data-sources.md`).
Each table's extract holds one line per key `data/sourceCandidates.tsv` lists under that source, in the format of
`archive/sourceExtract.ts`. Its pins sit beside it: `data/<source>/sourcePins.json` names each published file by
role with its SHA-256, and the extract with its own. FNDDS is USDA's, so its entry is `fndds` in
`data/usda/sourcePins.json`. The published files are not committed. Rebuild and compare by hand:

```bash
npm run seed:table-extract --workspace=packages/services/food-service -- \
    --source cofid --upstream-dir <the directory holding the published files> [--write]
```

It checks every published file against its pin before the extractor reads a byte, and exits non-zero unless the
rebuilt extract equals the committed one byte for byte. `--write` rewrites the extract and prints its SHA-256. You
then set `extractSha256` by hand. BLS 4.0, Livsmedelsdatabasen and the Swiss table have no extractor until an
operator downloads their files in a browser, because their sites refuse scripted downloads.

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
    --dataset cofid --upstream-dir <the directory holding the published files> [--write]
```

It checks every published file against its pin before the extractor reads a byte, and exits non-zero unless the
rebuilt extract equals the committed one byte for byte. `--write` rewrites the extract and prints its SHA-256. You
then set `extractSha256` by hand. BLS 4.0 and the Swiss table have no extractor until an operator downloads their
files in a browser, because their sites refuse scripted downloads.

Livsmedelsdatabasen's upstream is its whole-table workbook, the "Ladda ner Livsmedelsdatabasen" download on
soknaringsinnehall.livsmedelsverket.se. The site builds the workbook on each request: its file name and its zip
entries carry the time of the download, so a later download will not match the pin byte for byte. Keep the pinned
file. It is the only copy the extract can be rebuilt from.

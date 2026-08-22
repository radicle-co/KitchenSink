# USDA bulk-seed importer — runbook

Stage 1 of the ingredient-search design (`docs/plans/2026-07-26-ingredient-search-usda-blended-autocomplete.md`).

Imports the USDA FoodData Central **Foundation + SR Legacy** bulk datasets (~8.2k lab-analyzed whole foods)
into the food catalog as **RESOLVED golden records** marked `origin='bulk'`.

- **Zero USDA API quota.** The bulk datasets are HTTP _downloads_, not API calls. Nothing in this importer
  touches the rate-limited USDA API, at ingest **or** at refresh (bulk foods are excluded from the live
  change-refresh scan — see [The `origin` column](#the-origin-column-f-c2)).
- **Branded is NOT seeded** (~2M manufacturer-submitted rows). It stays an on-demand concern.
- **Idempotent + resumable.** Re-running is safe and cheap: an unchanged food is skipped without a write.

---

## 1. Download and extract the dataset (operator step, deliberately outside the importer)

The importer takes a **local directory**. Fetching is a separate step so a re-run never re-downloads
hundreds of MB, and so the importer is trivially testable and offline-safe.

Pick the dataset zips from <https://fdc.nal.usda.gov/download-datasets/> — the filenames carry a release
date, so **check the page for the current ones** rather than pasting these verbatim.

```bash
mkdir -p tmp/fdc && cd tmp/fdc

# SR Legacy (~6 MB, 7,793 foods; a FROZEN dataset — never re-issued since 2018-04)
curl -fL -O https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
unzip -o FoodData_Central_sr_legacy_food_csv_2018-04.zip

# Foundation (~4 MB, 469 foods; re-issued roughly twice a year)
curl -fL -O https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip
unzip -o FoodData_Central_foundation_food_csv_2026-04-30.zip

ls */food.csv   # each zip extracts into its own directory
```

You may also point the importer at the **full download**
(`FoodData_Central_csv_<date>.zip`, ~480 MB zipped / ~3.4 GB extracted). It contains both datasets plus
Branded; the importer filters to `data_type IN ('foundation_food','sr_legacy_food')`, so Branded is never
seeded — it just costs you the disk and the read.

### Files the importer reads

| File                | Required? | Used for                                                                      |
| ------------------- | --------- | ----------------------------------------------------------------------------- |
| `food.csv`          | **yes**   | `fdc_id`, `data_type` (the filter), `description`, `publication_date`         |
| `food_nutrient.csv` | **yes**   | `fdc_id`, `nutrient_id`, `amount`                                             |
| `nutrient.csv`      | **yes**   | `id` → nutrient `name` + `unit_name`                                          |
| `food_portion.csv`  | optional  | `fdc_id`, `measure_unit_id`, `portion_description`, `modifier`, `gram_weight` |
| `measure_unit.csv`  | optional  | `id` → measure-unit `name`                                                    |

A missing **required** file, or a header missing a required column, aborts the run with a
`UsdaBulkFormatError` naming the file. That is deliberate: FDC changes this schema between releases
without notice (`food_nutrient.csv` has 11 columns in the per-dataset zips and 13 in the full download),
so columns are resolved by **header name** and validated up front rather than silently importing nulls.

---

## 2. Run the schema migration first

The importer requires migration `0003_food_origin.sql` (`food.origin`). Deployed stages apply migrations by
invoking the in-VPC migrate Lambda; locally the integration harness applies the ordered SQL directly.

## 3. Run the import

```bash
# Bounded smoke run FIRST — 50 foods, verify the golden records look right.
DATABASE_URL=postgres://user:pass@host:5432/kitchensink_food \
  npm run seed:usda-bulk --workspace=packages/services/food-service -- \
    --dir tmp/fdc/FoodData_Central_sr_legacy_food_csv_2018-04 --limit 50

# Then the full dataset (drop --limit). Repeat per dataset directory.
DATABASE_URL=… npm run seed:usda-bulk --workspace=packages/services/food-service -- \
    --dir tmp/fdc/FoodData_Central_sr_legacy_food_csv_2018-04
DATABASE_URL=… npm run seed:usda-bulk --workspace=packages/services/food-service -- \
    --dir tmp/fdc/FoodData_Central_foundation_food_csv_2026-04-30
```

| Flag / env                    | Meaning                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `--dir <path>`                | Directory holding the extracted CSVs. Required (or `USDA_BULK_DIR`).    |
| `--limit <n>`                 | Process at most `n` foods — the bounded smoke run.                      |
| `DATABASE_URL`                | Direct connection string (local / port-forwarded).                      |
| `DB_HOST`/`DB_PORT`/`DB_NAME` | Deployed alternative: connects as `food_app` via RDS IAM (no password). |

Because the food RDS instance is private, a deployed run is either a one-off ECS `RunTask` on the existing
food task definition with `--command` pointed at this script, or a port-forwarded session from a bastion.

### Output

Structured JSON lines on stdout: `bulk-foods-selected` → `bulk-rows-loaded` → `bulk-seed-progress` (every
250 foods) → `bulk-seed-complete`, plus one `bulk-seed-food-failed` per failed food.

```json
{
    "level": "info",
    "component": "food-bulk-seed",
    "message": "bulk-seed-complete",
    "total": 7793,
    "seeded": 7793,
    "refreshed": 0,
    "unchanged": 0,
    "failed": 0
}
```

| Count       | Meaning                                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
| `seeded`    | Brought to RESOLVED from a non-RESOLVED state (fresh, reactivated, or disambiguated). |
| `refreshed` | Already RESOLVED; bulk values re-merged in place (you imported a newer revision).     |
| `unchanged` | Already RESOLVED with the same content version — skipped, no write.                   |
| `failed`    | Threw; logged and skipped. **Exit code is non-zero when `failed > 0`.**               |

### Exit codes

| Code | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| `0`  | Every food imported.                                                               |
| `1`  | `failed > 0`, a bad `--dir`/`--limit`, a malformed CSV, or `BulkSeedAbortedError`. |

`BulkSeedAbortedError` fires after **25 consecutive** failures — the signal that the problem is systemic
(missing migration, revoked grant, exhausted pool) rather than one bad row. Fix the cause and re-run.

### Re-running / recovery

Always safe. Idempotency comes from a find-or-create on the `(usda, fdc_id)` crosswalk, so a re-run:

- **skips** unchanged foods (one crosswalk read + one food read each — a full 7,793-row re-run is seconds);
- **re-merges in place** foods whose bulk content changed (values updated, portions replaced not appended,
  crosswalk row identity preserved so every provenance FK still resolves);
- never duplicates a `food` row, a crosswalk row, or a portion.

So after a crash, a `failed > 0` run, or a new dataset release: just run it again with the new directory.

---

## 4. Verify

```sql
-- How many bulk golden records landed, and are they all RESOLVED?
SELECT origin, status, count(*) FROM food GROUP BY 1, 2 ORDER BY 1, 2;

-- Spot-check one record end to end.
SELECT f.name, n.name AS nutrient, n.unit, fn.amount
  FROM food f
  JOIN food_nutrients fn ON fn.food_id = f.id
  JOIN nutrient n ON n.id = fn.nutrient_id
 WHERE f.normalized_name = 'broccoli, raw';

-- The F-C2 invariant: NO bulk food may appear in the live change-refresh scan.
SELECT count(*) FROM food_sources fs JOIN food f ON f.id = fs.food_id
 WHERE f.status = 'RESOLVED' AND f.origin = 'bulk';  -- these are EXCLUDED from the scan by design
```

---

## Clearing the catalog before a reseed (U12a) — ⛔ TWO SERVICES, ONE ORDER

A reseed mints FRESH ULIDs, so it invalidates every `ingredients.food_id` the recipe service holds. That
column is an **opaque cross-service reference with NO foreign key**, so nothing in either database catches a
dangling one: clear the food catalog first and every recipe silently points at a deleted row.

**The recipe-side unlink runs FIRST, and must finish, before one food row is deleted.** The clear enforces
this itself — it reads the recipe database and aborts on any non-zero linked count — but the order is still
the operator's to run. (Same discipline as ADR-0001's preview-address teardown, where reversing the two
steps manufactures a takeover window.)

```bash
# 1. RECIPE SIDE — look first…
STAGE=sandbox DATABASE_URL="$RECIPE_DATABASE_URL" \
    npm run ingredients:unlink --workspace=@kitchensink/recipe-service -- --dry-run

# …then null food_id + food_resolution_status IN PLACE (no row is deleted).
STAGE=sandbox DATABASE_URL="$RECIPE_DATABASE_URL" \
    npm run ingredients:unlink --workspace=@kitchensink/recipe-service -- --confirm sandbox

# 2. FOOD SIDE — the dry run answers "would the clear be permitted?", which is a question about (1).
STAGE=sandbox DATABASE_URL="$FOOD_DATABASE_URL" RECIPE_DATABASE_URL="$RECIPE_DATABASE_URL" \
    npm run catalog:clear --workspace=packages/services/food-service -- --dry-run

STAGE=sandbox DATABASE_URL="$FOOD_DATABASE_URL" RECIPE_DATABASE_URL="$RECIPE_DATABASE_URL" \
    npm run catalog:clear --workspace=packages/services/food-service -- --confirm sandbox

# 3. Then RESEED (U12b, below). Nothing repopulates the catalog on its own.
```

Both commands share one guard:

| Flag                    | Meaning                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--stage` / `STAGE`     | Required, no default. A destructive task that guesses its stage has no guard.                                 |
| `--confirm <stage>`     | Required for a run that writes; must EQUAL the resolved stage. A dry run needs none.                          |
| `--allow-prod`          | Required on `prod`, and **rejected** on any other stage — a flag that is harmless when wrong becomes habit.   |
| `--dry-run`             | Reports the counts, writes nothing.                                                                           |
| `--recipe-database-url` | Clear only. Required always; a probe that cannot answer fails CLOSED rather than reading as "nothing linked". |

Both are idempotent and exit non-zero on any refusal, so a scripted invocation cannot mistake "the guard
said no" for "there was nothing to do". The clear removes `food` and the eight tables that cascade off it;
the `nutrient` and `food_category` dictionaries are left, because the reseed finds them rather than
re-minting them.

---

## Reseeding after a clear (U12b) — `catalog:reseed`

`seed:usda-bulk` (§3) imports ONE directory with no stage guard: it is the Stage 1 tool, and it predates
the reset. `catalog:reseed` is the **reset's** other half — the same importer, driven by the catalog
**roster** and wearing the same guard the clear wears, because it is still a bulk write against shared
data that mints fresh ULIDs.

```bash
# 1. LOOK first. Reads the extractions, counts what would be imported, writes nothing.
STAGE=sandbox DATABASE_URL="$FOOD_DATABASE_URL" \
    npm run catalog:reseed --workspace=packages/services/food-service -- \
      --dir tmp/fdc/FoodData_Central_sr_legacy_food_csv_2018-04 \
      --dir tmp/fdc/FoodData_Central_foundation_food_csv_2026-04-30 --dry-run

# 2. Then import. Same flags, plus the stage typed back.
STAGE=sandbox DATABASE_URL="$FOOD_DATABASE_URL" \
    npm run catalog:reseed --workspace=packages/services/food-service -- \
      --dir tmp/fdc/FoodData_Central_sr_legacy_food_csv_2018-04 \
      --dir tmp/fdc/FoodData_Central_foundation_food_csv_2026-04-30 --confirm sandbox
```

| Flag                | Meaning                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `--stage` / `STAGE` | Required, no default (as above).                                                     |
| `--confirm <stage>` | Required for a run that writes; must EQUAL the resolved stage. A dry run needs none. |
| `--allow-prod`      | Required on `prod`, **rejected** on any other stage.                                 |
| `--dry-run`         | Reads the extractions, reports the counts, writes nothing.                           |
| `--dir <path>`      | **Repeatable** — one extracted download per dataset. Required (or `USDA_BULK_DIR`).  |
| `--limit <n>`       | Cap on candidates taken from EACH directory — the bounded smoke run.                 |

The run logs `catalog-reseed-starting` (naming the server it actually reached, before writing) and
`catalog-reseed-finished` with the tallies, the catalog counts before/after, and `wouldProceed`.

### The post-condition — and why it cannot roll back

The clear asserts inside its transaction; a reseed cannot (thousands of foods, thousands of
transactions). So `assertCatalogReseeded` runs **after** the write and reports **every** violated check at
once: an empty catalog, any failed candidate, rows not marked `origin='bulk'` when the catalog started
empty, and the alias check below. Exit is non-zero; nothing is rolled back; the import is idempotent, so
the remedy is always "fix the cause and re-run".

### ⚠️ The reseed lands NO aliases — read this before concluding U2 is broken

`food.aliases` is **NULL across the entire reseeded catalog**, on purpose and by measurement.

USDA publishes curated "additional descriptions" only for **Survey (FNDDS)** foods. The roster this
reseed ships (`catalogDatasets.ts`) enables `foundation_food` + `sr_legacy_food`, and both were verified
live against FDC on 2026-08-21 to carry none. So a reseed does **not**, by itself, make U2's alias ranking
observable — aliases reach the catalog only through the live acquisition path (`UsdaSourceAdapter`), one
on-demand food at a time. Every run reports the position it is in (`aliasesExpected: false`,
`foodsWithAliases: 0`) rather than leaving it to be inferred.

⛔ **Whether to seed FNDDS is an owner decision, not an engineering one.** FNDDS is composite prepared
dishes ("Cheese, cheddar, prepared"); admitting ~5.4k of them into a catalog whose job is "which
ingredient is this recipe line?" puts dishes in direct competition with ingredient rows — immediately
before the ranking work that would be measured against them. The roster carries the entry **disabled**,
with its reasoning, so enabling it is a one-word decision rather than a rewrite.

⚠️ Enabling it also needs reader work, and the reseed will say so rather than seed silently: the bulk zips
carry additional descriptions in `food_attribute.csv` + `food_attribute_type.csv`, which
`usdaBulk.reader.ts` does not read. A roster whose enabled datasets declare `carriesAliases` but whose
import lands zero aliases **fails the post-condition**.

---

## The `origin` column (F-C2)

`food.origin` is `'live'` (default) or `'bulk'`. The live change-refresh scan
(`FoodSourcesDao.listResolvedBackingItems`) selects `status = 'RESOLVED' AND origin <> 'bulk'`.

**This exclusion is correctness-critical, not a quota nicety.** A bulk crosswalk row's `item_version` is a
content hash (`bulk:<sha256>`), which can never equal an API `publicationDate`. Without the gate:

1. every sweep would see "changed" and re-enqueue the food **forever**, and the drain's
   `mergeChangedSources` would **overwrite the lab-analyzed bulk nutrition with API values**; and
2. ~8k live re-fetches per sweep would drain the **shared 1,000/hr per-IP USDA window** (~8h/sweep),
   starving interactive demand — for nothing, since SR Legacy never changes upstream.

Bulk foods are re-freshened by re-running this importer against the next bulk download. Bulk-origin foods
are excluded from **nothing else** — they are fully searchable and readable like any other golden record.

**Do not** move this marker to `food_sources.fetch_state`: that column is CHECK-constrained to
`fetched`/`error` and is overwritten by every `upsertSource`.

---

## Design notes

- `src/sources/usda/bulk/` owns the bulk file format — it and `usda.adapter.ts` are the only places USDA's
  native `fdc_id` is named (FR-IDN-2). It emits source-agnostic `CanonicalCandidate`s.
- `src/foods/seed/bulkSeed.service.ts` is **source-agnostic**: it never names USDA, `fdcId`, or CSV, so a
  future bulk source reuses it unchanged.
- The bulk mapper is **not** a reuse of the adapter's private `mapToCanonical` (different schema entirely),
  but it **does** import the adapter's `(name, unit)` canonicalization so a bulk value and a live value for
  the same nutrient resolve to one `nutrient` dictionary row (DB-5). Bulk `UG` is mapped to the API's `µg`
  for exactly that reason.
- Foods are processed **sequentially**: each runs one transaction that takes the per-name advisory lock and
  touches the shared `nutrient` dictionary, so concurrency would buy contention, not throughput.
- Peak memory is bounded by the **selected** set, not the file size: `food.csv` is filtered first, then the
  nutrient/portion files are streamed and retained only for the selected `fdc_id`s.

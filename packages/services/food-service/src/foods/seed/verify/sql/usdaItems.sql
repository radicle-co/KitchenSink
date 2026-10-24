-- The USDA universe and each item's facts, read from the two pinned archives' CSVs (curated catalog plan U1, U6, R48,
-- KTD-27, KTD-28). Restates `usdaBulk.reader.ts` (which rows are read, and which fields are trimmed),
-- `usdaItemFactsOf` in `baselineSeed.ts`, and `mapBulkNutrients`/`mapBulkPortions` in `usdaBulk.parser.ts`.
--
-- The universe is every `sr_legacy_food` row of the SR Legacy archive and every `foundation_food` row of the
-- Foundation archive that `foundation_food.csv` lists. A Map keyed by id keeps the LAST row read for an id, which is
-- what `DISTINCT ON … ORDER BY ordinal DESC` restates. Every field the reader reads is trimmed as JavaScript trims it,
-- except `description`, which the reader keeps whole.

-- ── The archives' CSVs, side by side, tagged by archive ───────────────────────────────────────────────
CREATE TEMP TABLE v_usda_file_food AS
    SELECT 'sr'::text AS archive, ordinal, fdc_id, data_type, description, food_category_id, publication_date
      FROM v_raw_sr_food
    UNION ALL
    SELECT 'fd', ordinal, fdc_id, data_type, description, food_category_id, publication_date
      FROM v_raw_fd_food;

CREATE TEMP TABLE v_usda_file_food_nutrient AS
    SELECT 'sr'::text AS archive, ordinal, pg_temp.v_js_trim(fdc_id) AS fdc_id,
           pg_temp.v_js_trim(nutrient_id) AS nutrient_id, pg_temp.v_js_trim(amount) AS amount
      FROM v_raw_sr_food_nutrient
    UNION ALL
    SELECT 'fd', ordinal, pg_temp.v_js_trim(fdc_id), pg_temp.v_js_trim(nutrient_id), pg_temp.v_js_trim(amount)
      FROM v_raw_fd_food_nutrient;

CREATE TEMP TABLE v_usda_file_food_portion AS
    SELECT 'sr'::text AS archive, ordinal, pg_temp.v_js_trim(fdc_id) AS fdc_id, pg_temp.v_js_trim(amount) AS amount,
           pg_temp.v_js_trim(measure_unit_id) AS measure_unit_id,
           pg_temp.v_js_trim(portion_description) AS portion_description, pg_temp.v_js_trim(modifier) AS modifier,
           pg_temp.v_js_trim(gram_weight) AS gram_weight
      FROM v_raw_sr_food_portion
    UNION ALL
    SELECT 'fd', ordinal, pg_temp.v_js_trim(fdc_id), pg_temp.v_js_trim(amount), pg_temp.v_js_trim(measure_unit_id),
           pg_temp.v_js_trim(portion_description), pg_temp.v_js_trim(modifier), pg_temp.v_js_trim(gram_weight)
      FROM v_raw_fd_food_portion;

-- ── The lookups (`loadBulkLookups`): keyed by the trimmed id, a blank id skipped, the last row for an id kept ──
CREATE TEMP TABLE v_usda_nutrient_definition AS
    SELECT DISTINCT ON (archive, id) archive, id, name, unit_name
      FROM (
          SELECT 'sr'::text AS archive, ordinal, pg_temp.v_js_trim(id) AS id, pg_temp.v_js_trim(name) AS name,
                 pg_temp.v_js_trim(unit_name) AS unit_name
            FROM v_raw_sr_nutrient
          UNION ALL
          SELECT 'fd', ordinal, pg_temp.v_js_trim(id), pg_temp.v_js_trim(name), pg_temp.v_js_trim(unit_name)
            FROM v_raw_fd_nutrient
      ) AS rows
     WHERE id <> ''
     ORDER BY archive, id, ordinal DESC;

CREATE TEMP TABLE v_usda_measure_unit AS
    SELECT DISTINCT ON (archive, id) archive, id, name
      FROM (
          SELECT 'sr'::text AS archive, ordinal, pg_temp.v_js_trim(id) AS id, pg_temp.v_js_trim(name) AS name
            FROM v_raw_sr_measure_unit
          UNION ALL
          SELECT 'fd', ordinal, pg_temp.v_js_trim(id), pg_temp.v_js_trim(name) FROM v_raw_fd_measure_unit
      ) AS rows
     WHERE id <> ''
     ORDER BY archive, id, ordinal DESC;

CREATE TEMP TABLE v_usda_food_category AS
    SELECT DISTINCT ON (archive, id) archive, id, description
      FROM (
          SELECT 'sr'::text AS archive, ordinal, pg_temp.v_js_trim(id) AS id,
                 pg_temp.v_js_trim(description) AS description
            FROM v_raw_sr_food_category
          UNION ALL
          SELECT 'fd', ordinal, pg_temp.v_js_trim(id), pg_temp.v_js_trim(description) FROM v_raw_fd_food_category
      ) AS rows
     WHERE id <> ''
     ORDER BY archive, id, ordinal DESC;

-- `readFoundationMembers`: the current Foundation items and their NDB numbers; a blank number is none.
CREATE TEMP TABLE v_usda_foundation_member AS
    SELECT DISTINCT ON (fdc_id) fdc_id, nullif(ndb_number, '') AS ndb_number
      FROM (
          SELECT ordinal, pg_temp.v_js_trim(fdc_id) AS fdc_id, pg_temp.v_js_trim("NDB_number") AS ndb_number
            FROM v_raw_fd_foundation_food
      ) AS rows
     WHERE fdc_id <> ''
     ORDER BY fdc_id, ordinal DESC;

-- `statesEnergy`: the ids whose rows state a finite number for an energy definition in kcal (1008, 2048, 2047).
CREATE TEMP TABLE v_usda_energy AS
    SELECT DISTINCT archive, fdc_id
      FROM v_usda_file_food_nutrient
     WHERE nutrient_id IN ('1008', '2048', '2047') AND pg_temp.v_states_value(amount);

-- ── The universe (`streamBulkFoodBundles` pass 1, then `readArchiveItems`) ─────────────────────────────
CREATE TEMP TABLE v_usda_item AS
    SELECT selected.archive,
           selected.fdc_id,
           'fdc:' || selected.fdc_id AS item_key,
           selected.description,
           selected.publication_date,
           selected.archive = 'fd' AS is_foundation,
           category.description AS food_group,
           CASE WHEN member.ndb_number IS NOT NULL THEN 'foundation:' || member.ndb_number END AS lineage_key,
           member.ndb_number,
           energy.fdc_id IS NOT NULL AS has_energy
      FROM (
          SELECT DISTINCT ON (archive, fdc_id) archive, fdc_id, description, publication_date, food_category_id
            FROM (
                SELECT archive, ordinal, pg_temp.v_js_trim(fdc_id) AS fdc_id, pg_temp.v_js_trim(data_type) AS data_type,
                       description, pg_temp.v_js_trim(publication_date) AS publication_date,
                       pg_temp.v_js_trim(food_category_id) AS food_category_id
                  FROM v_usda_file_food
            ) AS rows
           WHERE fdc_id <> ''
             AND data_type = CASE archive WHEN 'sr' THEN 'sr_legacy_food' ELSE 'foundation_food' END
           ORDER BY archive, fdc_id, ordinal DESC
      ) AS selected
      LEFT JOIN v_usda_foundation_member member ON selected.archive = 'fd' AND member.fdc_id = selected.fdc_id
      LEFT JOIN v_usda_food_category category
             ON category.archive = selected.archive AND category.id = selected.food_category_id
      LEFT JOIN v_usda_energy energy ON energy.archive = selected.archive AND energy.fdc_id = selected.fdc_id
     WHERE selected.archive = 'sr' OR member.fdc_id IS NOT NULL;

-- ── Each item's nutrient rows (`mapBulkNutrients`): a defined nutrient, a storable amount, a non-empty canonical name
--    and unit, and the first row in file order for each `(name, unit)` ─────────────────────────────────
CREATE TEMP TABLE v_usda_item_nutrient AS
    SELECT DISTINCT ON (item_key, name, unit) item_key, name, unit, amount
      FROM (
          SELECT item.item_key, row.ordinal, pg_temp.v_canonical_nutrient_name(definition.name) AS name,
                 pg_temp.v_canonical_bulk_unit(definition.unit_name) AS unit, row.amount
            FROM v_usda_item item
            JOIN v_usda_file_food_nutrient row ON row.archive = item.archive AND row.fdc_id = item.fdc_id
            JOIN v_usda_nutrient_definition definition
              ON definition.archive = row.archive AND definition.id = row.nutrient_id
           WHERE pg_temp.v_is_storable_amount(row.amount)
      ) AS mapped
     WHERE name <> '' AND unit <> ''
     ORDER BY item_key, name, unit, ordinal;

-- ── Each item's portions (`mapBulkPortions`, KTD-28): a label, and a storable positive gram weight ─────────
CREATE TEMP TABLE v_usda_item_portion AS
    SELECT item_key, ordinal, label, gram_weight
      FROM (
          SELECT item.item_key, row.ordinal,
                 pg_temp.v_portion_label(row.amount, coalesce(unit.name, ''), row.portion_description, row.modifier)
                     AS label,
                 row.gram_weight
            FROM v_usda_item item
            JOIN v_usda_file_food_portion row ON row.archive = item.archive AND row.fdc_id = item.fdc_id
            LEFT JOIN v_usda_measure_unit unit ON unit.archive = row.archive AND unit.id = row.measure_unit_id
      ) AS mapped
     WHERE label IS NOT NULL
       AND pg_temp.v_is_storable_amount(gram_weight)
       AND gram_weight::float8 > 0;

ANALYZE v_usda_item;
ANALYZE v_usda_item_nutrient;
ANALYZE v_usda_item_portion;

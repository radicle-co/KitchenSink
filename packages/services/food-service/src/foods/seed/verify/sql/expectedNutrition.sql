-- The nutrition the committed seed implies: one header per owner, its one citation, its values, and the serving a
-- citation states (curated catalog plan U6, R9, R18, R39, R49, R50, R53, R54, KTD-19, KTD-20, KTD-22, KTD-23, KTD-24,
-- OQ-1, OQ-2). Restates `rootNutrition`/`ownItemNutrition`/`citedServing` in `seedProjection.ts`, the citation's
-- dataset as the image resolves it, and `toPer100g`, `labelPer100g` and `brandedPer100g` in `basisConversion.ts`.
--
-- Every owner is keyed by its natural key: a root by its seed key, a variant by its item's key.

-- ── KTD-23: each stored definition's INFOODS tag and its `nutrient` dictionary entry (`NUTRIENT_DEFINITIONS`) ─────
CREATE TEMP TABLE v_nutrient_tag (tag text NOT NULL, name text NOT NULL, unit text NOT NULL);

INSERT INTO v_nutrient_tag (tag, name, unit) VALUES
    ('ENERC_KCAL', 'Energy', 'kcal'),
    ('ENERC_KJ', 'Energy', 'kj'),
    ('PROCNT', 'Protein', 'g'),
    ('FAT', 'Total lipid (fat)', 'g'),
    ('CHOCDF', 'Carbohydrate, by difference', 'g'),
    ('CHOAVL', 'Carbohydrate, available', 'g'),
    ('CHOAVLM', 'Carbohydrate, available (monosaccharide equivalents)', 'g'),
    ('CHOAVLDF', 'Carbohydrate, available, by difference', 'g'),
    ('FIBTG', 'Fiber, total dietary', 'g');

-- ── KTD-22: each dataset a citation names, and the registered source it belongs to (`DATASET_SOURCE`) ─────────
CREATE TEMP TABLE v_citation_dataset (dataset text NOT NULL, source text NOT NULL);

INSERT INTO v_citation_dataset (dataset, source) VALUES
    ('usdaSrFoundation', 'usda'),
    ('usdaFndds', 'usda'),
    ('ciqual', 'ciqual'),
    ('cofid', 'cofid'),
    ('bls', 'bls'),
    ('stfcj', 'stfcj'),
    ('matvaretabellen', 'matvaretabellen'),
    ('livsmedelsverket', 'livsmedelsverket'),
    ('fsvo', 'fsvo'),
    ('cnf', 'cnf'),
    ('usdaBranded', 'usda'),
    ('label', 'manufacturerLabel');

-- ── The committed extracts, by dataset and the dataset's own key (KTD-20) ────────────────────────────────────
CREATE TEMP TABLE v_extract_line AS
    SELECT dataset, doc ->> 'key' AS key, doc
      FROM (
          SELECT 'usdaFndds'::text AS dataset, line::jsonb AS doc FROM v_raw_extract_usdafndds WHERE line <> ''
          UNION ALL SELECT 'ciqual', line::jsonb FROM v_raw_extract_ciqual WHERE line <> ''
          UNION ALL SELECT 'cofid', line::jsonb FROM v_raw_extract_cofid WHERE line <> ''
          UNION ALL SELECT 'bls', line::jsonb FROM v_raw_extract_bls WHERE line <> ''
          UNION ALL SELECT 'stfcj', line::jsonb FROM v_raw_extract_stfcj WHERE line <> ''
          UNION ALL SELECT 'matvaretabellen', line::jsonb FROM v_raw_extract_matvaretabellen WHERE line <> ''
          UNION ALL SELECT 'livsmedelsverket', line::jsonb FROM v_raw_extract_livsmedelsverket WHERE line <> ''
          UNION ALL SELECT 'fsvo', line::jsonb FROM v_raw_extract_fsvo WHERE line <> ''
          UNION ALL SELECT 'cnf', line::jsonb FROM v_raw_extract_cnf WHERE line <> ''
      ) AS lines;

CREATE TEMP TABLE v_branded_product AS
    SELECT 'fdc:' || (doc ->> 'fdcId') AS item_key, doc
      FROM (SELECT line::jsonb AS doc FROM v_raw_branded WHERE line <> '') AS lines;

-- ── Each sourceless root's citation (R50). A source-item citation's dataset is the one its candidate names: the
--    committed citation is the policy's choice, so exactly one candidate has its source, key and match (KTD-22) ───
CREATE TEMP TABLE v_root_citation AS
    SELECT root.seed_key, root.nutrition, 'label'::text AS dataset, 1::bigint AS candidates
      FROM v_expected_root root
     WHERE root.nutrition ->> 'source' = 'manufacturerLabel'
    UNION ALL
    SELECT root.seed_key, root.nutrition, min(candidate.dataset), count(candidate.dataset)
      FROM v_expected_root root
      LEFT JOIN v_seed_candidate candidate
             ON candidate.seed_key = root.seed_key
            AND candidate.key = root.nutrition ->> 'key'
            AND candidate.match = root.nutrition ->> 'match'
            AND EXISTS (
                SELECT 1 FROM v_citation_dataset named
                 WHERE named.dataset = candidate.dataset AND named.source = root.nutrition ->> 'source'
            )
     WHERE root.nutrition IS NOT NULL AND root.nutrition ->> 'source' <> 'manufacturerLabel'
     GROUP BY root.seed_key, root.nutrition;

-- ── Headers and their one citation (KTD-19). An owner of its own USDA item cites it, `exact` (`OWN_ITEM_MATCH`) ─────
CREATE TEMP TABLE v_expected_nutrition AS
    SELECT 'root'::text AS owner_kind, seed_key AS owner_key, 'item'::text AS numbers, item_key AS values_key,
           'usdaSrFoundation'::text AS dataset, substr(item_key, 5) AS external_key, 'exact'::text AS match,
           NULL::numeric AS density_g_per_ml, false AS kcal_from_kj, NULL::text AS url, NULL::date AS retrieved_on,
           NULL::text AS manufacturer, NULL::text AS serving_label, NULL::numeric AS serving_grams
      FROM v_expected_root
     WHERE item_key LIKE 'fdc:%'
    UNION ALL
    SELECT 'variant', item_key, 'item', item_key, 'usdaSrFoundation', substr(item_key, 5), 'exact', NULL, false, NULL,
           NULL, NULL, NULL, NULL
      FROM v_expected_variant
    UNION ALL
    -- A same-substance SR Legacy or Foundation stand-in: the cited item's own rows.
    SELECT 'root', seed_key, 'usdaStandIn', nutrition ->> 'key', dataset, substr(nutrition ->> 'key', 5),
           nutrition ->> 'match', NULL, false, NULL, NULL, NULL, NULL, NULL
      FROM v_root_citation
     WHERE dataset = 'usdaSrFoundation' AND candidates = 1
    UNION ALL
    -- A Branded product: its FDC id, bare, as the live adapter writes one.
    SELECT 'root', seed_key, 'usdaBranded', nutrition ->> 'key', dataset, substr(nutrition ->> 'key', 5),
           nutrition ->> 'match', NULL, false, NULL, NULL, NULL, NULL, NULL
      FROM v_root_citation
     WHERE dataset = 'usdaBranded' AND candidates = 1
    UNION ALL
    -- A table line: its density when it is per 100 mL (R54), and whether its energy came from kJ.
    SELECT 'root', citation.seed_key, 'extract', citation.nutrition ->> 'key', citation.dataset,
           CASE WHEN line.key ~ '^fdc:[1-9][0-9]*$' THEN substr(line.key, 5) ELSE line.key END,
           citation.nutrition ->> 'match',
           CASE WHEN line.doc ->> 'basis' = 'per100mL' THEN (line.doc ->> 'densityGramsPerMl')::numeric END,
           line.doc -> 'values' ? 'ENERC_KJ' AND NOT (line.doc -> 'values' ? 'ENERC_KCAL'), NULL, NULL, NULL, NULL,
           NULL
      FROM v_root_citation citation
      JOIN v_extract_line line ON line.dataset = citation.dataset AND line.key = citation.nutrition ->> 'key'
     WHERE citation.dataset NOT IN ('usdaSrFoundation', 'usdaBranded', 'label') AND citation.candidates = 1
    UNION ALL
    -- A manufacturer's label: its five citation fields, as committed.
    SELECT 'root', seed_key, 'label', NULL, 'label', NULL, NULL, NULL, false, nutrition ->> 'url',
           (nutrition ->> 'retrievedOn')::date, nutrition ->> 'manufacturer', nutrition -> 'serving' ->> 'label',
           (nutrition -> 'serving' ->> 'grams')::numeric
      FROM v_root_citation
     WHERE dataset = 'label';

-- The identity a value or a portion cites its header's citation by: its dataset and its key, or a label's URL.
ALTER TABLE v_expected_nutrition ADD COLUMN cited_key text;

UPDATE v_expected_nutrition SET cited_key = coalesce(external_key, url);

-- ── Values (R53, KTD-20, KTD-24, OQ-2) ───────────────────────────────────────────────────────────────────────
-- A table line's values per 100 g: divided by its density when per 100 mL, then, with no kcal, kcal from the ROUNDED
-- per-100 g kJ at 4.184 kJ per kcal. A trace is a value with no amount.
CREATE TEMP TABLE v_extract_per100g AS
    SELECT nutrition.owner_kind, nutrition.owner_key, stated.key AS tag,
           CASE
               WHEN nutrition.density_g_per_ml IS NULL THEN (stated.value #>> '{}')::numeric
               ELSE pg_temp.v_divide((stated.value #>> '{}')::numeric, nutrition.density_g_per_ml)
           END AS amount
      FROM v_expected_nutrition nutrition
      JOIN v_extract_line line ON line.dataset = nutrition.dataset AND line.key = nutrition.values_key
     CROSS JOIN LATERAL jsonb_each(line.doc -> 'values') AS stated
     WHERE nutrition.numbers = 'extract';

CREATE TEMP TABLE v_expected_value AS
    -- An owner of its own USDA item, or a stand-in: the item's rows as the bulk parser maps them.
    SELECT nutrition.owner_kind, nutrition.owner_key, row.name, row.unit, row.amount::numeric AS amount
      FROM v_expected_nutrition nutrition
      JOIN v_usda_item_nutrient row ON row.item_key = nutrition.values_key
     WHERE nutrition.numbers IN ('item', 'usdaStandIn')
    UNION ALL
    -- A Branded product's rows, which FDC writes per 100 g for a gram serving: named as the bulk parser names them, a
    -- zero dropped (OQ-2), a row with no name or unit dropped, and the first row of each name and unit kept.
    SELECT owner_kind, owner_key, name, unit, amount::numeric
      FROM (
          SELECT DISTINCT ON (nutrition.owner_kind, nutrition.owner_key, mapped.name, mapped.unit)
                 nutrition.owner_kind, nutrition.owner_key, mapped.name, mapped.unit, mapped.amount
            FROM v_expected_nutrition nutrition
            JOIN v_branded_product product ON product.item_key = nutrition.values_key
           CROSS JOIN LATERAL jsonb_array_elements(product.doc -> 'nutrients') WITH ORDINALITY AS row(value, position)
           CROSS JOIN LATERAL (
               SELECT pg_temp.v_canonical_nutrient_name(row.value ->> 'name') AS name,
                      pg_temp.v_canonical_bulk_unit(row.value ->> 'unitName') AS unit,
                      row.value ->> 'amount' AS amount,
                      row.position
           ) AS mapped
           WHERE nutrition.numbers = 'usdaBranded'
             AND mapped.name <> '' AND mapped.unit <> ''
             AND mapped.amount ~ '^[0-9]+(\.[0-9]+)?$' AND mapped.amount::numeric <> 0
           ORDER BY nutrition.owner_kind, nutrition.owner_key, mapped.name, mapped.unit, mapped.position
      ) AS kept
    UNION ALL
    -- A table line's stated values, per 100 g.
    SELECT per100g.owner_kind, per100g.owner_key, tag.name, tag.unit, per100g.amount
      FROM v_extract_per100g per100g
      JOIN v_nutrient_tag tag ON tag.tag = per100g.tag
    UNION ALL
    -- Its kcal, from its kJ, when it states no kcal (R54).
    SELECT kilojoules.owner_kind, kilojoules.owner_key, tag.name, tag.unit, pg_temp.v_divide(kilojoules.amount, 4.184)
      FROM v_extract_per100g kilojoules
      JOIN v_nutrient_tag tag ON tag.tag = 'ENERC_KCAL'
     WHERE kilojoules.tag = 'ENERC_KJ'
       AND NOT EXISTS (
           SELECT 1 FROM v_extract_per100g kilocalories
            WHERE kilocalories.owner_kind = kilojoules.owner_kind
              AND kilocalories.owner_key = kilojoules.owner_key
              AND kilocalories.tag = 'ENERC_KCAL'
       )
    UNION ALL
    -- Its traces: a value with no amount (R53).
    SELECT nutrition.owner_kind, nutrition.owner_key, tag.name, tag.unit, NULL::numeric
      FROM v_expected_nutrition nutrition
      JOIN v_extract_line line ON line.dataset = nutrition.dataset AND line.key = nutrition.values_key
     CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(line.doc -> 'traces', '[]'::jsonb)) AS traced(tag)
      JOIN v_nutrient_tag tag ON tag.tag = traced.tag
     WHERE nutrition.numbers = 'extract'
    UNION ALL
    -- A label's printed values per 100 g, `round(printed × 100 ÷ serving grams, 3)`, a printed zero dropped (KTD-20).
    SELECT nutrition.owner_kind, nutrition.owner_key, printed.value ->> 'name', printed.value ->> 'unit',
           pg_temp.v_divide((printed.value ->> 'amount')::numeric * 100, nutrition.serving_grams)
      FROM v_expected_nutrition nutrition
      JOIN v_expected_root root ON root.seed_key = nutrition.owner_key
     CROSS JOIN LATERAL jsonb_array_elements(root.nutrition -> 'perServing') AS printed(value)
     WHERE nutrition.numbers = 'label' AND nutrition.owner_kind = 'root'
       AND (printed.value ->> 'amount')::numeric <> 0;

-- ── The serving a citation states, as a portion of the citing root's item (OQ-1): a label's serving, and a gram-served
--    Branded product's household serving, trimmed, when it is not blank ─────────────────────────────────────────
CREATE TEMP TABLE v_expected_cited_portion AS
    SELECT root.item_key, nutrition.serving_label AS label, nutrition.serving_grams AS gram_weight, nutrition.owner_kind,
           nutrition.owner_key, nutrition.dataset, nutrition.cited_key
      FROM v_expected_nutrition nutrition
      JOIN v_expected_root root ON root.seed_key = nutrition.owner_key
     WHERE nutrition.numbers = 'label' AND nutrition.owner_kind = 'root'
    UNION ALL
    SELECT root.item_key, pg_temp.v_js_trim(product.doc ->> 'household_serving_fulltext'),
           (product.doc ->> 'serving_size')::numeric, nutrition.owner_kind, nutrition.owner_key, nutrition.dataset,
           nutrition.cited_key
      FROM v_expected_nutrition nutrition
      JOIN v_expected_root root ON root.seed_key = nutrition.owner_key
      JOIN v_branded_product product ON product.item_key = nutrition.values_key
     WHERE nutrition.numbers = 'usdaBranded' AND nutrition.owner_kind = 'root'
       AND pg_temp.v_js_trim(product.doc ->> 'household_serving_fulltext') <> '';

ANALYZE v_expected_nutrition;
ANALYZE v_expected_value;

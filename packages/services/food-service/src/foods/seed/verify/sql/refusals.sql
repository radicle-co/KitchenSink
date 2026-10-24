-- The committed inputs the expected catalog cannot be derived from (curated catalog plan U6, KTD-3).
--
-- The seeder's format check refuses each of these before any apply, so on a seed that applied this answers nothing.
-- It exists so the derivation never drops an input silently: each case below is one where the SQL would otherwise
-- lose a row (an item with no group, a member never read) and then compare a smaller catalog than the seed implies.
-- One SELECT answering `(table_name, fact, row_count, sample)` per refusal.

WITH refusal (table_name, fact, subject) AS (
    SELECT 'usda archives', 'an item''s fdc_id is not an FDC id', archive || ':' || fdc_id
      FROM v_usda_item
     WHERE fdc_id !~ '^[1-9][0-9]{0,15}$'
    UNION ALL
    SELECT 'usda archives', 'an item is in both archives', item_key
      FROM v_usda_item
     GROUP BY item_key
    HAVING count(*) > 1
    UNION ALL
    SELECT 'usda archives', 'an item''s description has no letter or digit', item_key
      FROM v_usda_item
     WHERE pg_temp.v_usda_description_key(description) = ''
    UNION ALL
    SELECT 'usda archives', 'an item''s publication date is not an ISO date', item_key || ' ' || publication_date
      FROM v_usda_item
     WHERE publication_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT pg_input_is_valid(publication_date, 'date')
    UNION ALL
    SELECT 'foundation_food.csv', 'a listed item has no foundation_food row in food.csv', member.fdc_id
      FROM v_usda_foundation_member member
     WHERE NOT EXISTS (SELECT 1 FROM v_usda_item item WHERE item.archive = 'fd' AND item.fdc_id = member.fdc_id)
    UNION ALL
    SELECT 'foundation_food.csv', 'an NDB number is not a canonical number', fdc_id || ' ' || ndb_number
      FROM v_usda_foundation_member
     WHERE ndb_number !~ '^[1-9][0-9]*$'
    UNION ALL
    SELECT 'curatedCatalog.jsonl', 'an owned item is not the supplier of an R48 group', placed.item_key
      FROM (
          SELECT item_key FROM v_seed_root WHERE item_key IS NOT NULL
          UNION ALL
          SELECT item_key FROM v_seed_variant
      ) AS placed
     WHERE NOT EXISTS (
         SELECT 1 FROM v_baseline_member member
          WHERE member.item_key = placed.item_key AND member.supply_rank = 1
     )
    UNION ALL
    SELECT 'catalogChanges.json', 'an alias is not the supplier of an R48 group', alias_key
      FROM v_seed_alias alias
     WHERE NOT EXISTS (
         SELECT 1 FROM v_baseline_member member WHERE member.item_key = alias.alias_key AND member.supply_rank = 1
     )
    UNION ALL
    SELECT 'catalogChanges.json', 'an alias names an item no root or variant owns', alias_key || ' of ' || of_key
      FROM v_seed_alias alias
     WHERE NOT EXISTS (SELECT 1 FROM v_expected_item item WHERE item.item_key = alias.of_key)
    UNION ALL
    SELECT 'sourceCandidates.tsv', 'a root''s citation is not exactly one candidate''s source, key and match',
           seed_key || ' ' || (nutrition ->> 'key') || ' (' || candidates::text || ' candidates)'
      FROM v_root_citation
     WHERE candidates <> 1
    UNION ALL
    SELECT 'curatedCatalog.jsonl', 'a stand-in is not the supplier of an R48 group', citation.seed_key
      FROM v_root_citation citation
     WHERE citation.dataset = 'usdaSrFoundation'
       AND NOT EXISTS (
           SELECT 1 FROM v_baseline_member member
            WHERE member.item_key = citation.nutrition ->> 'key' AND member.supply_rank = 1
       )
    UNION ALL
    SELECT 'usda/brandedExtract', 'a cited product is not in the extract', citation.seed_key
      FROM v_root_citation citation
     WHERE citation.dataset = 'usdaBranded'
       AND NOT EXISTS (SELECT 1 FROM v_branded_product product WHERE product.item_key = citation.nutrition ->> 'key')
    UNION ALL
    SELECT 'usda/brandedExtract', 'a cited product is not served in grams, so its amounts are not per 100 g',
           citation.seed_key || ' ' || (product.doc ->> 'serving_size_unit')
      FROM v_root_citation citation
      JOIN v_branded_product product ON product.item_key = citation.nutrition ->> 'key'
     WHERE citation.dataset = 'usdaBranded' AND lower(product.doc ->> 'serving_size_unit') NOT IN ('g', 'grm', 'gm')
    UNION ALL
    SELECT 'usda/brandedExtract', 'a cited product''s amount is not a plain decimal',
           citation.seed_key || ' ' || (row.value ->> 'nutrientId')
      FROM v_root_citation citation
      JOIN v_branded_product product ON product.item_key = citation.nutrition ->> 'key'
     CROSS JOIN LATERAL jsonb_array_elements(product.doc -> 'nutrients') AS row(value)
     WHERE citation.dataset = 'usdaBranded' AND (row.value ->> 'amount') !~ '^[0-9]+(\.[0-9]+)?$'
    UNION ALL
    SELECT citation.dataset || ' extract', 'a cited line is not in its dataset''s extract', citation.seed_key
      FROM v_root_citation citation
     WHERE citation.dataset NOT IN ('usdaSrFoundation', 'usdaBranded', 'label') AND citation.candidates = 1
       AND NOT EXISTS (
           SELECT 1 FROM v_extract_line line
            WHERE line.dataset = citation.dataset AND line.key = citation.nutrition ->> 'key'
       )
)
SELECT table_name, fact, count(*) AS row_count, (array_agg(subject ORDER BY subject))[1:5] AS sample
  FROM refusal
 GROUP BY table_name, fact
 ORDER BY table_name, fact

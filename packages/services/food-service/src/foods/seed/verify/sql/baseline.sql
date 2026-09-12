-- The USDA baseline: R51's exclusions dropped, the rest grouped by R48's description key, and each group's supplier
-- elected (curated catalog plan U1, R48, R51). Restates `buildBaselineSeed` and `supplyOrder` in `baselineSeed.ts`.
--
-- The election ranks an item with energy first, then a current Foundation item, then the latest publication date (an
-- ISO date, so text order in the C collation is date order), then the highest FDC id. Rank 1 supplies the numbers.

CREATE TEMP TABLE v_baseline_member AS
    SELECT ranked.*,
           first_value(ranked.item_key) OVER (PARTITION BY ranked.description_key ORDER BY ranked.supply_rank)
               AS supplier_key
      FROM (
          SELECT keyed.*,
                 row_number() OVER (
                     PARTITION BY keyed.description_key
                     ORDER BY keyed.has_energy DESC, keyed.is_foundation DESC, keyed.publication_date COLLATE "C" DESC,
                              keyed.fdc_id::bigint DESC
                 ) AS supply_rank
            FROM (
                SELECT item.*, pg_temp.v_usda_description_key(item.description) AS description_key
                  FROM v_usda_item item
                 WHERE item.fdc_id ~ '^[1-9][0-9]{0,15}$'
                   AND NOT EXISTS (SELECT 1 FROM v_seed_exclusion excluded WHERE excluded.item_key = item.item_key)
            ) AS keyed
      ) AS ranked;

-- One baseline root per group: its name is the supplier's description, trimmed.
CREATE TEMP TABLE v_baseline_group AS
    SELECT description_key, item_key AS supplier_key, pg_temp.v_js_trim(description) AS name
      FROM v_baseline_member
     WHERE supply_rank = 1;

ANALYZE v_baseline_member;
ANALYZE v_baseline_group;

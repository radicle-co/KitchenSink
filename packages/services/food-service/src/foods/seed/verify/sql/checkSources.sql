-- food_sources: the source rows of the live seed owners' items equal the ones the committed seed implies, in both
-- directions (curated catalog plan U6, KTD-3, R48, KTD-27). A row is compared by its item's natural key, its source
-- and external key (the bare FDC id, as the live adapter writes it), its lineage key (`foundation:<NDB>` on a current
-- Foundation item, none on SR Legacy), and the two columns the seeder's write contract fixes for every seeded row
-- (`SEEDED_SOURCE_COLUMNS` in `catalog/catalogWriteSet.ts`): fetched, with no live version to compare against.
WITH expected AS (
    SELECT item_key, 'usda'::text AS source, fdc_id AS external_key, lineage_key, 'fetched'::text AS fetch_state,
           NULL::text AS item_version
      FROM pg_temp.v_expected_source
),
actual AS (
    SELECT owner.item_key, row.source::text, row.external_key, row.lineage_key, row.fetch_state, row.item_version
      FROM pg_temp.v_live_owner owner
      JOIN public.food_sources row ON row.item_id = owner.item_id
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food_sources' AS table_name, 'a source row the seed holds is absent or differs' AS fact,
       count(*) AS row_count, (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food_sources', 'a live seed item''s source row is not in the seed or differs from it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

-- food_category_assignment: the food groups of the live seed owners' items equal the ones the committed seed implies,
-- in both directions (curated catalog plan U6, KTD-3; owner, 2026-10-01). An assignment is compared by its item's
-- natural key, its group's dictionary name, and the source row that states it, by that row's source and key.
WITH expected AS (
    SELECT item_key, name, 'usda'::text AS source, fdc_id AS external_key FROM pg_temp.v_expected_category
),
actual AS (
    SELECT owner.item_key, category.name, row.source::text, row.external_key
      FROM pg_temp.v_live_owner owner
      JOIN public.food_category_assignment assignment ON assignment.item_id = owner.item_id
      LEFT JOIN public.food_category category ON category.id = assignment.category_id
      LEFT JOIN public.food_sources row ON row.id = assignment.source_id
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food_category_assignment' AS table_name, 'a food group the seed holds is absent or differs' AS fact,
       count(*) AS row_count, (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food_category_assignment', 'a live seed item''s food group is not in the seed or differs from it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

-- food_nutrition: the live seed owners' nutrition headers equal the ones the committed seed implies, in both directions
-- (curated catalog plan U6, KTD-3, KTD-19, R39). A header is compared by its owner: every variant has exactly one, a
-- root with numbers has exactly one, and a root whose seed states none has none (`nutrition: null`, GR-019).
WITH expected AS (
    SELECT owner_kind, owner_key FROM pg_temp.v_expected_nutrition
),
actual AS (
    SELECT owner_kind, owner_key FROM pg_temp.v_live_header
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food_nutrition' AS table_name, 'an owner the seed gives numbers has no header' AS fact, count(*) AS row_count,
       (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food_nutrition', 'a live seed owner has a header the seed does not give it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

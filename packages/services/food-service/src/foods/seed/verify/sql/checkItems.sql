-- food_item: the items of the live seed owners equal the items the committed seed implies, in both directions
-- (curated catalog plan U6, KTD-3, KTD-6). An item is compared by its natural key and its owner's kind, reached
-- through its live owner.
WITH expected AS (
    SELECT item_key, owner_kind FROM pg_temp.v_expected_item
),
actual AS (
    SELECT item.natural_key, item.owner_kind::text
      FROM pg_temp.v_live_owner owner
      LEFT JOIN public.food_item item ON item.id = owner.item_id
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food_item' AS table_name, 'an item the seed holds is absent or differs' AS fact, count(*) AS row_count,
       (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food_item', 'a live seed owner''s item is not in the seed or differs from it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

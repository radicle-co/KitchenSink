-- food_variant: the live variants equal the variants the committed seed implies, in both directions (curated catalog
-- plan U6, KTD-3, KTD-6). A variant is compared by its item's natural key and its root's seed key, never by id;
-- `retired_at` by selection (a retired variant the seed holds reads as absent).
WITH expected AS (
    SELECT item_key, root_key, 'variant'::text AS item_owner_kind FROM pg_temp.v_expected_variant
),
actual AS (
    SELECT item.natural_key, root.seed_key, variant.item_owner_kind::text
      FROM public.food_variant variant
      LEFT JOIN public.food_item item ON item.id = variant.item_id
      LEFT JOIN public.food root ON root.id = variant.food_id
     WHERE variant.retired_at IS NULL
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food_variant' AS table_name, 'a variant the seed holds is absent, retired or differs' AS fact,
       count(*) AS row_count, (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food_variant', 'a live variant is not in the seed or differs from it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

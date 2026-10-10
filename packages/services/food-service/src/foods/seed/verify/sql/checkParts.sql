-- food_variant_part: the parts of the live variants equal the parts the committed seed implies, in both directions
-- (curated catalog plan U6, KTD-3, KTD-7). A part is compared by its variant's item key, its attribute, its text, and
-- its place among its attribute's parts. The ordinal is compared by the order it gives, because that order is all it
-- means (the label reads attribute order, then ordinal order); the numbers themselves are the applier's to choose.
WITH expected AS (
    SELECT item_key, attribute, text, attribute_place FROM pg_temp.v_expected_part
),
actual AS (
    SELECT item.natural_key, part.attribute::text, part.text,
           row_number() OVER (PARTITION BY part.variant_id, part.attribute ORDER BY part.ordinal)
      FROM public.food_variant variant
      JOIN public.food_variant_part part ON part.variant_id = variant.id
      LEFT JOIN public.food_item item ON item.id = variant.item_id
     WHERE variant.retired_at IS NULL
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food_variant_part' AS table_name, 'a part the seed holds is absent, out of place or differs' AS fact,
       count(*) AS row_count, (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food_variant_part', 'a live variant''s part is not in the seed or differs from it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

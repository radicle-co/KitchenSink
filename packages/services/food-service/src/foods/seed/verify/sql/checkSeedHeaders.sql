-- The nutrition under every seed owner, retired ones included: no value is uncited, and no header is empty (curated
-- catalog plan U6, KTD-19, R50). One-way: the committed bytes describe only live rows, so a retired owner's header is
-- not compared, but an uncited value means "authored" (ADR-0029) and no seed owner has an author. The headers are
-- selected by their owner (any variant, or a root with a seed key), never by the seeder's ownership column.
WITH seed_header AS (
    SELECT header.id
      FROM public.food_nutrition header
      JOIN public.food root ON root.id = header.food_id
     WHERE root.seed_key IS NOT NULL
    UNION ALL
    SELECT header.id
      FROM public.food_nutrition header
      JOIN public.food_variant variant ON variant.id = header.food_variant_id
),
uncited AS (
    SELECT value.nutrition_id
      FROM seed_header
      JOIN public.food_nutrition_value value ON value.nutrition_id = seed_header.id
     WHERE value.citation_id IS NULL
),
empty AS (
    SELECT seed_header.id
      FROM seed_header
     WHERE NOT EXISTS (SELECT 1 FROM public.food_nutrition_value value WHERE value.nutrition_id = seed_header.id)
)
SELECT 'food_nutrition_value' AS table_name, 'a value under a seed owner''s header cites nothing' AS fact,
       count(*) AS row_count, (array_agg(nutrition_id ORDER BY nutrition_id))[1:3] AS sample
  FROM uncited
HAVING count(*) > 0
UNION ALL
SELECT 'food_nutrition', 'a seed owner''s header holds no value', count(*), (array_agg(id ORDER BY id))[1:3]
  FROM empty
HAVING count(*) > 0

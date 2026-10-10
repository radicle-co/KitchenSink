-- food_nutrition_value: each live seed header's values equal the ones the committed seed implies, in both directions
-- (curated catalog plan U6, KTD-3, R39, R53, R54, KTD-20, KTD-23, OQ-2). A value is compared by its owner, its
-- dictionary entry's name and unit, its amount (a trace has none), its basis, and the citation it cites, by that
-- citation's dataset and key. An uncited value therefore never matches.
WITH expected AS (
    SELECT value.owner_kind, value.owner_key, value.name, value.unit, value.amount, value.amount IS NULL AS trace,
           'per_100g'::text AS basis, nutrition.dataset, nutrition.cited_key
      FROM pg_temp.v_expected_value value
      JOIN pg_temp.v_expected_nutrition nutrition
        ON nutrition.owner_kind = value.owner_kind AND nutrition.owner_key = value.owner_key
),
actual AS (
    SELECT header.owner_kind, header.owner_key, entry.name, entry.unit, value.amount, value.trace,
           value.basis::text, citation.dataset::text, coalesce(citation.external_key, citation.url)
      FROM pg_temp.v_live_header header
      JOIN public.food_nutrition_value value ON value.nutrition_id = header.header_id
      LEFT JOIN public.nutrient entry ON entry.id = value.nutrient_id
      LEFT JOIN public.food_nutrition_citation citation
             ON citation.nutrition_id = value.nutrition_id AND citation.id = value.citation_id
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food_nutrition_value' AS table_name, 'a value the seed holds is absent or differs' AS fact,
       count(*) AS row_count, (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food_nutrition_value', 'a live seed header''s value is not in the seed or differs from it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

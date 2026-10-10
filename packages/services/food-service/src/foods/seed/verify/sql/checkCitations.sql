-- food_nutrition_citation: each live seed header's citation equals the one the committed seed implies, in both
-- directions (curated catalog plan U6, KTD-3, KTD-19, KTD-20, KTD-22, R50, R54). An owner of its own USDA item cites it
-- `exact`; a stand-in, a Branded product and a table line cite their dataset, key and match, with R54's density and kJ
-- conversion recorded; a label cites its five fields as committed.
WITH expected AS (
    SELECT owner_kind, owner_key, dataset, external_key, match, density_g_per_ml, kcal_from_kj, url, retrieved_on,
           manufacturer, serving_label, serving_grams
      FROM pg_temp.v_expected_nutrition
),
actual AS (
    SELECT header.owner_kind, header.owner_key, citation.dataset::text, citation.external_key, citation.match::text,
           citation.density_g_per_ml, citation.kcal_from_kj, citation.url, citation.retrieved_on, citation.manufacturer,
           citation.serving_label, citation.serving_grams
      FROM pg_temp.v_live_header header
      JOIN public.food_nutrition_citation citation ON citation.nutrition_id = header.header_id
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food_nutrition_citation' AS table_name, 'a citation the seed holds is absent or differs' AS fact,
       count(*) AS row_count, (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food_nutrition_citation', 'a live seed header''s citation is not in the seed or differs from it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

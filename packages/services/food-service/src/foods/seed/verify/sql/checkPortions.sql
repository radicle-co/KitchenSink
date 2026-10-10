-- food_portions: the portions of the live seed owners' items equal the ones the committed seed implies, in both
-- directions, duplicates counted (curated catalog plan U6, KTD-3, R9, KTD-28, OQ-1). A portion is compared by its item,
-- its label, its grams, and its provenance: the source row it came from, by source and key, or the citation it states,
-- by that citation's owner, dataset and key. A cited portion must cite its own owner's citation.
WITH expected AS (
    SELECT item_key, label, gram_weight, 'usda'::text AS source, fdc_id AS external_key, NULL::text AS citing_kind,
           NULL::text AS citing_key, NULL::text AS dataset, NULL::text AS cited_key
      FROM pg_temp.v_expected_source_portion
    UNION ALL
    SELECT item_key, label, gram_weight, NULL, NULL, owner_kind, owner_key, dataset, cited_key
      FROM pg_temp.v_expected_cited_portion
),
actual AS (
    SELECT owner.item_key, portion.label, portion.gram_weight, row.source::text, row.external_key, cited.owner_kind,
           cited.owner_key, cited.dataset, cited.cited_key
      FROM pg_temp.v_live_owner owner
      JOIN public.food_portions portion ON portion.item_id = owner.item_id
      LEFT JOIN public.food_sources row ON row.id = portion.source_id
      LEFT JOIN pg_temp.v_citation_owner cited ON cited.citation_id = portion.citation_id
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food_portions' AS table_name, 'a portion the seed holds is absent or differs' AS fact, count(*) AS row_count,
       (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food_portions', 'a live seed item''s portion is not in the seed or differs from it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

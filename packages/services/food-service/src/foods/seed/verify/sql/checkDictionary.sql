-- nutrient: every dictionary entry the seed's values name, and that a stored definition maps, carries that definition's
-- INFOODS tag (curated catalog plan U6, KTD-14, KTD-23). Nutrition is read by tag (`nutrientSelection.ts`), so an entry
-- that lacks its tag reads every value under it as absent while each value still compares equal. The dictionary is
-- shared (KTD-14) and the seeder only inserts into it, so this checks only the entries the seed names; the tag map is
-- `pg_temp.v_nutrient_tag`, restated from `NUTRIENT_DEFINITIONS` under a parity test.
WITH named AS (
    SELECT DISTINCT tag.tag, tag.name, tag.unit
      FROM pg_temp.v_expected_value value
      JOIN pg_temp.v_nutrient_tag tag ON tag.name = value.name AND tag.unit = value.unit
),
failure AS (
    SELECT named.name || ' (' || named.unit || ') wants ' || named.tag || ', holds '
               || coalesce(entry.infoods_tag, 'none') AS subject
      FROM named
      LEFT JOIN public.nutrient entry ON entry.name = named.name AND entry.unit = named.unit
     WHERE entry.infoods_tag IS DISTINCT FROM named.tag
)
SELECT 'nutrient' AS table_name, 'a dictionary entry the seed names lacks its definition''s INFOODS tag' AS fact,
       count(*) AS row_count, (array_agg(subject ORDER BY subject))[1:3] AS sample
  FROM failure
HAVING count(*) > 0

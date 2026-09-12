-- food_field_provenance: the live seed owners' items hold no field provenance (curated catalog plan U6, KTD-3, R5).
-- The seeder's write contract (`catalog/catalogWriteSet.ts`) writes none: every scalar a seeded root carries is the
-- curator's or a constant, never a source row's, so no row could say which source supplied it. The expected set is
-- empty, so every row found is extra.
WITH actual AS (
    SELECT owner.item_key, provenance.field::text, row.source::text, row.external_key
      FROM pg_temp.v_live_owner owner
      JOIN public.food_field_provenance provenance ON provenance.item_id = owner.item_id
      LEFT JOIN public.food_sources row ON row.id = provenance.source_id
)
SELECT 'food_field_provenance' AS table_name, 'a live seed item holds field provenance the seed never writes' AS fact,
       count(*) AS row_count, (array_agg(to_jsonb(actual)::text ORDER BY to_jsonb(actual)::text))[1:3] AS sample
  FROM actual
HAVING count(*) > 0

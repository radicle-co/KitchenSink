-- History, one way (curated catalog plan U6, KTD-3, KTD-8): the committed bytes describe only what is live, so a retired
-- row is never compared, only held to what retiring means.
--
-- - A retired root's seed key, and a retired variant's item key, is absent from the current seed: a key the seed holds
--   again is restored, never left retired beside it.
-- - Every item with a natural key has an owner, retired owners included: an apply deletes any item it leaves with none,
--   and a retired row keeps its item, so an ownerless one is an item a retired row no longer owns.
-- - A retired seed row's item still has its natural key.
WITH failure (table_name, fact, subject) AS (
    SELECT 'food', 'a retired root''s seed key is a root the seed holds', root.seed_key
      FROM public.food root
     WHERE root.seed_key IS NOT NULL AND root.retired_at IS NOT NULL
       AND root.seed_key IN (SELECT seed_key FROM pg_temp.v_expected_root)
    UNION ALL
    SELECT 'food_variant', 'a retired variant''s item is a variant the seed holds', item.natural_key
      FROM public.food_variant variant
      JOIN public.food_item item ON item.id = variant.item_id
     WHERE variant.retired_at IS NOT NULL AND item.natural_key IN (SELECT item_key FROM pg_temp.v_expected_variant)
    UNION ALL
    SELECT 'food_item', 'an item with a natural key has no owner', item.natural_key
      FROM public.food_item item
     WHERE item.natural_key IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.food root WHERE root.item_id = item.id)
       AND NOT EXISTS (SELECT 1 FROM public.food_variant variant WHERE variant.item_id = item.id)
    UNION ALL
    SELECT 'food_item', 'a retired seed row''s item has no natural key', owner.id
      FROM (
          SELECT root.id, root.item_id FROM public.food root
           WHERE root.seed_key IS NOT NULL AND root.retired_at IS NOT NULL
          UNION ALL
          SELECT variant.id, variant.item_id FROM public.food_variant variant WHERE variant.retired_at IS NOT NULL
      ) AS owner
      JOIN public.food_item item ON item.id = owner.item_id
     WHERE item.natural_key IS NULL
)
SELECT table_name, fact, count(*) AS row_count, (array_agg(subject ORDER BY subject))[1:3] AS sample
  FROM failure
 GROUP BY table_name, fact

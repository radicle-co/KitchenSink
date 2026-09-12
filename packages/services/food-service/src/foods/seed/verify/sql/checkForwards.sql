-- food_forward, one way (curated catalog plan U6, KTD-3, KTD-8, KTD-12): every forward, whoever wrote it, the seed or
-- the live path, ends where the reader ends it, within eight forwards (`MAX_FORWARD_HOPS`, the reader's bound).
--
-- A forward is followed through its target. A chain ends at a live catalog root or a live variant, or at a root or
-- variant the seed retired with no forward of its own, which answers as itself (ADR-0050 §4). Any other target, retired
-- or gone, continues through the forward whose source it is. A forward is also held to its source: the table its kind
-- names is the one its source is in, a live row is never forwarded, and a key the seed holds live is never a forward's
-- source key (the seed restores that row and drops its forward). `catalogForwardEndParity.e2e.test.ts` holds this end
-- rule and the bound to the reader's.
WITH RECURSIVE chain_end (id, kind) AS (
    SELECT root.id, 'root'::text
      FROM public.food root
     WHERE root.user_id IS NULL
       AND (root.retired_at IS NULL OR NOT EXISTS (SELECT 1 FROM public.food_forward own WHERE own.source_id = root.id))
    UNION ALL
    SELECT variant.id, 'variant'
      FROM public.food_variant variant
     WHERE variant.retired_at IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.food_forward own WHERE own.source_id = variant.id)
),
chain (start_id, at_id, at_kind, hops) AS (
    SELECT forward.source_id, coalesce(forward.target_food_id, forward.target_variant_id),
           CASE WHEN forward.target_food_id IS NOT NULL THEN 'root' ELSE 'variant' END, 1
      FROM public.food_forward forward
    UNION ALL
    SELECT chain.start_id, coalesce(next.target_food_id, next.target_variant_id),
           CASE WHEN next.target_food_id IS NOT NULL THEN 'root' ELSE 'variant' END, chain.hops + 1
      FROM chain
      JOIN public.food_forward next ON next.source_id = chain.at_id
     WHERE chain.hops <= 8
       AND NOT EXISTS (SELECT 1 FROM chain_end WHERE chain_end.id = chain.at_id AND chain_end.kind = chain.at_kind)
),
failure (table_name, fact, subject) AS (
    SELECT 'food_forward', 'a forward does not end at a catalog root or variant within 8 forwards', forward.source_id
      FROM public.food_forward forward
     WHERE NOT EXISTS (
         SELECT 1
           FROM chain
           JOIN chain_end ON chain_end.id = chain.at_id AND chain_end.kind = chain.at_kind
          WHERE chain.start_id = forward.source_id AND chain.hops <= 8
     )
    UNION ALL
    SELECT 'food_forward', 'a forward''s kind does not name the table its source is in', forward.source_id
      FROM public.food_forward forward
     WHERE (forward.source_kind = 'root' AND EXISTS (SELECT 1 FROM public.food_variant v WHERE v.id = forward.source_id))
        OR (forward.source_kind = 'variant' AND EXISTS (SELECT 1 FROM public.food r WHERE r.id = forward.source_id))
    UNION ALL
    SELECT 'food_forward', 'a live row is forwarded', forward.source_id
      FROM public.food_forward forward
     WHERE EXISTS (SELECT 1 FROM public.food r WHERE r.id = forward.source_id AND r.retired_at IS NULL)
        OR EXISTS (SELECT 1 FROM public.food_variant v WHERE v.id = forward.source_id AND v.retired_at IS NULL)
    UNION ALL
    SELECT 'food_forward', 'a forward''s source key is a row the seed holds live', forward.source_key
      FROM public.food_forward forward
     WHERE (forward.source_kind = 'root' AND forward.source_key IN (SELECT seed_key FROM pg_temp.v_expected_root))
        OR (forward.source_kind = 'variant' AND forward.source_key IN (SELECT item_key FROM pg_temp.v_expected_variant))
)
SELECT table_name, fact, count(*) AS row_count, (array_agg(subject ORDER BY subject))[1:3] AS sample
  FROM failure
 GROUP BY table_name, fact

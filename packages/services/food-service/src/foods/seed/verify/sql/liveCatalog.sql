-- The live seed rows the checks compare, selected through their owners' natural keys (curated catalog plan U6, KTD-3).
--
-- A live owner is a root with a seed key and no `retired_at`, or a variant with no `retired_at`. Its per-item rows and
-- its nutrition are reached through it, and keyed by its natural key: a root by its seed key, a variant by its item's
-- key. Nothing is selected by `food_item.seed_owned`, the seeder's ownership column: a row the seeder marked wrongly
-- must still be compared.
--
-- These are views: defining them reads nothing, and each check reads the catalog through them inside the seed
-- transaction. This is the one derivation file that names a catalog table, and every name is schema-qualified, because
-- the session's temp schema is searched first.

CREATE TEMP VIEW v_live_owner AS
    SELECT 'root'::text AS owner_kind, root.seed_key AS owner_key, root.id AS owner_id, root.item_id,
           item.natural_key AS item_key
      FROM public.food root
      LEFT JOIN public.food_item item ON item.id = root.item_id
     WHERE root.seed_key IS NOT NULL AND root.retired_at IS NULL
    UNION ALL
    SELECT 'variant', item.natural_key, variant.id, variant.item_id, item.natural_key
      FROM public.food_variant variant
      LEFT JOIN public.food_item item ON item.id = variant.item_id
     WHERE variant.retired_at IS NULL;

-- The nutrition header of each live owner, keyed by its owner (KTD-19). Two joins rather than one on either arm, so
-- each reaches its header through that arm's own index.
CREATE TEMP VIEW v_live_header AS
    SELECT 'root'::text AS owner_kind, root.seed_key AS owner_key, header.id AS header_id
      FROM public.food root
      JOIN public.food_nutrition header ON header.food_id = root.id
     WHERE root.seed_key IS NOT NULL AND root.retired_at IS NULL
    UNION ALL
    SELECT 'variant', item.natural_key, header.id
      FROM public.food_variant variant
      JOIN public.food_nutrition header ON header.food_variant_id = variant.id
      LEFT JOIN public.food_item item ON item.id = variant.item_id
     WHERE variant.retired_at IS NULL;

-- The owner a citation's header belongs to, for a portion that cites one: a root by its seed key, a variant by its
-- item's key. A portion must cite its OWN owner's citation, and this is how the check tells.
CREATE TEMP VIEW v_citation_owner AS
    SELECT citation.id AS citation_id, citation.dataset::text AS dataset,
           coalesce(citation.external_key, citation.url) AS cited_key,
           CASE WHEN header.food_id IS NOT NULL THEN 'root' ELSE 'variant' END AS owner_kind,
           CASE WHEN header.food_id IS NOT NULL THEN root.seed_key ELSE item.natural_key END AS owner_key
      FROM public.food_nutrition_citation citation
      JOIN public.food_nutrition header ON header.id = citation.nutrition_id
      LEFT JOIN public.food root ON root.id = header.food_id
      LEFT JOIN public.food_variant variant ON variant.id = header.food_variant_id
      LEFT JOIN public.food_item item ON item.id = variant.item_id;

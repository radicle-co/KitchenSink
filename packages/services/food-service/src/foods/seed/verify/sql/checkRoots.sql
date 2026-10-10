-- food: the live seed roots equal the roots the committed seed implies, in both directions (curated catalog plan U6,
-- KTD-3, R39). A root is compared by its seed key and every column the seed decides; its item by the item's natural
-- key, never by id.
--
-- What the seed writes that no committed byte states is restated here from the seeder's write contract
-- (`catalog/catalogWriteSet.ts`, `SEEDED_ROOT_COLUMNS` and its header), so a change to either side fails this check:
-- - `status` RESOLVED, which search reads (`foodSearch.dao.ts` surfaces only RESOLVED foods);
-- - `kind` generic, and NULL `description`, `brand_owner`, `brand_name` and `barcode`: every scalar of a seeded root is
--   the curator's or a constant, never a source row's;
-- - `visibility` public and `user_id` NULL: a seed root is a catalog row (0013's visibility CHECK, 0018's
--   `food_seed_key_not_authored`);
-- - `tombstoned_at` and `withdrawn_at` NULL: neither a lookup tombstone nor an author's withdrawal is the seed's.
-- `retired_at` is compared by selection: a live root has none, so a retired root the seed holds reads as absent.
WITH expected AS (
    SELECT seed_key, name, normalized_name, aliases, item_key, 'root'::text AS item_owner_kind,
           'RESOLVED'::text AS status, 'generic'::text AS kind, NULL::text AS description, NULL::text AS brand_owner,
           NULL::text AS brand_name, NULL::text AS barcode, 'public'::text AS visibility, NULL::text AS user_id,
           NULL::timestamptz AS tombstoned_at, NULL::timestamptz AS withdrawn_at
      FROM pg_temp.v_expected_root
),
actual AS (
    SELECT root.seed_key, root.name, root.normalized_name, root.aliases, item.natural_key,
           root.item_owner_kind::text, root.status::text, root.kind::text, root.description, root.brand_owner,
           root.brand_name, root.barcode, root.visibility, root.user_id::text, root.tombstoned_at, root.withdrawn_at
      FROM public.food root
      LEFT JOIN public.food_item item ON item.id = root.item_id
     WHERE root.seed_key IS NOT NULL AND root.retired_at IS NULL
),
missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
SELECT 'food' AS table_name, 'a root the seed holds is absent, retired or differs' AS fact, count(*) AS row_count,
       (array_agg(to_jsonb(missing)::text ORDER BY to_jsonb(missing)::text))[1:3] AS sample
  FROM missing
HAVING count(*) > 0
UNION ALL
SELECT 'food', 'a live seed root is not in the seed or differs from it', count(*),
       (array_agg(to_jsonb(extra)::text ORDER BY to_jsonb(extra)::text))[1:3]
  FROM extra
HAVING count(*) > 0

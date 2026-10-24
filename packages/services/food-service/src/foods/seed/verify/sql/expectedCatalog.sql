-- The catalog the committed seed implies: roots, items, variants, parts, and each item's source rows, portions and food
-- groups (curated catalog plan U1, U6, R4, R9, R48, KTD-6, KTD-7, KTD-27, KTD-28). Restates
-- `composeSeedImage`/`composeItem` in `seedImage.ts` and `projectSeed` in `seedProjection.ts`.
--
-- Every row is keyed by natural key, never by an id: a root by its seed key, an item and a variant by the item's key.

-- ── Roots: every curated root, then every baseline group none of whose items the curated seed placed ──────
-- A group is placed when its supplier is a curated root's item, a variant's item, or a declared alias: the format
-- check refuses any of those that is not its group's supplier, so the supplier alone says whether a group is placed.
CREATE TEMP TABLE v_seed_placed AS
    SELECT item_key FROM v_seed_root WHERE item_key IS NOT NULL
    UNION
    SELECT item_key FROM v_seed_variant
    UNION
    SELECT alias_key FROM v_seed_alias;

CREATE TEMP TABLE v_expected_root AS
    SELECT seed_key, name, synonyms, coalesce(item_key, seed_key) AS item_key, nutrition, 'curated'::text AS origin
      FROM v_seed_root
    UNION ALL
    SELECT supplier_key, name, '[]'::jsonb, supplier_key, NULL, 'baseline'
      FROM v_baseline_group
     WHERE supplier_key NOT IN (SELECT item_key FROM v_seed_placed);

-- A root's stored synonyms: joined in seed order by `; ` (`ALIAS_DELIMITER`), and NULL, never '', when it has none
-- (GR-019). The snapshot reader splits on the same delimiter, so the order is content. Its dedup key is
-- `normalizeName` of its name, the key the live-name claim (KTD-12) and the catalog's unique index read.
ALTER TABLE v_expected_root ADD COLUMN aliases text;
ALTER TABLE v_expected_root ADD COLUMN normalized_name text;

UPDATE v_expected_root root
   SET aliases = (
           SELECT string_agg(synonym.value #>> '{}', '; ' ORDER BY synonym.ordinality)
             FROM jsonb_array_elements(root.synonyms) WITH ORDINALITY AS synonym
       ),
       normalized_name = pg_temp.v_normalize_name(root.name);

-- ── Items: each root's item, and each variant's (KTD-6). A sourceless root's item is keyed by its seed key ────
CREATE TEMP TABLE v_expected_item AS
    SELECT item_key, 'root'::text AS owner_kind FROM v_expected_root
    UNION ALL
    SELECT item_key, 'variant' FROM v_seed_variant;

-- ── Variants and parts. A part's place within its attribute is what its ordinal orders (KTD-7) ─────────────
CREATE TEMP TABLE v_expected_variant AS
    SELECT item_key, root_key FROM v_seed_variant;

CREATE TEMP TABLE v_expected_part AS
    SELECT item_key, attribute, text,
           row_number() OVER (PARTITION BY item_key, attribute ORDER BY position) AS attribute_place
      FROM v_seed_part;

-- ── Source rows (R48, rule 28a): the item's own group, supplier first, then each declared alias of it in file
--    order, the alias first and the rest of its group after it, each group in election order ─────────────────
CREATE TEMP TABLE v_expected_source AS
    SELECT item.item_key, member.item_key AS source_key, member.fdc_id, member.lineage_key, member.food_group,
           member.has_energy, member.is_foundation, member.publication_date, 0::bigint AS alias_position,
           member.supply_rank
      FROM v_expected_item item
      JOIN v_baseline_member member ON member.supplier_key = item.item_key
    UNION ALL
    SELECT item.item_key, member.item_key, member.fdc_id, member.lineage_key, member.food_group,
           member.has_energy, member.is_foundation, member.publication_date, alias.position, member.supply_rank
      FROM v_expected_item item
      JOIN v_seed_alias alias ON alias.of_key = item.item_key
      JOIN v_baseline_member member ON member.supplier_key = alias.alias_key;

ALTER TABLE v_expected_source ADD COLUMN source_order bigint;
ALTER TABLE v_expected_source ADD COLUMN portion_rank bigint;

-- `sources` order (categories cite the first source that states a group), and `unionPortions`' order: the supplier,
-- then every other source pooled and re-ranked by the election's order (`rankBySupply`). The two differ.
UPDATE v_expected_source source
   SET source_order = ranked.source_order, portion_rank = ranked.portion_rank
  FROM (
      SELECT item_key, source_key,
             row_number() OVER (PARTITION BY item_key ORDER BY alias_position, supply_rank) AS source_order,
             row_number() OVER (
                 PARTITION BY item_key
                 ORDER BY source_key = item_key DESC, has_energy DESC, is_foundation DESC,
                          publication_date COLLATE "C" DESC, fdc_id::bigint DESC
             ) AS portion_rank
        FROM v_expected_source
  ) AS ranked
 WHERE ranked.item_key = source.item_key AND ranked.source_key = source.source_key;

-- ── Portions (R9): for each label, every row of the best-ranked source that has it, and no other source's ────
CREATE TEMP TABLE v_expected_source_portion AS
    SELECT item_key, fdc_id, label, gram_weight::numeric AS gram_weight
      FROM (
          SELECT source.item_key, source.fdc_id, source.portion_rank, portion.label, portion.gram_weight,
                 min(source.portion_rank) OVER (PARTITION BY source.item_key, portion.label) AS best_rank
            FROM v_expected_source source
            JOIN v_usda_item_portion portion ON portion.item_key = source.source_key
      ) AS ranked
     WHERE portion_rank = best_rank;

-- ── Food groups (owner, 2026-10-01): each group an item's sources state, once, cited by the first in source order ─
CREATE TEMP TABLE v_expected_category AS
    SELECT DISTINCT ON (item_key, food_group) item_key, food_group AS name, fdc_id
      FROM v_expected_source
     WHERE food_group IS NOT NULL
     ORDER BY item_key, food_group, source_order;

ANALYZE v_expected_root;
ANALYZE v_expected_item;
ANALYZE v_expected_source;
ANALYZE v_expected_source_portion;

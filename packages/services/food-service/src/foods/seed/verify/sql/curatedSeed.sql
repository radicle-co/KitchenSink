-- The committed curated seed, read as Postgres reads JSON and tab-separated text (curated catalog plan U1, U6, R48,
-- R51, KTD-16, KTD-22). Nothing here judges the format: the seeder's format check refuses a malformed seed before
-- any apply, and a line this cannot read fails the derivation loudly rather than dropping out of it.

-- ── curatedCatalog.jsonl: one root per line, in file order ───────────────────────────────────────────
CREATE TEMP TABLE v_seed_root AS
    SELECT ordinal AS line_number,
           doc ->> 'seedKey' AS seed_key,
           doc ->> 'name' AS name,
           doc -> 'synonyms' AS synonyms,
           doc ->> 'item' AS item_key,
           nullif(doc -> 'nutrition', 'null'::jsonb) AS nutrition,
           doc -> 'variants' AS variants
      FROM (SELECT ordinal, line::jsonb AS doc FROM v_raw_catalog WHERE line <> '') AS lines;

-- A root's variants, each with its position in the root's list.
CREATE TEMP TABLE v_seed_variant AS
    SELECT root.seed_key AS root_key, variant.ordinality AS position, variant.value ->> 'item' AS item_key,
           variant.value -> 'parts' AS parts
      FROM v_seed_root root
     CROSS JOIN LATERAL jsonb_array_elements(root.variants) WITH ORDINALITY AS variant;

-- A variant's parts, each with its position in the variant's list: the order is the label (KTD-7).
CREATE TEMP TABLE v_seed_part AS
    SELECT variant.item_key, part.ordinality AS position, part.value ->> 'attribute' AS attribute,
           part.value ->> 'text' AS text
      FROM v_seed_variant variant
     CROSS JOIN LATERAL jsonb_array_elements(variant.parts) WITH ORDINALITY AS part;

-- ── catalogChanges.json: one document over many lines, put back together in file order ──────────────────
CREATE TEMP TABLE v_seed_changes AS
    SELECT string_agg(line, E'\n' ORDER BY ordinal)::jsonb AS doc FROM v_raw_changes;

-- R51: the excluded items.
CREATE TEMP TABLE v_seed_exclusion AS
    SELECT DISTINCT excluded.value #>> '{}' AS item_key
      FROM v_seed_changes changes
     CROSS JOIN LATERAL jsonb_array_elements(changes.doc -> 'exclusions') AS excluded;

-- Naming rule 28a: each declared alias, in file order, and the item it is an alias source of.
CREATE TEMP TABLE v_seed_alias AS
    SELECT alias.ordinality AS position, alias.value ->> 'from' AS alias_key, alias.value ->> 'of' AS of_key
      FROM v_seed_changes changes
     CROSS JOIN LATERAL jsonb_array_elements(changes.doc -> 'aliases') WITH ORDINALITY AS alias;

-- ── sourceCandidates.tsv: the header line, then `seedKey dataset key match` per candidate (KTD-22) ────────
CREATE TEMP TABLE v_seed_candidate AS
    SELECT ordinal AS line_number, split_part(line, E'\t', 1) AS seed_key, split_part(line, E'\t', 2) AS dataset,
           split_part(line, E'\t', 3) AS key, split_part(line, E'\t', 4) AS match
      FROM v_raw_candidates
     WHERE ordinal > 1 AND line <> '';

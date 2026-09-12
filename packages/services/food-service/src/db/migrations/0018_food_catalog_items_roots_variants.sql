-- 0018: the item-keyed catalog — items, roots, variants, nutrition by owner, forwards and the seed ledger
-- (curated catalog plan U4; KTD-6, KTD-7, KTD-8, KTD-12, KTD-13, KTD-14, KTD-19; R47 to R54).
--
-- Applied once by the in-VPC runner, inside its own BEGIN/COMMIT, so it opens no transaction. The Drizzle
-- definitions in src/db/schema/{food,catalogItems,foodNutrition,seedLedger}.ts mirror this file, and
-- src/db/schema/catalog.ts names each table's set for the runner's grants (KTD-13).
--
-- ⛔ ONE migration with no backfill (KTD-9): no database holds catalog data that matters, so the per-food tables
-- are dropped and created again keyed by item rather than migrated. ADR-0050 records this exception to ADR-0035.
--
-- ⛔ No new `food_source` value is USED anywhere in this file. `ADD VALUE` is legal inside a transaction, but the
-- value cannot be used until the transaction commits. A citation's source comes from its dataset
-- (`DATASET_SOURCE` in src/foods/seed/citationDatasets.ts), so no column here needs one.
--
-- ⛔ This file never names `food_seeder`. `local:up` applies it as `postgres` on a database with no seeder role;
-- the runner grants the seeder its rights from the registry (KTD-13, ADR-0051 §6).

-- ── Enums, each in its code list's order (parity: tests/e2e/catalogSchema.e2e.test.ts) ─────────────
-- REGISTERED_SOURCE_IDS (src/sources/sourceRegister.ts), after the existing 'usda'.
ALTER TYPE "food_source" ADD VALUE 'ciqual';
ALTER TYPE "food_source" ADD VALUE 'cofid';
ALTER TYPE "food_source" ADD VALUE 'bls';
ALTER TYPE "food_source" ADD VALUE 'stfcj';
ALTER TYPE "food_source" ADD VALUE 'matvaretabellen';
ALTER TYPE "food_source" ADD VALUE 'livsmedelsverket';
ALTER TYPE "food_source" ADD VALUE 'fsvo';
ALTER TYPE "food_source" ADD VALUE 'cnf';

CREATE TYPE "food_item_owner_kind" AS ENUM ('root', 'variant');

-- VARIANT_ATTRIBUTES (src/foods/domain/variantAttribute.ts). The declaration order is the contract order (KTD-7):
-- a new attribute is added BEFORE 'origin' in its own migration.
CREATE TYPE "food_variant_attribute" AS ENUM (
    'cut', 'bone', 'skin', 'formOrVariety', 'babyFoodStage', 'pack', 'fat', 'trim', 'grade', 'cookingMethod',
    'salt', 'sugar', 'addedNutrients', 'brand', 'origin'
);

-- CITATION_DATASETS (src/foods/seed/citationDatasets.ts) and CITATION_MATCHES
-- (src/foods/seed/catalog/citationPrecedence.ts).
CREATE TYPE "citation_dataset" AS ENUM (
    'usdaSrFoundation', 'usdaFndds', 'ciqual', 'cofid', 'bls', 'stfcj', 'matvaretabellen', 'livsmedelsverket',
    'fsvo', 'cnf', 'usdaBranded', 'label'
);
CREATE TYPE "citation_match" AS ENUM ('exact', 'sameSubstance', 'close', 'generic');

-- ── The per-food tables and the live-only origin marker go; seed ownership replaces the marker ──────
DROP VIEW "food_nutrient_view";
DROP TABLE "food_nutrients", "food_popularity", "food_category_assignment", "food_field_provenance",
    "food_portions", "food_sources";
ALTER TABLE "food" DROP COLUMN "origin";
DROP TYPE "food_origin";

-- ── The nutrient dictionary keys on a definition's INFOODS tag (KTD-23) ──────────────────────────
ALTER TABLE "nutrient" RENAME COLUMN "external_code" TO "infoods_tag";
ALTER TABLE "nutrient" RENAME CONSTRAINT "nutrient_code_unique" TO "nutrient_infoods_tag_unique";
ALTER TABLE "nutrient" ADD CONSTRAINT "nutrient_infoods_tag_format" CHECK ("infoods_tag" ~ '^[A-Z][A-Z0-9_]*$');

-- ── food_item: the unit sources, portions and popularity attach to (KTD-6) ──────────────────────
-- `seed_owned` is a fact of the item, fixed at insert (KTD-12): a natural key is `fdc:<id>` or the root's
-- `curated:` seed key (KTD-8), and only the seed mints one. `owner_kind` is the subtype discriminator its
-- owner's composite foreign key matches, so one item can never have two owners.
CREATE TABLE "food_item" (
    "id"          text PRIMARY KEY NOT NULL,
    "natural_key" text,
    "seed_owned"  boolean GENERATED ALWAYS AS ("natural_key" IS NOT NULL) STORED NOT NULL,
    "owner_kind"  "food_item_owner_kind" NOT NULL,
    "created_at"  timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "food_item_natural_key_unique" UNIQUE ("natural_key"),
    CONSTRAINT "food_item_id_owner_kind_unique" UNIQUE ("id", "owner_kind"),
    CONSTRAINT "food_item_natural_key_format"
        CHECK ("natural_key" ~ '^(fdc:[1-9][0-9]*|curated:[a-z0-9]+(-[a-z0-9]+)*)$')
);

-- ── food: the root. It owns exactly one item, retired or not (KTD-8) ───────────────────────────
ALTER TABLE "food"
    ADD COLUMN "item_id" text NOT NULL,
    ADD COLUMN "item_owner_kind" "food_item_owner_kind" DEFAULT 'root' NOT NULL,
    ADD COLUMN "seed_key" text,
    ADD COLUMN "retired_at" timestamp with time zone,
    ADD CONSTRAINT "food_item_id_unique" UNIQUE ("item_id"),
    ADD CONSTRAINT "food_item_owner_kind_root" CHECK ("item_owner_kind" = 'root'),
    -- NO ACTION: an item cannot be deleted while it has an owner.
    ADD CONSTRAINT "food_item_fk" FOREIGN KEY ("item_id", "item_owner_kind")
        REFERENCES "food_item" ("id", "owner_kind"),
    ADD CONSTRAINT "food_seed_key_unique" UNIQUE ("seed_key"),
    ADD CONSTRAINT "food_seed_key_format"
        CHECK ("seed_key" ~ '^(fdc:[1-9][0-9]*|curated:[a-z0-9]+(-[a-z0-9]+)*)$'),
    ADD CONSTRAINT "food_seed_key_not_authored" CHECK ("seed_key" IS NULL OR "user_id" IS NULL),
    ADD CONSTRAINT "food_retired_not_authored" CHECK ("retired_at" IS NULL OR "user_id" IS NULL);

-- A catalog name is unique among LIVE catalog roots only, so a retired root frees its name.
DROP INDEX "food_normalized_name_catalog_unique";
CREATE UNIQUE INDEX "food_normalized_name_catalog_unique" ON "food" USING btree ("normalized_name")
    WHERE "user_id" IS NULL AND "retired_at" IS NULL;

-- ── food_variant and its parts (KTD-7) ──────────────────────────────────────────────────────────
CREATE TABLE "food_variant" (
    "id"              text PRIMARY KEY NOT NULL,
    "food_id"         text NOT NULL REFERENCES "food" ("id"),
    "item_id"         text NOT NULL,
    "item_owner_kind" "food_item_owner_kind" DEFAULT 'variant' NOT NULL,
    "retired_at"      timestamp with time zone,
    "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "food_variant_item_id_unique" UNIQUE ("item_id"),
    CONSTRAINT "food_variant_item_owner_kind_variant" CHECK ("item_owner_kind" = 'variant'),
    CONSTRAINT "food_variant_item_fk" FOREIGN KEY ("item_id", "item_owner_kind")
        REFERENCES "food_item" ("id", "owner_kind")
);
CREATE INDEX "food_variant_food_id_idx" ON "food_variant" USING btree ("food_id");

CREATE TABLE "food_variant_part" (
    "variant_id" text NOT NULL REFERENCES "food_variant" ("id") ON DELETE CASCADE,
    "attribute"  "food_variant_attribute" NOT NULL,
    "ordinal"    smallint NOT NULL,
    "text"       text NOT NULL,
    CONSTRAINT "food_variant_part_pk" PRIMARY KEY ("variant_id", "attribute", "ordinal"),
    CONSTRAINT "food_variant_part_ordinal_nonneg" CHECK ("ordinal" >= 0),
    CONSTRAINT "food_variant_part_text_check" CHECK ("text" <> '' AND "text" !~ '["″]')
);

-- ── Per-item tables (KTD-6). Same-item provenance foreign keys keep D-PROVENANCE-FK ───────────────
CREATE TABLE "food_sources" (
    "id"           text PRIMARY KEY NOT NULL,
    "item_id"      text NOT NULL REFERENCES "food_item" ("id") ON DELETE CASCADE,
    "source"       "food_source" NOT NULL,
    "external_key" text NOT NULL,
    "fetch_state"  text DEFAULT 'fetched' NOT NULL,
    "item_version" text,
    "fetched_at"   timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "food_sources_source_key_unique" UNIQUE ("source", "external_key"),
    CONSTRAINT "food_sources_item_id_id_unique" UNIQUE ("item_id", "id"),
    CONSTRAINT "food_sources_fetch_state_check" CHECK ("fetch_state" IN ('fetched', 'error'))
);
CREATE INDEX "food_sources_item_id_idx" ON "food_sources" USING btree ("item_id");

CREATE TABLE "food_field_provenance" (
    "item_id"   text NOT NULL REFERENCES "food_item" ("id") ON DELETE CASCADE,
    "field"     "food_field" NOT NULL,
    "source_id" text NOT NULL,
    CONSTRAINT "food_field_provenance_pk" PRIMARY KEY ("item_id", "field"),
    CONSTRAINT "food_field_provenance_same_item_fk"
        FOREIGN KEY ("item_id", "source_id") REFERENCES "food_sources" ("item_id", "id")
);

-- The category foreign key is NO ACTION: deleting a referenced category must never cascade into a seed-owned row
-- (KTD-14), and the dictionaries give no role but the owner a DELETE.
CREATE TABLE "food_category_assignment" (
    "item_id"     text NOT NULL REFERENCES "food_item" ("id") ON DELETE CASCADE,
    "category_id" text NOT NULL REFERENCES "food_category" ("id"),
    "source_id"   text,
    CONSTRAINT "food_category_assignment_pk" PRIMARY KEY ("item_id", "category_id"),
    CONSTRAINT "food_category_assignment_same_item_fk"
        FOREIGN KEY ("item_id", "source_id") REFERENCES "food_sources" ("item_id", "id")
);

CREATE TABLE "food_popularity" (
    "item_id"            text PRIMARY KEY NOT NULL REFERENCES "food_item" ("id") ON DELETE CASCADE,
    "consumption_weight" numeric NOT NULL CHECK ("consumption_weight" >= 0),
    "prior_fraction"     numeric NOT NULL CHECK ("prior_fraction" >= 0 AND "prior_fraction" <= 1),
    "source"             text NOT NULL,
    "seeded_at"          timestamp with time zone DEFAULT now() NOT NULL
);

-- ── Nutrition: one header per owner, a root or a variant, never both (KTD-19, Exclusive Arc) ───────
CREATE TABLE "food_nutrition" (
    "id"              text PRIMARY KEY NOT NULL,
    "food_id"         text REFERENCES "food" ("id") ON DELETE CASCADE,
    "food_variant_id" text REFERENCES "food_variant" ("id") ON DELETE CASCADE,
    CONSTRAINT "food_nutrition_one_owner" CHECK (num_nonnulls("food_id", "food_variant_id") = 1)
);
CREATE UNIQUE INDEX "food_nutrition_food_id_unique" ON "food_nutrition" ("food_id") WHERE "food_id" IS NOT NULL;
CREATE UNIQUE INDEX "food_nutrition_food_variant_id_unique" ON "food_nutrition" ("food_variant_id")
    WHERE "food_variant_id" IS NOT NULL;

-- A citation is a source item (dataset + external key + match) or a manufacturer label (the five label columns),
-- read off its columns. The conversions it records are R54's: a density for per-100-mL values, and kJ to kcal.
CREATE TABLE "food_nutrition_citation" (
    "id"               text PRIMARY KEY NOT NULL,
    "nutrition_id"     text NOT NULL REFERENCES "food_nutrition" ("id") ON DELETE CASCADE,
    "dataset"          "citation_dataset" NOT NULL,
    "external_key"     text,
    "match"            "citation_match",
    "density_g_per_ml" numeric,
    "kcal_from_kj"     boolean DEFAULT false NOT NULL,
    "url"              text,
    "retrieved_on"     date,
    "manufacturer"     text,
    "serving_label"    text,
    "serving_grams"    numeric,
    CONSTRAINT "food_nutrition_citation_nutrition_id_id_unique" UNIQUE ("nutrition_id", "id"),
    CONSTRAINT "food_nutrition_citation_density_positive" CHECK ("density_g_per_ml" > 0),
    CONSTRAINT "food_nutrition_citation_serving_grams_positive" CHECK ("serving_grams" > 0),
    CONSTRAINT "food_nutrition_citation_source_item_shape" CHECK (
        "dataset" = 'label'
        OR ("external_key" IS NOT NULL AND "match" IS NOT NULL AND "url" IS NULL AND "retrieved_on" IS NULL
            AND "manufacturer" IS NULL AND "serving_label" IS NULL AND "serving_grams" IS NULL)
    ),
    CONSTRAINT "food_nutrition_citation_label_shape" CHECK (
        "dataset" <> 'label'
        OR ("url" IS NOT NULL AND "retrieved_on" IS NOT NULL AND "manufacturer" IS NOT NULL
            AND "serving_label" IS NOT NULL AND "serving_grams" IS NOT NULL AND "external_key" IS NULL
            AND "match" IS NULL AND "density_g_per_ml" IS NULL AND NOT "kcal_from_kj")
    )
);
-- Not unique: whether two roots may cite one (dataset, key) is an open owner question (blueprint §6).
CREATE INDEX "food_nutrition_citation_dataset_key_idx" ON "food_nutrition_citation" ("dataset", "external_key")
    WHERE "external_key" IS NOT NULL;
-- One header cites one source item once, so a concurrent cite arbitrates here under ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX "food_nutrition_citation_source_item_unique"
    ON "food_nutrition_citation" ("nutrition_id", "dataset", "external_key") WHERE "external_key" IS NOT NULL;

-- A trace mark is stored as a mark with no amount, never as a number (R53). A value cites its OWN header's
-- citation; a NULL citation means the food's author wrote it (ADR-0029), which the assertion trigger below checks.
CREATE TABLE "food_nutrition_value" (
    "nutrition_id" text NOT NULL REFERENCES "food_nutrition" ("id") ON DELETE CASCADE,
    "nutrient_id"  text NOT NULL REFERENCES "nutrient" ("id"),
    "amount"       numeric,
    "trace"        boolean DEFAULT false NOT NULL,
    "basis"        "nutrient_basis" DEFAULT 'per_100g' NOT NULL,
    "citation_id"  text,
    CONSTRAINT "food_nutrition_value_pk" PRIMARY KEY ("nutrition_id", "nutrient_id"),
    CONSTRAINT "food_nutrition_value_amount_nonneg" CHECK ("amount" >= 0),
    CONSTRAINT "food_nutrition_value_trace_or_amount" CHECK (("amount" IS NULL) = "trace"),
    CONSTRAINT "food_nutrition_value_same_header_citation_fk"
        FOREIGN KEY ("nutrition_id", "citation_id") REFERENCES "food_nutrition_citation" ("nutrition_id", "id")
);

-- A portion comes from a source row of its item, from a citation (a label or Branded serving, OQ-1), or from the
-- food's author when it names neither.
CREATE TABLE "food_portions" (
    "id"          text PRIMARY KEY NOT NULL,
    "item_id"     text NOT NULL REFERENCES "food_item" ("id") ON DELETE CASCADE,
    "label"       text NOT NULL,
    "gram_weight" numeric NOT NULL,
    "source_id"   text,
    "citation_id" text REFERENCES "food_nutrition_citation" ("id") ON DELETE CASCADE,
    CONSTRAINT "food_portions_gram_weight_pos" CHECK ("gram_weight" > 0),
    CONSTRAINT "food_portions_one_provenance" CHECK (num_nonnulls("source_id", "citation_id") <= 1),
    CONSTRAINT "food_portions_same_item_fk"
        FOREIGN KEY ("item_id", "source_id") REFERENCES "food_sources" ("item_id", "id")
);
CREATE INDEX "food_portions_item_id_idx" ON "food_portions" USING btree ("item_id");
CREATE INDEX "food_portions_citation_id_idx" ON "food_portions" USING btree ("citation_id")
    WHERE "citation_id" IS NOT NULL;

-- ── History: forwards and the seed ledger ──────────────────────────────────────────────────────
-- A forward outlives its source row, so `source_id` has no foreign key. Its target is a root or a variant.
CREATE TABLE "food_forward" (
    "source_id"         text PRIMARY KEY NOT NULL,
    "source_kind"       "food_item_owner_kind" NOT NULL,
    "source_key"        text,
    "target_food_id"    text REFERENCES "food" ("id"),
    "target_variant_id" text REFERENCES "food_variant" ("id"),
    "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "food_forward_one_target" CHECK (num_nonnulls("target_food_id", "target_variant_id") = 1)
);
CREATE UNIQUE INDEX "food_forward_source_key_unique" ON "food_forward" ("source_kind", "source_key")
    WHERE "source_key" IS NOT NULL;
CREATE INDEX "food_forward_target_food_id_idx" ON "food_forward" ("target_food_id")
    WHERE "target_food_id" IS NOT NULL;
CREATE INDEX "food_forward_target_variant_id_idx" ON "food_forward" ("target_variant_id")
    WHERE "target_variant_id" IS NOT NULL;

CREATE TABLE "catalog_seed_ledger" (
    "id"         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "seed_sha"   text NOT NULL,
    "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "catalog_seed_ledger_seed_sha_format" CHECK ("seed_sha" ~ '^[0-9a-f]{64}$')
);

-- ── Functions. None writes, so no trigger can recurse ───────────────────────────────────────────
-- ⛔ Every function pins `pg_temp` LAST and names each relation by schema. PostgreSQL searches `pg_temp` FIRST for an
-- unqualified relation unless the path names it, and the seeder holds TEMPORARY: a temporary `pg_class` or
-- `food_item` would otherwise decide who is writing and what the seed owns (db-arch-1 review of U4a;
-- catalogSchema.e2e.test.ts shadows each relation a guard reads).
-- Who is writing, by SESSION user so a cascade cannot launder a write (KTD-12): a member of the table's owner
-- (migrations), the seeder (holds INSERT on the ledger without being an owner member), or anyone else.
CREATE FUNCTION "catalog_writer"(rel regclass) RETURNS text
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT CASE
        WHEN pg_has_role(session_user, c.relowner, 'MEMBER') THEN 'owner'
        WHEN has_table_privilege(session_user, 'public.catalog_seed_ledger', 'INSERT') THEN 'seeder'
        ELSE 'other'
    END
    FROM pg_catalog.pg_class c WHERE c.oid = rel
$$;

-- Whether a row this session can see was written by this transaction or one of its subtransactions. Another
-- session's uncommitted row is invisible, so a visible row whose writer is still in progress is ours. `xmin` is a
-- 32-bit xid: it is widened with the current epoch, which can misread only across an xid epoch boundary inside one
-- transaction, and then reads as not ours, which refuses rather than admits.
CREATE FUNCTION "catalog_written_here"(x xid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $$
    SELECT coalesce(
        pg_xact_status((((pg_current_xact_id()::text::bigint >> 32) << 32) | x::text::bigint)::text::xid8)
            = 'in progress',
        false
    )
$$;

-- The ownership policy (KTD-12): one decision rule over one resolver per guarded table. A resolver maps each changed
-- row to its item's `seed_owned`; NULL means its parent is gone. A DELETE row whose parent is gone was removed by a
-- cascade from a guarded parent, or with its parent in one statement, and the parent's own trigger decides that
-- statement, so the row is skipped here. A table with no resolver is refused, so a new guarded table fails loudly.
CREATE FUNCTION "catalog_guard"() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    writer text := public.catalog_writer(TG_RELID);
    resolver text;
    changed text;
    any_seed boolean;
    any_other boolean;
BEGIN
    IF writer = 'owner' THEN
        RETURN NULL;
    END IF;

    resolver := CASE
        WHEN TG_TABLE_NAME = 'food_item' THEN
            'SELECT r.seed_owned FROM %1$I r'
        WHEN TG_TABLE_NAME IN ('food', 'food_variant', 'food_sources', 'food_field_provenance',
                               'food_category_assignment', 'food_popularity', 'food_portions') THEN
            'SELECT i.seed_owned FROM %1$I r LEFT JOIN public.food_item i ON i.id = r.item_id'
        WHEN TG_TABLE_NAME = 'food_variant_part' THEN
            'SELECT i.seed_owned FROM %1$I r LEFT JOIN public.food_variant v ON v.id = r.variant_id
                    LEFT JOIN public.food_item i ON i.id = v.item_id'
        WHEN TG_TABLE_NAME = 'food_nutrition' THEN
            'SELECT i.seed_owned FROM %1$I r LEFT JOIN public.food f ON f.id = r.food_id
                    LEFT JOIN public.food_variant v ON v.id = r.food_variant_id
                    LEFT JOIN public.food_item i ON i.id = coalesce(f.item_id, v.item_id)'
        WHEN TG_TABLE_NAME IN ('food_nutrition_citation', 'food_nutrition_value') THEN
            'SELECT i.seed_owned FROM %1$I r LEFT JOIN public.food_nutrition h ON h.id = r.nutrition_id
                    LEFT JOIN public.food f ON f.id = h.food_id LEFT JOIN public.food_variant v ON v.id = h.food_variant_id
                    LEFT JOIN public.food_item i ON i.id = coalesce(f.item_id, v.item_id)'
    END;

    IF resolver IS NULL THEN
        RAISE EXCEPTION 'catalog_guard has no resolver for table %', TG_TABLE_NAME
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    changed := CASE TG_OP
        WHEN 'INSERT' THEN format(resolver, 'new_rows')
        WHEN 'DELETE' THEN format(resolver, 'old_rows')
        ELSE format(resolver, 'old_rows') || ' UNION ALL ' || format(resolver, 'new_rows')
    END;

    EXECUTE format(
        'SELECT coalesce(bool_or(s IS TRUE), false), coalesce(bool_or(s IS FALSE OR (s IS NULL AND $1)), false)
           FROM (%s) AS x(s)',
        changed
    ) INTO any_seed, any_other USING (TG_OP <> 'DELETE');

    IF writer = 'seeder' THEN
        IF NOT any_other THEN
            RETURN NULL;
        END IF;

        -- The one named exception: the seeder retires a live, unauthored catalog food whose name a seed root claims,
        -- changing nothing but its retirement (KTD-12). Its forward is checked at commit by food_retire_forwarded.
        -- Every OLD row is judged: it keeps its id, and either its old and new items are both seed-owned (a merge
        -- re-points one, ADR-0050 §2) or it is that retirement. Both transition tables hold the same number of rows,
        -- each with a unique id, so an old row with no new row of its id is the only way an id change can show.
        IF TG_TABLE_NAME = 'food' AND TG_OP = 'UPDATE' THEN
            IF NOT EXISTS (
                SELECT 1
                  FROM old_rows o
                  LEFT JOIN new_rows n ON n.id = o.id
                  LEFT JOIN public.food_item oi ON oi.id = o.item_id
                  LEFT JOIN public.food_item ni ON ni.id = n.item_id
                 WHERE NOT coalesce(
                     (oi.seed_owned AND ni.seed_owned)
                     OR (o.user_id IS NULL AND o.retired_at IS NULL AND n.retired_at IS NOT NULL
                         AND (to_jsonb(o) - 'retired_at' - 'updated_at') = (to_jsonb(n) - 'retired_at' - 'updated_at')),
                     false
                 )
            ) THEN
                RETURN NULL;
            END IF;
        END IF;

        RAISE EXCEPTION 'food_seeder may not % % rows the seed does not own', TG_OP, TG_TABLE_NAME
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF any_seed THEN
        RAISE EXCEPTION '% may not % seed-owned % rows', session_user, TG_OP, TG_TABLE_NAME
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NULL;
END
$$;

-- A forward is decided by its SOURCE (KTD-12). The seeder may forward a row it removed, a seed-owned row, or the live
-- food it retires under the named exception; food_app only a live, unauthored, unseeded food that this transaction
-- retired. Either way the target must be a live catalog root or variant. Only the seed removes a forward;
-- nobody but the owner changes one.
CREATE FUNCTION "food_forward_guard"() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    writer text := public.catalog_writer(TG_RELID);
BEGIN
    IF writer = 'owner' THEN
        RETURN NULL;
    END IF;

    -- A forward is history: the apply only inserts one (KTD-8), and a retired successor is reached by following the
    -- chain, so no writer but the owner has an UPDATE. A seeder that could re-aim a forward could squat a live food's.
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'a forward is never changed' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- The seeder removes a forward it will restore or re-aim, by the rule it inserts by: its source is a row it removed
    -- or one the seed owns, found in the table it is in. A forward food_app wrote for a live food stays.
    IF TG_OP = 'DELETE' THEN
        IF writer = 'seeder' AND NOT EXISTS (
            SELECT 1
              FROM old_rows r
              LEFT JOIN public.food f ON f.id = r.source_id
              LEFT JOIN public.food_item fi ON fi.id = f.item_id
              LEFT JOIN public.food_variant v ON v.id = r.source_id
              LEFT JOIN public.food_item vi ON vi.id = v.item_id
             WHERE (f.id IS NOT NULL AND fi.seed_owned IS NOT TRUE) OR (v.id IS NOT NULL AND vi.seed_owned IS NOT TRUE)
        ) THEN
            RETURN NULL;
        END IF;

        RAISE EXCEPTION '% may not remove this forward', session_user USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM new_rows r
          LEFT JOIN public.food f ON f.id = r.target_food_id
          LEFT JOIN public.food_variant v ON v.id = r.target_variant_id
         WHERE f.retired_at IS NOT NULL OR f.user_id IS NOT NULL OR v.retired_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'a forward must point to a live catalog root or variant' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- The source is judged by the table it is in, never by the kind the row claims: a root's id written as a variant
    -- would otherwise find no row and pass as one the seeder removed.
    IF EXISTS (
        SELECT 1
          FROM new_rows r
          LEFT JOIN public.food f ON f.id = r.source_id
          LEFT JOIN public.food_variant v ON v.id = r.source_id
         WHERE (f.id IS NOT NULL AND r.source_kind <> 'root') OR (v.id IS NOT NULL AND r.source_kind <> 'variant')
    ) THEN
        RAISE EXCEPTION 'a forward''s source_kind must name the table its source is in'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM new_rows r
          LEFT JOIN public.food f ON f.id = r.source_id
          LEFT JOIN public.food_variant v ON v.id = r.source_id
          LEFT JOIN public.food_item i ON i.id = coalesce(f.item_id, v.item_id)
         WHERE NOT (
             (f.id IS NOT NULL AND f.user_id IS NULL AND NOT i.seed_owned AND f.retired_at IS NOT NULL
                  AND public.catalog_written_here(f.xmin))
             OR (writer = 'seeder' AND (i.id IS NULL OR i.seed_owned))
         )
    ) THEN
        RAISE EXCEPTION '% may not forward this source', session_user USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NULL;
END
$$;

-- Every retired catalog food that the seed does not own has a forward by commit (KTD-8, KTD-12).
CREATE FUNCTION "food_retire_forwarded"() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.food_forward WHERE source_id = NEW.id) THEN
        RAISE EXCEPTION 'retired catalog food % has no forward', NEW.id USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END
$$;

-- The facts every other rule reads, fixed after insert: seed ownership, a root's id (never re-minted, ADR-0050 §4),
-- author and seed key, and a nutrition header's owner (KTD-12, KTD-19).
CREATE FUNCTION "catalog_immutable"() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF TG_TABLE_NAME = 'food_item' THEN
        IF NEW.natural_key IS DISTINCT FROM OLD.natural_key THEN
            RAISE EXCEPTION 'food_item.natural_key is fixed at insert' USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    ELSIF TG_TABLE_NAME = 'food' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.seed_key IS DISTINCT FROM OLD.seed_key THEN
            RAISE EXCEPTION 'food.id, food.user_id and food.seed_key are fixed at insert'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    ELSIF TG_TABLE_NAME = 'food_nutrition' THEN
        IF NEW.food_id IS DISTINCT FROM OLD.food_id OR NEW.food_variant_id IS DISTINCT FROM OLD.food_variant_id THEN
            RAISE EXCEPTION 'a nutrition header''s owner is fixed at insert'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END IF;

    RETURN NEW;
END
$$;

-- "Uncited means authored" (KTD-19, ADR-0029): a value or portion with no citation and no source row is admitted
-- only under a root whose `user_id` is set. It reads the existing facts and copies none.
CREATE FUNCTION "catalog_uncited_means_authored"() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    authored boolean;
BEGIN
    IF TG_TABLE_NAME = 'food_nutrition_value' THEN
        IF NEW.citation_id IS NOT NULL THEN
            RETURN NULL;
        END IF;

        SELECT f.user_id IS NOT NULL INTO authored
          FROM public.food_nutrition h JOIN public.food f ON f.id = h.food_id
         WHERE h.id = NEW.nutrition_id;
    ELSE
        IF NEW.source_id IS NOT NULL OR NEW.citation_id IS NOT NULL THEN
            RETURN NULL;
        END IF;

        SELECT f.user_id IS NOT NULL INTO authored FROM public.food f WHERE f.item_id = NEW.item_id;
    END IF;

    IF authored IS NOT TRUE THEN
        RAISE EXCEPTION 'an uncited % row is allowed only under an authored food', TG_TABLE_NAME
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    RETURN NULL;
END
$$;

-- A variant belongs to the seed (R40): its item is seed-owned and its root is unauthored. It binds every writer, the
-- owner included, because it is a fact of the data, not a privilege; catalog_guard admits food_app on an unseeded item
-- and the seeder on a seed-owned one, so neither alone refuses a variant under an authored root. A variant's header
-- needs no rule of its own: its owner is fixed at insert and the variant can only be the seed's.
CREATE FUNCTION "food_variant_seed_only"() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.food f
          JOIN public.food_item i ON i.id = NEW.item_id
         WHERE f.id = NEW.food_id AND f.user_id IS NULL AND i.seed_owned
    ) THEN
        RAISE EXCEPTION 'variant % needs a seed-owned item under an unauthored root', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END
$$;

-- The root-side twin: an authored root never sits on a seed-owned item. Like the variant rule it binds every writer,
-- because catalog_guard admits the seeder on a seed-owned item whoever the root's author is.
CREATE FUNCTION "food_authored_not_seed_owned"() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.food_item i WHERE i.id = NEW.item_id AND i.seed_owned) THEN
        RAISE EXCEPTION 'authored food % may not own a seed-owned item', NEW.id USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END
$$;

-- The ledger is insert-only for every role, the owner included (KTD-4).
CREATE FUNCTION "catalog_seed_ledger_insert_only"() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'catalog_seed_ledger is insert-only: % refused', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END
$$;

-- ── Triggers ─────────────────────────────────────────────────────────────────────────────────
-- A transition table needs one trigger per event, so each guarded table gets three.
DO $$
DECLARE
    guarded text;
BEGIN
    FOREACH guarded IN ARRAY ARRAY[
        'food_item', 'food', 'food_variant', 'food_variant_part', 'food_sources', 'food_field_provenance',
        'food_category_assignment', 'food_popularity', 'food_nutrition', 'food_nutrition_citation',
        'food_nutrition_value', 'food_portions'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows
                 FOR EACH STATEMENT EXECUTE FUNCTION catalog_guard()',
            guarded || '_guard_insert', guarded
        );
        EXECUTE format(
            'CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
                 FOR EACH STATEMENT EXECUTE FUNCTION catalog_guard()',
            guarded || '_guard_update', guarded
        );
        EXECUTE format(
            'CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows
                 FOR EACH STATEMENT EXECUTE FUNCTION catalog_guard()',
            guarded || '_guard_delete', guarded
        );
    END LOOP;
END
$$;

CREATE TRIGGER "food_forward_guard_insert" AFTER INSERT ON "food_forward" REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION food_forward_guard();
CREATE TRIGGER "food_forward_guard_update" AFTER UPDATE ON "food_forward"
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION food_forward_guard();
CREATE TRIGGER "food_forward_guard_delete" AFTER DELETE ON "food_forward" REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION food_forward_guard();

CREATE CONSTRAINT TRIGGER "food_retire_forwarded" AFTER UPDATE ON "food" DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.seed_key IS NULL AND OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL)
    EXECUTE FUNCTION food_retire_forwarded();

CREATE TRIGGER "food_item_immutable" BEFORE UPDATE ON "food_item" FOR EACH ROW EXECUTE FUNCTION catalog_immutable();
CREATE TRIGGER "food_immutable" BEFORE UPDATE ON "food" FOR EACH ROW EXECUTE FUNCTION catalog_immutable();
CREATE TRIGGER "food_nutrition_immutable" BEFORE UPDATE ON "food_nutrition" FOR EACH ROW
    EXECUTE FUNCTION catalog_immutable();

CREATE TRIGGER "food_variant_seed_only" AFTER INSERT OR UPDATE OF "food_id", "item_id" ON "food_variant"
    FOR EACH ROW EXECUTE FUNCTION food_variant_seed_only();
CREATE TRIGGER "food_authored_not_seed_owned" AFTER INSERT OR UPDATE OF "item_id", "user_id" ON "food"
    FOR EACH ROW WHEN (NEW.user_id IS NOT NULL) EXECUTE FUNCTION food_authored_not_seed_owned();

CREATE TRIGGER "food_nutrition_value_uncited_means_authored" AFTER INSERT OR UPDATE ON "food_nutrition_value"
    FOR EACH ROW EXECUTE FUNCTION catalog_uncited_means_authored();
CREATE TRIGGER "food_portions_uncited_means_authored" AFTER INSERT OR UPDATE ON "food_portions"
    FOR EACH ROW EXECUTE FUNCTION catalog_uncited_means_authored();

-- ⚠️ No TRUNCATE trigger: TRUNCATE is held by no login role but the owner, whose DDL can drop any trigger, and the
-- test harness empties every table with one owner TRUNCATE between cases.
CREATE TRIGGER "catalog_seed_ledger_insert_only" BEFORE UPDATE OR DELETE ON "catalog_seed_ledger"
    FOR EACH STATEMENT EXECUTE FUNCTION catalog_seed_ledger_insert_only();

-- ── The nutrient view: a Facade over the aggregate. It carries basis, trace and dataset through and decides
--    nothing (0006's rule stands: selection lives in src/foods/nutrition/nutrientSelection.ts) ─────────────
CREATE VIEW "food_nutrient_view" AS
SELECT h.food_id, h.food_variant_id, n.name AS nutrient, n.infoods_tag, n.unit, v.basis, v.amount, v.trace, c.dataset
  FROM food_nutrition h
  JOIN food_nutrition_value v ON v.nutrition_id = h.id
  JOIN nutrient n ON n.id = v.nutrient_id
  LEFT JOIN food_nutrition_citation c ON c.nutrition_id = v.nutrition_id AND c.id = v.citation_id;

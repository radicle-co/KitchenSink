/**
 * Drizzle table definitions for the source-agnostic canonical food store (feature 003, plan.md §2).
 *
 * A food is keyed by an internal ULID `id` (R1/FR-IDN-1) — NEVER a source-native key. Sources are
 * crosswalked in `food_sources`; nutrients/portions are normalized with per-value provenance; scalar
 * fields carry provenance in `food_field_provenance`. No raw source payload, no EAV, no
 * denormalized-nutrient / `fdc_id` / `fetch_status` columns.
 *
 * The hand-authored ordered SQL in `../migrations/0000_food_schema.sql` is the SOURCE OF TRUTH the
 * in-VPC runner applies (FU-MIGRATE); these definitions drive the ORM/query layer and MUST mirror it
 * exactly (every type, enum, constraint, and index).
 *
 * @implements FR-005 FR-008 FR-010 FR-013 FR-028 FR-029 FR-IDN-1 FR-IDN-3 SC-008 SC-013
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import {
    check,
    customType,
    foreignKey,
    index,
    numeric,
    pgEnum,
    pgTable,
    primaryKey,
    text,
    timestamp,
    unique,
    uniqueIndex,
    varchar,
} from 'drizzle-orm/pg-core';

/**
 * Postgres `tsvector` column type (drizzle-orm has no native `tsvector`). Backs the ranked full-text
 * search column (T-180); read-only in practice — it is a STORED generated column (see {@link food}).
 */
const tsvector = customType<{ data: string; driverData: string }>({
    dataType() {
        return 'tsvector';
    },
});

// ── Controlled enums (DB-7: domain-model controlled sets use pgEnum) ────────────────────────────

/** Food lifecycle status (FR-028 lifecycle R11/R13). */
export const foodStatusEnum = pgEnum('food_status', [
    'PENDING',
    'UNRESOLVED',
    'RESOLVED',
    'NOT_FOUND',
    'FAILED',
    // U9 — a real source failure has occurred and a retry is scheduled. Distinct from PENDING, which means
    // "queued, never attempted": a client can tell "we are retrying" from "we have not started", which is
    // the whole point of putting the state on the wire. Terminal only after the five-attempt budget, at
    // which point the food becomes FAILED.
    'AWAITING_RETRY',
]);

/** Generic vs branded food (FR-IDN-3; replaces the USDA data-type enum). */
export const foodKindEnum = pgEnum('food_kind', ['generic', 'branded']);

/** Source enum — additive; new sources append values (R3/FR-IDN-3). */
export const foodSourceEnum = pgEnum('food_source', ['usda']);

/** Scalar provenance field enum (R5) — no EAV value column. Additive; `aliases` arrived with 0007. */
export const foodFieldEnum = pgEnum('food_field', [
    'name',
    'description',
    'kind',
    'brand_owner',
    'brand_name',
    'barcode',
    'aliases',
]);

/** Nutrient amount basis; lives on the value row (FR-028/FR-MRG-3). */
export const nutrientBasisEnum = pgEnum('nutrient_basis', ['per_100g', 'per_serving']);

/**
 * Where a golden record's data came from (migration `0003_food_origin.sql`, ingredient-search plan §2
 * Stage 1 / F-C2). `live` = admitted through a source API and refreshed by the change-driven scan;
 * `bulk` = imported from the USDA bulk download and **excluded from the live change-refresh scan**
 * (`FoodSourcesDao.listResolvedBackingItems`), re-freshened from the next bulk file instead.
 *
 * This lives on `food` rather than `food_sources.fetch_state` on purpose: `fetch_state` is
 * CHECK-constrained to `fetched`/`error` AND rewritten by every `upsertSource`, so a marker there would
 * be clobbered on the next write.
 */
export const foodOriginEnum = pgEnum('food_origin', ['live', 'bulk']);

// ── food: the golden record (internal id PK) ────────────────────────────────────────────────────

/**
 * The golden record (FR-028). One row per logical food, keyed by an internal ULID `id`. Scalar
 * fields are merge winners (higher-priority source / longer-wins, FR-MRG-2); `normalized_name` is the
 * lowercased+trimmed dedup key (FR-005). `tombstoned_at` drives the NOT_FOUND TTL (FR-025).
 */
export const food = pgTable(
    'food',
    {
        id: text('id').primaryKey(),
        name: text('name'),
        normalizedName: text('normalized_name').notNull(),
        description: text('description'),
        kind: foodKindEnum('kind').notNull().default('generic'),
        brandOwner: text('brand_owner'),
        brandName: text('brand_name'),
        barcode: text('barcode'),
        // USDA's curated alternate names (brands, regional synonyms, alternate forms) flattened onto
        // `ALIAS_DELIMITER` by `foods/foodAliases.ts` (0007 migration, plan U2/KTD-2). NULL — never `''`
        // — when a food has none (GR-019). A single `text` rather than `text[]` because the vector below
        // is a STORED generated column and `array_to_string` is STABLE, not IMMUTABLE.
        aliases: text('aliases'),
        status: foodStatusEnum('status').notNull().default('PENDING'),
        // Data provenance class (0003 migration). Defaults to `live` so every pre-existing row — and
        // every future API-admitted food — stays in the live change-refresh scan; only the bulk seed
        // importer sets `bulk` (F-C2).
        origin: foodOriginEnum('origin').notNull().default('live'),
        /**
         * The AUTHOR's app-user ULID for a user-authored food (0013, plan U10/D8), or NULL for a catalog
         * row. This column IS the provenance marker (D9a: provenance is the route, never a wire field) —
         * an authored food also has NO `food_sources` crosswalk row, keeping it out of both refresh
         * scans structurally. Swept on erasure by `eraseFoodRows` (R24 — the coverage gate enforces it).
         */
        userId: varchar('user_id', { length: 255 }),
        /**
         * Q3c: author-PRIVATE until promoted. The 0013 CHECK (`food_visibility_coherent`) makes the
         * illegal states unrepresentable: catalog rows are exactly 'public'; authored rows are 'private'
         * or 'promoted', never 'public'.
         */
        visibility: text('visibility').notNull().default('public'),
        tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        // STORED generated tsvector over name + description for ranked full-text search (T-180, 0001
        // migration). Read-only (generated); the immutable two-arg to_tsvector form is required.
        searchVector: tsvector('search_vector').generatedAlwaysAs(
            sql`to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))`,
        ),
        // A SECOND STORED generated tsvector, over the aliases alone (0007 migration). Deliberately not
        // folded into `search_vector`: changing that column's expression needs PG 17's
        // `ALTER COLUMN ... SET EXPRESSION`, and the PG 16 equivalent is DROP + ADD COLUMN — an ACCESS
        // EXCLUSIVE lock, a rewrite of `food`, and `food_search_vector_idx` dropped with it. See 0007.
        //
        // ⚠️ THE CONSTRAINT ABOVE IS LIFTED. The engine moved to PostgreSQL 18 (plan U13), so
        // `ALTER COLUMN ... SET EXPRESSION` is now available and folding aliases into `search_vector` is no
        // longer gated on the engine. That does NOT make the fold automatically correct — `SET EXPRESSION`
        // still rewrites the table under ACCESS EXCLUSIVE, and the two-vector shape lets the ranker weight
        // an alias hit differently from a name hit, which is a ranking decision (U2/U5), not a schema one.
        // Recorded so nobody re-derives the old blocker and treats it as still binding.
        //
        // ⛔ Whatever shape wins, `STORED` stays EXPLICIT. PG 18 defaults an omitted keyword to VIRTUAL and
        // a virtual column cannot carry the GIN index this exists for; `generatedColumnStorage.test.ts`
        // fails any migration that omits it.
        aliasesSearchVector: tsvector('aliases_search_vector').generatedAlwaysAs(
            sql`to_tsvector('english', coalesce(aliases, ''))`,
        ),
        // ⛔ TWO MORE STORED generated columns (0008 migration, plan U5): the ranking terms the tier ladder
        // sorts on — the SQL mirror of `foldForRanking(name)` and `rankingTokens(name)` in
        // `@kitchensink/recipe-core/resolution/ranking-terms`. They are MATERIALIZED because computing them
        // per row measured 253ms (`broad`) and 357ms (`brand`) at 50,000 rows against SC-007's 200ms budget,
        // where reading them costs +0.8ms and +5.2ms.
        //
        // ⚠️ **`0008_food_rank_terms.sql` is authoritative**; these declarations exist so Drizzle knows the
        // columns and so a reader sees them here. The expressions are asserted against the TypeScript
        // reference, value by value, by `tests/rankingTerms.integration.test.ts` — which is the guard that
        // actually catches drift between the two implementations, in either direction.
        rankFolded: text('rank_folded').generatedAlwaysAs(
            sql`btrim(regexp_replace(regexp_replace(normalize(lower(name), NFD), '[\u0300-\u036f]', '', 'g'), '[ \t\n\r\f\v]+', ' ', 'g'), ' ')`,
        ),
        rankTokens: text('rank_tokens')
            .array()
            .generatedAlwaysAs(
                sql`array_remove(regexp_split_to_array(regexp_replace(regexp_replace(btrim(regexp_replace(regexp_replace(normalize(lower(name), NFD), '[\u0300-\u036f]', '', 'g'), '[ \t\n\r\f\v]+', ' ', 'g'), ' '), '([[:alnum:]]{2}(s|x|z|ch|sh))es(?![[:alnum:]])', '\1', 'g'), '([[:alnum:]]{2}(?!s)[[:alnum:]])s(?![[:alnum:]])', '\1', 'g'), '[^[:alnum:]]+'), '')`,
            ),
        /**
         * U1's head term — the SQL mirror of `describeRankingName(name).head` (migration 0011): the last
         * token of a multi-word first comma segment, else the first token. Supersedes `rankTokens[1]` as
         * the head; `rank_tokens_of()` is the immutable helper 0011 creates.
         */
        rankHead: text('rank_head').generatedAlwaysAs(
            sql`CASE WHEN position(',' in name) > 0 AND cardinality(rank_tokens_of(split_part(name, ',', 1))) > 1 THEN (rank_tokens_of(split_part(name, ',', 1)))[cardinality(rank_tokens_of(split_part(name, ',', 1)))] ELSE (rank_tokens_of(name))[1] END`,
        ),
    },
    (table) => [
        // 0013's dedup split (KTD-H): catalog-unique where unowned, per-author where owned — so two
        // authors may own one name, one author may not own it twice, and an authored name may SHADOW a
        // catalog name (ranking, not uniqueness, decides what a search shows).
        uniqueIndex('food_normalized_name_catalog_unique')
            .on(table.normalizedName)
            .where(sql`${table.userId} IS NULL`),
        uniqueIndex('food_normalized_name_per_author_unique')
            .on(table.normalizedName, table.userId)
            .where(sql`${table.userId} IS NOT NULL`),
        index('idx_food_user_id')
            .on(table.userId)
            .where(sql`${table.userId} IS NOT NULL`),
        index('food_status_idx').on(table.status),
        index('food_barcode_idx')
            .on(table.barcode)
            .where(sql`${table.barcode} IS NOT NULL`),
        // pg_trgm fuzzy/substring/partial search (FR-008/FR-010); the extension is bootstrapped by the migration.
        index('food_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
        index('food_description_trgm_idx').using('gin', sql`${table.description} gin_trgm_ops`),
        // GiST over the SAME column, for the `name % query` similarity branch only (T-202, 0004 migration).
        // Not a duplicate of the GIN index above and not interchangeable with it: GIN answers `%` by
        // admitting any row sharing ceil(0.3 x n_query_trigrams) trigrams — 9,758 candidates for 368 true
        // matches on a 50,000-food store, each costing a discarded `similarity()` recheck — while GiST
        // answers it with one candidate per match. GIN stays because it is the better answer for the
        // `ILIKE '%q%'` branches, which GiST can only serve by scanning its whole index. The planner picks
        // per branch. An index cannot change which rows match or their order (`%` is rechecked from the
        // heap), which is why this is a pure access-path change; see 0004 and
        // `tests/foodSearchAccessPath.integration.test.ts`.
        index('food_name_trgm_gist_idx').using('gist', sql`${table.name} gist_trgm_ops`),
        // Ranked full-text search (T-180): GIN over the generated tsvector (FR-008/FR-010).
        index('food_search_vector_idx').using('gin', table.searchVector),
        // The curated-alias vector's own GIN index (0007). Starts EMPTY — an alias-less row generates an
        // empty tsvector, which costs no index entries — and grows only as aliases are acquired.
        index('food_aliases_search_vector_idx').using('gin', table.aliasesSearchVector),
    ],
);

/** A `food` row as selected. */
export type FoodRow = InferSelectModel<typeof food>;
/** A `food` row for insert. */
export type NewFoodRow = InferInsertModel<typeof food>;

// ── food_sources: the crosswalk (NO raw payload) ─────────────────────────────────────────────────

/**
 * Cross-source crosswalk (R4/FR-028). One row per (source, item); `external_key` is that source's PK
 * (USDA: mapped from `fdcId` inside the adapter). `fetch_state` is an operational text+CHECK column
 * (DB-7), deliberately NOT a `pgEnum` — its set is operational mechanics that may evolve in place.
 * `UNIQUE(food_id, id)` is the composite target the per-value same-food provenance FKs reference
 * (D-PROVENANCE-FK).
 */
export const foodSources = pgTable(
    'food_sources',
    {
        id: text('id').primaryKey(),
        foodId: text('food_id')
            .notNull()
            .references(() => food.id, { onDelete: 'cascade' }),
        source: foodSourceEnum('source').notNull(),
        externalKey: text('external_key').notNull(),
        fetchState: text('fetch_state').notNull().default('fetched'),
        itemVersion: text('item_version'),
        fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        unique('food_sources_source_key_unique').on(table.source, table.externalKey),
        unique('food_sources_food_id_id_unique').on(table.foodId, table.id),
        check('food_sources_fetch_state_check', sql`${table.fetchState} IN ('fetched', 'error')`),
        index('food_sources_food_id_idx').on(table.foodId),
    ],
);

/** A `food_sources` row as selected. */
export type FoodSourceRow = InferSelectModel<typeof foodSources>;
/** A `food_sources` row for insert. */
export type NewFoodSourceRow = InferInsertModel<typeof foodSources>;

// ── nutrient: the dictionary (units live here, once) ─────────────────────────────────────────────

/**
 * Nutrient dictionary (R8/DB-5). A source nutrient resolves to a `nutrient_id` by `external_code`
 * when present, else by `(name, unit)`. `external_code` is a nullable stable anchor, so it cannot be
 * the sole dedup key (multiple NULLs are distinct in Postgres); the `(name, unit)` fallback unique
 * guarantees one dictionary row per nutrient even when no INFOODS tagname exists.
 */
export const nutrient = pgTable(
    'nutrient',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        unit: text('unit').notNull(),
        externalCode: text('external_code'),
    },
    (table) => [
        unique('nutrient_code_unique').on(table.externalCode),
        unique('nutrient_name_unit_unique').on(table.name, table.unit),
    ],
);

/** A `nutrient` row as selected. */
export type NutrientRow = InferSelectModel<typeof nutrient>;
/** A `nutrient` row for insert. */
export type NewNutrientRow = InferInsertModel<typeof nutrient>;

// ── food_nutrients: normalized values with per-value provenance ──────────────────────────────────

/**
 * Normalized golden nutrient values with per-value provenance (R5/FR-028). `amount` is arbitrary-
 * precision `numeric` (no scale) for full source fidelity (SC-008); `CHECK (amount >= 0)` (DB-6)
 * rejects a sign/parse error before it corrupts the record. `UNIQUE(food_id, nutrient_id)` keeps one
 * golden value per nutrient. The composite `(food_id, source_id)` FK to `food_sources(food_id, id)`
 * forces provenance to reference a crosswalk row of the SAME food, `ON DELETE NO ACTION` so a
 * food-level cascade still succeeds while a direct source-row delete that would orphan a value is
 * blocked (D-PROVENANCE-FK).
 */
export const foodNutrients = pgTable(
    'food_nutrients',
    {
        id: text('id').primaryKey(),
        foodId: text('food_id')
            .notNull()
            .references(() => food.id, { onDelete: 'cascade' }),
        nutrientId: text('nutrient_id')
            .notNull()
            .references(() => nutrient.id),
        amount: numeric('amount').notNull(),
        basis: nutrientBasisEnum('basis').notNull().default('per_100g'),
        // NULLABLE since 0013 (plan U10/KTD-H): NULL means "the food's AUTHOR wrote this value" — an
        // authored food has no crosswalk row to cite. The composite same-food FK is MATCH SIMPLE, so
        // enforcement skips NULL exactly as food_category_assignment's has since 0000.
        sourceId: text('source_id'),
    },
    (table) => [
        unique('food_nutrients_food_nutrient_unique').on(table.foodId, table.nutrientId),
        check('food_nutrients_amount_nonneg', sql`${table.amount} >= 0`),
        foreignKey({
            columns: [table.foodId, table.sourceId],
            foreignColumns: [foodSources.foodId, foodSources.id],
            name: 'food_nutrients_provenance_same_food_fk',
        }).onDelete('no action'),
        index('food_nutrients_food_id_idx').on(table.foodId),
        index('food_nutrients_source_id_idx').on(table.sourceId),
    ],
);

/** A `food_nutrients` row as selected. */
export type FoodNutrientRow = InferSelectModel<typeof foodNutrients>;
/** A `food_nutrients` row for insert. */
export type NewFoodNutrientRow = InferInsertModel<typeof foodNutrients>;

// ── food_portions: household measures / serving sizes ────────────────────────────────────────────

/**
 * Household measures / serving sizes with per-value provenance (R9). `gram_weight` is arbitrary-
 * precision `numeric`; `CHECK (gram_weight > 0)` (DB-6) keeps a portion weight strictly positive. The
 * composite same-food provenance FK matches `food_nutrients` (D-PROVENANCE-FK).
 */
export const foodPortions = pgTable(
    'food_portions',
    {
        id: text('id').primaryKey(),
        foodId: text('food_id')
            .notNull()
            .references(() => food.id, { onDelete: 'cascade' }),
        label: text('label').notNull(),
        gramWeight: numeric('gram_weight').notNull(),
        // NULLABLE since 0013 — see food_nutrients.sourceId above.
        sourceId: text('source_id'),
    },
    (table) => [
        check('food_portions_gram_weight_pos', sql`${table.gramWeight} > 0`),
        foreignKey({
            columns: [table.foodId, table.sourceId],
            foreignColumns: [foodSources.foodId, foodSources.id],
            name: 'food_portions_provenance_same_food_fk',
        }).onDelete('no action'),
        index('food_portions_food_id_idx').on(table.foodId),
    ],
);

/** A `food_portions` row as selected. */
export type FoodPortionRow = InferSelectModel<typeof foodPortions>;
/** A `food_portions` row for insert. */
export type NewFoodPortionRow = InferInsertModel<typeof foodPortions>;

// ── food_field_provenance: scalar-field provenance side-table ────────────────────────────────────

/**
 * Per-scalar-field provenance (R5) — one row per `(food_id, field)`, no EAV value column. The
 * composite same-food provenance FK matches the value tables (D-PROVENANCE-FK).
 */
export const foodFieldProvenance = pgTable(
    'food_field_provenance',
    {
        foodId: text('food_id')
            .notNull()
            .references(() => food.id, { onDelete: 'cascade' }),
        field: foodFieldEnum('field').notNull(),
        sourceId: text('source_id').notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.foodId, table.field] }),
        foreignKey({
            columns: [table.foodId, table.sourceId],
            foreignColumns: [foodSources.foodId, foodSources.id],
            name: 'food_field_provenance_same_food_fk',
        }).onDelete('no action'),
    ],
);

/** A `food_field_provenance` row as selected. */
export type FoodFieldProvenanceRow = InferSelectModel<typeof foodFieldProvenance>;
/** A `food_field_provenance` row for insert. */
export type NewFoodFieldProvenanceRow = InferInsertModel<typeof foodFieldProvenance>;

// ── food_category + assignment (many-to-many classification) ─────────────────────────────────────

/** Classification dictionary; one row per category name. */
export const foodCategory = pgTable(
    'food_category',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
    },
    (table) => [unique('food_category_name_unique').on(table.name)],
);

/** A `food_category` row as selected. */
export type FoodCategoryRow = InferSelectModel<typeof foodCategory>;
/** A `food_category` row for insert. */
export type NewFoodCategoryRow = InferInsertModel<typeof foodCategory>;

/**
 * Many-to-many food↔category classification with optional source provenance. `source_id` is nullable
 * — the composite same-food FK uses MATCH SIMPLE, so enforcement is skipped when `source_id` is NULL
 * (D-PROVENANCE-FK).
 */
export const foodCategoryAssignment = pgTable(
    'food_category_assignment',
    {
        foodId: text('food_id')
            .notNull()
            .references(() => food.id, { onDelete: 'cascade' }),
        categoryId: text('category_id')
            .notNull()
            .references(() => foodCategory.id, { onDelete: 'cascade' }),
        sourceId: text('source_id'),
    },
    (table) => [
        primaryKey({ columns: [table.foodId, table.categoryId] }),
        foreignKey({
            columns: [table.foodId, table.sourceId],
            foreignColumns: [foodSources.foodId, foodSources.id],
            name: 'food_category_assignment_same_food_fk',
        }).onDelete('no action'),
    ],
);

/** A `food_category_assignment` row as selected. */
export type FoodCategoryAssignmentRow = InferSelectModel<typeof foodCategoryAssignment>;
/** A `food_category_assignment` row for insert. */
export type NewFoodCategoryAssignmentRow = InferInsertModel<typeof foodCategoryAssignment>;

/**
 * The FNDDS/WWEIA consumption prior (plan U5, migration 0012). ⛔ A SIBLING table, never a `food` column
 * — golden scalars are merge-engine-owned. One writer: the operator-run `seed:fndds-prior` command; the
 * search ranking LEFT JOINs it (absent row = prior of zero).
 */
export const foodPopularity = pgTable('food_popularity', {
    foodId: text('food_id')
        .primaryKey()
        .references(() => food.id, { onDelete: 'cascade' }),
    /** Raw survey-weighted consumption weight (audit + re-normalization). */
    consumptionWeight: numeric('consumption_weight').notNull(),
    /** The fused fraction, normalized into [0, 1] at seed time. */
    priorFraction: numeric('prior_fraction').notNull(),
    /** The vintage/cycle the seed derived from. */
    source: text('source').notNull(),
    seededAt: timestamp('seeded_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FoodPopularityRow = InferSelectModel<typeof foodPopularity>;
export type NewFoodPopularityRow = InferInsertModel<typeof foodPopularity>;

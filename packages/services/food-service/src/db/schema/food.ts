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

/** Scalar provenance field enum (R5) — no EAV value column. */
export const foodFieldEnum = pgEnum('food_field', [
    'name',
    'description',
    'kind',
    'brand_owner',
    'brand_name',
    'barcode',
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
        status: foodStatusEnum('status').notNull().default('PENDING'),
        // Data provenance class (0003 migration). Defaults to `live` so every pre-existing row — and
        // every future API-admitted food — stays in the live change-refresh scan; only the bulk seed
        // importer sets `bulk` (F-C2).
        origin: foodOriginEnum('origin').notNull().default('live'),
        tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        // STORED generated tsvector over name + description for ranked full-text search (T-180, 0001
        // migration). Read-only (generated); the immutable two-arg to_tsvector form is required.
        searchVector: tsvector('search_vector').generatedAlwaysAs(
            sql`to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))`,
        ),
    },
    (table) => [
        uniqueIndex('food_normalized_name_unique').on(table.normalizedName),
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
        sourceId: text('source_id').notNull(),
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
        sourceId: text('source_id').notNull(),
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

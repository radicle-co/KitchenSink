/**
 * Drizzle table definitions for the source-agnostic canonical food store (feature 003, plan.md §2).
 *
 * A food is keyed by an internal ULID `id` (R1/FR-IDN-1) — NEVER a source-native key. Since 0018 a food is a
 * ROOT: it owns one `food_item`, and the per-item tables (`catalogItems.ts`) and its nutrition
 * (`foodNutrition.ts`) attach there. No raw source payload, no EAV, no denormalized-nutrient / `fdc_id` /
 * `fetch_status` columns.
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
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';

import { REGISTERED_SOURCE_IDS } from '../../sources/sourceRegister.js';

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
    // U18's tombstone-first refusal window — see 0014.
    'DELETING',
    // The voluntary delete's SOFT tombstone (0016; owner rulings 5 + 6, 2026-09-07). Distinct from
    // `DELETING` in every way that matters: it is PUBLISHED (a reader must be able to learn a food was
    // removed), it is TERMINAL (`DELETING` reverts to RESOLVED mid-erasure), and it is reached only by an
    // author's own DELETE. See 0016's header for the full argument.
    'WITHDRAWN',
]);

/** Generic vs branded food (FR-IDN-3; replaces the USDA data-type enum). */
export const foodKindEnum = pgEnum('food_kind', ['generic', 'branded']);

/** Source enum: every registered source id, in register order (0018, plan U4, R52). */
export const foodSourceEnum = pgEnum('food_source', REGISTERED_SOURCE_IDS);

/** Which kind of owner holds an item (0018, KTD-6): the subtype discriminator of the item's one owner. */
export const foodItemOwnerKindEnum = pgEnum('food_item_owner_kind', ['root', 'variant']);

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
        /**
         * The root's item (0018, KTD-6): the unit its source rows, portions, provenance, categories and
         * popularity attach to. Every root owns exactly one item, retired or not. The composite foreign key
         * `(item_id, item_owner_kind) → food_item (id, owner_kind)` lives in 0018 only: declaring it here
         * would make this module and `catalogItems.ts` import each other.
         */
        itemId: text('item_id').notNull(),
        /** The subtype discriminator the composite key matches; always `root` (CHECK in 0018). */
        itemOwnerKind: foodItemOwnerKindEnum('item_owner_kind').notNull().default('root'),
        /**
         * The seed key of a seeded root (`fdc:<id>` or `curated:<slug>`), frozen at its first commit (KTD-8);
         * NULL for a live or authored food. Immutable after insert.
         */
        seedKey: text('seed_key'),
        /** When the seed, or a live retirement with a forward, retired this root (KTD-8). NULL while live. */
        retiredAt: timestamp('retired_at', { withTimezone: true }),
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
        /**
         * WHEN the author withdrew this food (0017). NULL for every food that has not been withdrawn.
         *
         * ⛔ Deliberately NOT `tombstoned_at`, which anchors `createByName`'s NOT_FOUND TTL reactivation —
         * reusing it would make a withdrawal indistinguishable from an expired lookup. A status carries the
         * fact and not the date, and the ruling that retains the row wants to tell a cook WHAT was removed;
         * it is also the only thing that makes the future sweep implementable without guessing.
         */
        withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
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
            .where(sql`${table.userId} IS NULL AND ${table.retiredAt} IS NULL`),
        unique('food_item_id_unique').on(table.itemId),
        unique('food_seed_key_unique').on(table.seedKey),
        check('food_item_owner_kind_root', sql`${table.itemOwnerKind} = 'root'`),
        check('food_seed_key_not_authored', sql`${table.seedKey} IS NULL OR ${table.userId} IS NULL`),
        check('food_retired_not_authored', sql`${table.retiredAt} IS NULL OR ${table.userId} IS NULL`),
        // ⛔ STATUS-AWARE since 0017. Without the `WITHDRAWN` exclusion the retained tombstone would block
        // the author re-adding a food under the same name — "delete it and add it again" answering 409
        // DUPLICATE_AUTHORED_NAME forever, which is the user-visible regression the soft delete creates.
        uniqueIndex('food_normalized_name_per_author_unique')
            .on(table.normalizedName, table.userId)
            .where(sql`${table.userId} IS NOT NULL AND ${table.status} <> 'WITHDRAWN'`),
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

// ── nutrient: the dictionary (units live here, once) ─────────────────────────────────────────────

/**
 * Nutrient dictionary (R8/DB-5, KTD-23): one entry per definition. A value resolves by its INFOODS tag when
 * it has one, else by `(name, unit)`; the tag is nullable (USDA's two Atwater energies have none), so the
 * `(name, unit)` unique still guarantees one row per nutrient. A shared dictionary (KTD-14): the seeder and
 * the service insert missing entries and neither updates nor deletes one.
 */
export const nutrient = pgTable(
    'nutrient',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        unit: text('unit').notNull(),
        infoodsTag: text('infoods_tag'),
    },
    (table) => [
        unique('nutrient_infoods_tag_unique').on(table.infoodsTag),
        check('nutrient_infoods_tag_format', sql`${table.infoodsTag} ~ '^[A-Z][A-Z0-9_]*$'`),
        unique('nutrient_name_unit_unique').on(table.name, table.unit),
    ],
);

/** A `nutrient` row as selected. */
export type NutrientRow = InferSelectModel<typeof nutrient>;
/** A `nutrient` row for insert. */
export type NewNutrientRow = InferInsertModel<typeof nutrient>;

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
 * U18 (0014): the authored-food version history — the recipe versioning pattern's TABLE half only (the
 * S3 archive half is deliberately deferred; see the migration header). `created_by` is NULLABLE because
 * the erasure sweep NULLs it on KEPT foods — the history survives as other users' recourse, the
 * attribution does not.
 */
export const foodVersions = pgTable(
    'food_versions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        foodId: text('food_id')
            .notNull()
            .references(() => food.id, { onDelete: 'cascade' }),
        versionNumber: integer('version_number').notNull(),
        /** That version's content: { name, description, macros, portions }. */
        snapshot: jsonb('snapshot').notNull(),
        createdBy: varchar('created_by', { length: 255 }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        unique('food_versions_food_version_unique').on(table.foodId, table.versionNumber),
        index('idx_food_versions_food').on(table.foodId),
        index('idx_food_versions_created_by')
            .on(table.createdBy)
            .where(sql`${table.createdBy} IS NOT NULL`),
    ],
);

/**
 * U12 (0015): the promotion MODERATION QUEUE — corroboration is the TRIGGER, never the PUBLISHER
 * (owner ruling 2026-08-30). A pending row is a candidacy awaiting a human; approval elects
 * `canonical_food_id` and publishes; a rejected row's `data_fingerprint` bars identical resubmission.
 * No person columns by design — contributing AUTHORS are derivable by join, and the operator's identity
 * reaches the audit log only (the `requeue` precedent), so this table stays out of the erasure sweep.
 */
export const foodPromotions = pgTable(
    'food_promotions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        normalizedName: text('normalized_name').notNull(),
        /** The compatible contributing food ids, ordered by id — one policy evaluation, one unit. */
        candidateFoodIds: jsonb('candidate_food_ids').notNull(),
        dataFingerprint: varchar('data_fingerprint', { length: 64 }).notNull(),
        status: text('status').notNull().default('pending'),
        canonicalFoodId: text('canonical_food_id'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        decidedAt: timestamp('decided_at', { withTimezone: true }),
    },
    (table) => [
        uniqueIndex('food_promotions_pending_name_unique')
            .on(table.normalizedName)
            .where(sql`${table.status} = 'pending'`),
        index('idx_food_promotions_name').on(table.normalizedName),
    ],
);

export type FoodPromotionRow = InferSelectModel<typeof foodPromotions>;

export type FoodVersionRow = InferSelectModel<typeof foodVersions>;
export type NewFoodVersionRow = InferInsertModel<typeof foodVersions>;

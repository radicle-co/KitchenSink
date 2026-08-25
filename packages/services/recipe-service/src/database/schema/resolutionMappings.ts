/**
 * Drizzle definitions for the ingredient-resolution knowledge base (plan U10, migration 0021).
 *
 * Two tables, because a curated mapping and a machine-derived one change for different reasons:
 *
 *  - `ingredient_resolution_mappings` — HUMAN-authored (R19/R20). Its reach is an authorization decision
 *    (`ingredients/domain/mappingScopePolicy.ts`), it is supersedable, and its HISTORY IS THE AUDIT TRAIL: a
 *    `corroboration` row cites the two author mappings that produced it, which is what makes every promotion
 *    enumerable by `SELECT` rather than only by a log line inside a retention window.
 *  - `ingredient_resolution_memos` — MACHINE-derived. No scope and no author, because nobody asserted it;
 *    what it carries instead is the identifier of the model that AGREED with it (R21).
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0021_resolution_mappings.sql` is the SOURCE OF TRUTH
 * (repo convention — the in-VPC runner applies those files in filename order). These definitions drive the
 * query layer and document the same final shape. Read that file for the reasoning behind every constraint and
 * index; the partial unique indexes in particular are load-bearing CONCURRENCY CONTROLS, not optimisations,
 * and the CHECKs are what make a global mapping with no justification unrepresentable.
 *
 * ⛔ `food_id` is an OPAQUE cross-service reference to the food service's internal ULID, exactly as
 * `ingredients.food_id` is: NEVER a USDA `fdcId`, NOT a cross-DB FK, and it MAY DANGLE — U12's reseed mints
 * fresh ULIDs. Every reader treats an unresolvable mapping as a MISS and falls through, never as an error.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import {
    MAPPING_ORIGINS,
    MAPPING_SCOPES,
    type MappingOrigin,
    type MappingScope,
} from '../../ingredients/domain/mappingScopePolicy.js';

/**
 * The controlled value sets, tied to the authoritative policy unions with `satisfies` — so a column's CHECK
 * constraint and the pure policy's union cannot drift apart without a compile error (the S-R5 convention
 * `FOOD_RESOLUTION_STATUSES` already follows).
 */
export const RESOLUTION_MAPPING_SCOPES = MAPPING_SCOPES satisfies readonly MappingScope[];

/** The controlled `origin` value set — on whose authority a mapping holds. */
export const RESOLUTION_MAPPING_ORIGINS = MAPPING_ORIGINS satisfies readonly MappingOrigin[];

export const ingredientResolutionMappings = pgTable(
    'ingredient_resolution_mappings',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        /** The match grain — `normalizedIngredientKey`. NOT a display name. */
        normalizedKey: text('normalized_key').notNull(),
        /**
         * The raw phrase the key was derived FROM — what makes the key derivation a two-way door, since a
         * change to that function is then a backfill rather than data loss.
         *
         * ⛔ It moves as a PAIR with {@link ingredientResolutionMappings.authorId}, and migration 0031 makes
         * that a CONSTRAINT rather than a convention. NULL for an erased author AND for a `corroboration`
         * binding, which copies nobody's words: a phrase on a row with no author is unreachable by the
         * erasure sweep's `WHERE author_id = $owner`, so it would outlive the erasure it should have honoured.
         */
        sourcePhrase: text('source_phrase'),
        /** Opaque food-service golden-record id. May dangle after a reseed; readers fall through. */
        foodId: text('food_id').notNull(),
        /** How far this mapping reaches: `author` binds only its writer, `global` binds every user. */
        scope: text('scope').notNull(),
        /** On whose authority it holds: its writer alone, a grant holder, or two authors agreeing. */
        origin: text('origin').notNull(),
        /**
         * The app-user ULID that wrote it (R20). NULL for a corroboration binding — nobody wrote it, two
         * people's agreement produced it — and for an erased author. Either way, migration 0031 requires
         * {@link ingredientResolutionMappings.sourcePhrase} to be NULL with it.
         */
        authorId: varchar('author_id', { length: 255 }),
        /** Which affordance produced the correction (R20). Free text: a new surface must never fail a write. */
        surfacing: text('surfacing').notNull(),
        /** First of the two author mappings whose agreement produced a corroboration binding. */
        corroboratedA: uuid('corroborated_a'),
        /** Second of the two. Both are set exactly when `origin` is `corroboration`. */
        corroboratedB: uuid('corroborated_b'),
        /** When this mapping stopped being in force. NULL means LIVE — the predicate every index uses. */
        supersededAt: timestamp('superseded_at', { withTimezone: true }),
        /** The mapping that replaced it, or NULL when it was retired with no replacement (erasure). */
        supersededBy: uuid('superseded_by'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('ingredient_resolution_mappings_scope_check', sql`${table.scope} IN ('author', 'global')`),
        check(
            'ingredient_resolution_mappings_origin_check',
            sql`${table.origin} IN ('author', 'curator', 'corroboration')`,
        ),
        check(
            'ingredient_resolution_mappings_scope_origin_agree',
            sql`(${table.scope} = 'author') = (${table.origin} = 'author')`,
        ),
        // ⛔ A GLOBAL MAPPING WITH NO JUSTIFICATION IS UNREPRESENTABLE.
        check(
            'ingredient_resolution_mappings_corroboration_cites_both',
            sql`(${table.origin} = 'corroboration') = (${table.corroboratedA} IS NOT NULL AND ${table.corroboratedB} IS NOT NULL)`,
        ),
        // ⚠️ The `IS NULL` disjunct is REQUIRED: `NULL IS DISTINCT FROM NULL` is FALSE, so without it this
        // constraint rejects every ordinary row.
        check(
            'ingredient_resolution_mappings_corroboration_distinct',
            sql`${table.corroboratedA} IS NULL OR ${table.corroboratedA} IS DISTINCT FROM ${table.corroboratedB}`,
        ),
        check(
            'ingredient_resolution_mappings_supersession_coherent',
            sql`${table.supersededBy} IS NULL OR ${table.supersededAt} IS NOT NULL`,
        ),
        check(
            'ingredient_resolution_mappings_supersession_forward',
            sql`${table.supersededBy} IS DISTINCT FROM ${table.id}`,
        ),
        // ⛔ THE PAIR INVARIANT (migration 0031). A typed phrase and the person it belongs to exist together
        // or not at all. It makes two states unrepresentable rather than merely discouraged: a phrase on a
        // row nothing can point erasure at (which is how a corroboration binding kept a cook's words
        // forever), and a half-run sweep leaving a previous author's id beside somebody else's wording.
        check(
            'ingredient_resolution_mappings_phrase_needs_owner',
            sql`(${table.authorId} IS NULL) = (${table.sourcePhrase} IS NULL)`,
        ),
        // ⛔ THE CORROBORATION COUNTER. A count of live author-scoped rows for a phrase equals a count of
        // DISTINCT AUTHORS only because this index makes a second live row from one author impossible.
        uniqueIndex('idx_resolution_mappings_live_author')
            .on(table.normalizedKey, table.authorId)
            .where(sql`${table.scope} = 'author' AND ${table.supersededAt} IS NULL AND ${table.authorId} IS NOT NULL`),
        // ⛔ Tier 1 must be deterministic. Enforcing this here is what makes supersession the ONLY way a global
        // mapping can be replaced — and therefore what makes the scope policy's supersession gate unbypassable.
        uniqueIndex('idx_resolution_mappings_live_global')
            .on(table.normalizedKey)
            .where(sql`${table.scope} = 'global' AND ${table.supersededAt} IS NULL`),
        // Makes the concurrent-promotion race safe with an ordinary `ON CONFLICT DO NOTHING`: the loser gets
        // zero rows, which reads as "somebody else already promoted this", never as an error.
        uniqueIndex('idx_resolution_mappings_corroboration_pair')
            .on(table.corroboratedA, table.corroboratedB)
            .where(sql`${table.origin} = 'corroboration'`),
        index('idx_resolution_mappings_live_lookup')
            .on(table.normalizedKey, table.foodId)
            .where(sql`${table.supersededAt} IS NULL`),
        index('idx_resolution_mappings_author')
            .on(table.authorId)
            .where(sql`${table.authorId} IS NOT NULL`),
    ],
);

/** An `ingredient_resolution_mappings` row as selected. */
export type IngredientResolutionMappingRow = InferSelectModel<typeof ingredientResolutionMappings>;
/** An `ingredient_resolution_mappings` row for insert. */
export type NewIngredientResolutionMappingRow = InferInsertModel<typeof ingredientResolutionMappings>;

export const ingredientResolutionMemos = pgTable(
    'ingredient_resolution_memos',
    {
        /** The key IS the identity: one remembered resolution per phrase. */
        normalizedKey: text('normalized_key').primaryKey(),
        foodId: text('food_id').notNull(),
        /**
         * The phrase the key was derived from. ⚠️ NULLABLE since migration 0026: account erasure nulls it,
         * along with {@link ingredientResolutionMemos.ownerId}, for the user who typed it.
         *
         * ⛔ Since migration 0031 the pairing is a CONSTRAINT: a memo whose owner is unknown records the
         * machine's conclusion and NO phrase, because a phrase nothing can point erasure at outlives the
         * erasure it should have honoured.
         */
        sourcePhrase: text('source_phrase'),
        /**
         * R21 — the identifier of the model that AGREED with this resolution. ⛔ A memo exists ONLY for a
         * resolution the verification gate agreed with; this column is that agreement's record, so a writer
         * with no model identifier to record is a writer with no agreement to record.
         */
        verifiedBy: text('verified_by').notNull(),
        /**
         * Who owns the recipe whose line most recently produced this memo (migration 0026, owner ruling
         * 2026-08-23) — present SOLELY so account erasure has a predicate to sweep on.
         *
         * ⛔ It moves as a PAIR with `sourcePhrase`, in the writer's upsert and in the erasure sweep alike.
         * The table is keyed on the normalized phrase, so two users whose lines normalize alike share one
         * row; a write that replaced the phrase but not the owner would point erasure at the wrong person.
         *
         * ⚠️ NULL means one of two things and neither is an error: the memo came from a producer that
         * predates the field, or the owner has been erased. Both leave the machine's conclusion — `foodId`
         * and `verifiedBy` — intact and readable, which is the point.
         */
        ownerId: text('owner_id'),
        verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        // ⛔ THE NEAREST-NEIGHBOUR SEARCH (R14 forbids equality-only matching). GiST — not GIN — because only
        // the GiST trigram operator class supports the `<->` distance operator a k-NN scan orders by.
        index('idx_resolution_memos_key_trgm').using('gist', sql`${table.normalizedKey} gist_trgm_ops`),
        // Partial, mirroring the mappings tier's author index: the sweep's predicate is `owner_id = $1`, and
        // a de-identified row is NULL forever after, so indexing the NULLs would index the table's eventual
        // majority for a query that can never match them.
        index('idx_resolution_memos_owner')
            .on(table.ownerId)
            .where(sql`${table.ownerId} IS NOT NULL`),
        // ⛔ THE PAIR INVARIANT (migration 0031), the mappings tier's constraint one tier down. The table is
        // keyed on the phrase alone, so two cooks share ONE row and the upsert must move the phrase and the
        // owner link together — this is what makes "together" a fact the database enforces.
        check(
            'ingredient_resolution_memos_phrase_needs_owner',
            sql`(${table.ownerId} IS NULL) = (${table.sourcePhrase} IS NULL)`,
        ),
    ],
);

/** An `ingredient_resolution_memos` row as selected. */
export type IngredientResolutionMemoRow = InferSelectModel<typeof ingredientResolutionMemos>;
/** An `ingredient_resolution_memos` row for insert. */
export type NewIngredientResolutionMemoRow = InferInsertModel<typeof ingredientResolutionMemos>;

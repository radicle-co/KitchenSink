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
         * ⚠️ **NOT personal data** (owner ruling 2026-08-25, ADR-0027). It is not erasable, no sweep targets
         * it, and migration 0033 repealed the CHECK that tied it to a person. NULLABLE because a
         * `corroboration` binding copies nobody's words — not because anything clears it. That copy stays
         * un-written on the surviving half of 0031's argument: the binding CITES two rows that each carry
         * their own phrase, so the two-way-door backfill runs through `corroboratedA` either way.
         */
        sourcePhrase: text('source_phrase'),
        /** Opaque food-service golden-record id. May dangle after a reseed; readers fall through. */
        foodId: text('food_id').notNull(),
        /** How far this mapping reaches: `author` binds only its writer, `global` binds every user. */
        scope: text('scope').notNull(),
        /** On whose authority it holds: its writer alone, a grant holder, or two authors agreeing. */
        origin: text('origin').notNull(),
        /**
         * The app-user ULID whose correction this is (R20).
         *
         * ⛔ **A COUNTER AND AN AUTHORIZATION PREDICATE, never an erasure predicate** (owner ruling
         * 2026-08-25, ADR-0027). It is how the installation counts how many DISTINCT people made the same
         * correction — the corroboration signal that promotes one from personal to global — and it is two of
         * the three `WHERE` clauses that ARE the authorization in `resolutionMappings.dal.ts`.
         *
         * Spelled `user_id` since migration 0033: `author_id`/`owner_id` were two names for one concept, and
         * GR-004 fixes the canonical spelling. `scope`/`origin` keep their `'author'` value, which names a
         * REACH rather than a person.
         *
         * ⚠️ NULLABLE, and it must stay so: a `corroboration` binding has no user, because nobody wrote it —
         * two people's agreement produced it.
         */
        userId: varchar('user_id', { length: 255 }),
        /** Which affordance produced the correction (R20). Free text: a new surface must never fail a write. */
        surfacing: text('surfacing').notNull(),
        /** First of the two author mappings whose agreement produced a corroboration binding. */
        corroboratedA: uuid('corroborated_a'),
        /** Second of the two. Both are set exactly when `origin` is `corroboration`. */
        corroboratedB: uuid('corroborated_b'),
        /** When this mapping stopped being in force. NULL means LIVE — the predicate every index uses. */
        supersededAt: timestamp('superseded_at', { withTimezone: true }),
        /** The mapping that replaced it, or NULL when it was retired with no replacement. */
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
        // ⛔ THE CORROBORATION COUNTER, and ⚠️ DELIBERATE — see
        // `docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md`. A count of live
        // author-scoped rows for a phrase equals a count of DISTINCT USERS only because this index makes a
        // second live row from one user impossible. It is the reason `userId` is retained at all, so it is
        // the last thing to "clean up" alongside an erasure change.
        //
        // ⛔ Migration 0031's `…_phrase_needs_owner` CHECK stood here and was REPEALED by 0033: a phrase is
        // not personal data, so it needs nobody beside it for a sweep to key on. Do not restore it.
        uniqueIndex('idx_resolution_mappings_live_user')
            .on(table.normalizedKey, table.userId)
            .where(sql`${table.scope} = 'author' AND ${table.supersededAt} IS NULL AND ${table.userId} IS NOT NULL`),
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
        // ⚠️ `idx_resolution_mappings_author` stood here and was dropped by migration 0033. It existed ONLY
        // to make the erasure sweep's `WHERE author_id = $owner` fast; with no sweep it was write
        // amplification on every correction for a query nobody issues. No read path filters on the person
        // column alone — the write path's own-row lookup uses the composite unique index above.
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
         * The phrase the key was derived from.
         *
         * ⚠️ **NOT personal data** (owner ruling 2026-08-25, ADR-0027), and nothing on this row identifies
         * anybody: migration 0033 removed `owner_id`, which 0026 had added solely so an erasure sweep had a
         * predicate to key on. What survives is the machine's conclusion plus the words it judged.
         *
         * ⚠️ Still NULLABLE, and it stays that way. 0026 dropped its `NOT NULL` for the sweep, and restoring
         * it now would fail on every database 0031 already ran against — that migration backfilled this
         * column to NULL on every ownerless memo, and said outright the phrases were not recoverable.
         */
        sourcePhrase: text('source_phrase'),
        /**
         * R21 — the identifier of the model that AGREED with this resolution. ⛔ A memo exists ONLY for a
         * resolution the verification gate agreed with; this column is that agreement's record, so a writer
         * with no model identifier to record is a writer with no agreement to record.
         */
        verifiedBy: text('verified_by').notNull(),
        verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        // ⛔ THE NEAREST-NEIGHBOUR SEARCH (R14 forbids equality-only matching). GiST — not GIN — because only
        // the GiST trigram operator class supports the `<->` distance operator a k-NN scan orders by.
        index('idx_resolution_memos_key_trgm').using('gist', sql`${table.normalizedKey} gist_trgm_ops`),
        // ⚠️ `owner_id`, its partial index and 0031's pair CHECK all stood here and were removed by migration
        // 0033. ⛔ A memo is the MODEL's conclusion, not anybody's correction — there is no distinct-user
        // count to keep here, which is why this tier loses the column outright where the two correction
        // tiers rename theirs. See `docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md`.
    ],
);

/** An `ingredient_resolution_memos` row as selected. */
export type IngredientResolutionMemoRow = InferSelectModel<typeof ingredientResolutionMemos>;
/** An `ingredient_resolution_memos` row for insert. */
export type NewIngredientResolutionMemoRow = InferInsertModel<typeof ingredientResolutionMemos>;

/**
 * Drizzle mirror of `unresolved_foods` — what the cascade CONCLUDED when it could not resolve a phrase.
 *
 * ⚠️ `0051_ingredient_grain.sql` is AUTHORITATIVE. This declaration exists so drizzle knows the columns and
 * so `drizzle(pool, { schema })` can address the table; where the two disagree the SQL wins, and
 * `schemaModelConformance.integration.test.ts` is what makes a disagreement fail rather than drift.
 *
 * The vocabulary (`UNRESOLVED_FOOD_REASON_CODES`, `UNRESOLVED_FOOD_STATUSES`) is recipe-core's, because the
 * recipe wire carries a line's reason code too (plan 002 U2).
 *
 * ⛔ `RESOLVED` IS ABSENT FROM THE STATUSES BY CONSTRUCTION. A resolved binding points
 * at a `food_id` and has no row in this table at all, so a `RESOLVED` row here would record a failure that
 * succeeded. The predecessor column, `ingredients.food_resolution_status`, could hold exactly that beside a
 * NULL `food_id` — one of the three illegal states 0051 removed.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const unresolvedFoods = pgTable(
    'unresolved_foods',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        /**
         * The food name that FAILED to resolve — the unresolved arm's whole contribution to a line's
         * display name, and why `food_lookups` needs no name of its own.
         */
        name: text('name').notNull(),
        /**
         * The raw phrase {@link unresolvedFoods.name} was lifted from.
         *
         * ⚠️ Deliberately DUPLICATED with `ingredients.source_phrase`, which is a different GRAIN rather
         * than a copy: the line's is what THIS cook wrote, this one is what the SHARED record stands for.
         */
        sourcePhrase: text('source_phrase'),
        /** What lines converge on — see the partial unique index below for the arm that must NOT converge. */
        normalizedKey: text('normalized_key').notNull(),
        reasonCode: text('reason_code').notNull(),
        /**
         * ⛔ GENERATED from {@link unresolvedFoods.reasonCode}, so the two can never disagree and no writer
         * computes it. Read it; never write it. `RESOLVED` is in no branch, by construction. The CASE is also
         * the one statement of the closed reason set: an unknown reason generates NULL and NOT NULL refuses it.
         */
        status: text('status')
            .notNull()
            .generatedAlwaysAs(
                sql`CASE reason_code
                        WHEN 'awaiting_source' THEN 'PENDING'
                        WHEN 'several_candidates' THEN 'UNRESOLVED'
                        WHEN 'author_declared' THEN 'UNRESOLVED'
                        WHEN 'no_source_has_it' THEN 'NOT_FOUND'
                        WHEN 'cascade_exhausted' THEN 'NOT_FOUND'
                        WHEN 'phrase_unusable' THEN 'NOT_FOUND'
                        WHEN 'sources_errored' THEN 'FAILED'
                        WHEN 'cascade_unavailable' THEN 'FAILED'
                    END`,
            ),
        /**
         * The food service's opaque id for the food it is still working on. Present exactly for the
         * `awaiting_source` and `several_candidates` reasons: the poll follows it, and only food-service's
         * answer about it may free the lines that converged here.
         */
        foodHandleId: text('food_handle_id'),
        tiersConsulted: text('tiers_consulted')
            .array()
            .notNull()
            .default(sql`'{}'`),
        tiersUnavailable: text('tiers_unavailable')
            .array()
            .notNull()
            .default(sql`'{}'`),
        /**
         * ⛔ OPERATOR-ONLY free text about one attempt, at most 500 characters. NEVER on the wire, and the
         * service's repository never selects it (plan 002 R5).
         */
        detail: text('detail'),
        attempts: integer('attempts').notNull().default(1),
        firstAttemptedAt: timestamp('first_attempted_at', { withTimezone: true }).notNull().defaultNow(),
        lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }).notNull().defaultNow(),
        /**
         * The binding a food-service answer settled this failure to (plan 002 R13). NULL while the failure
         * stands. The line planner forwards a line that still names this failure to it, because a settle mints no
         * recipe version. Its foreign key to `food_lookups` is declared in the SQL only: the two tables
         * reference each other, and the mirror keeps one direction.
         */
        settledLookupId: uuid('settled_lookup_id'),
    },
    (table) => [
        // ⛔ `cardinality`, NOT `array_length(..., 1)`: the latter answers NULL for an empty array and a
        // CHECK is satisfied when it evaluates to NULL, so the obvious spelling admits the very row this
        // refuses — a `cascade_unavailable` naming no unavailable tier. Migration 0023's header records the
        // same trap.
        check(
            'unresolved_foods_unavailable_names_a_tier',
            sql`${table.reasonCode} <> 'cascade_unavailable' OR cardinality(${table.tiersUnavailable}) >= 1`,
        ),
        // ⛔ Two more states that contradict the row's own existence — the test every CHECK on this table
        // applies. A row exists BECAUSE an attempt was made, so it had at least one, and it cannot have
        // last been attempted before it was first attempted.
        check('unresolved_foods_attempts_positive', sql`${table.attempts} >= 1`),
        check('unresolved_foods_attempt_window_coherent', sql`${table.lastAttemptedAt} >= ${table.firstAttemptedAt}`),
        // The handle exists exactly when food-service is still working on the food.
        check(
            'unresolved_foods_handle_follows_reason',
            sql`(${table.foodHandleId} IS NOT NULL) = (${table.reasonCode} IN ('awaiting_source', 'several_candidates'))`,
        ),
        // Tiers named are links of THIS cascade, and a tier was unavailable only if it was consulted.
        check(
            'unresolved_foods_tiers_known',
            sql`${table.tiersConsulted} <@ ARRAY['curated', 'memo', 'lexical']::text[] AND ${table.tiersUnavailable} <@ ${table.tiersConsulted}`,
        ),
        check('unresolved_foods_detail_bounded', sql`${table.detail} IS NULL OR char_length(${table.detail}) <= 500`),
        // A declaration is not a lookup that can later succeed, so nothing ever settles one.
        check(
            'unresolved_foods_declaration_never_settles',
            sql`${table.settledLookupId} IS NULL OR ${table.reasonCode} <> 'author_declared'`,
        ),
        // ⛔ THE ASYMMETRY. A real lookup FAILURE is a shared fact about a phrase, so lines converge on one
        // row and ONE later resolution frees all of them. A cook's DECLARED name is the opposite: two cooks
        // writing "grandma's spice mix" do not mean the same substance, and deduping them would merge one
        // person's ingredient into another's. Dropping the `WHERE` reads as a tightening and is a
        // data-corruption bug; `tests/e2e/ingredientGrain.e2e.test.ts` asserts both directions.
        uniqueIndex('unresolved_foods_shared_failure_key_idx')
            .on(table.normalizedKey)
            .where(sql`${table.reasonCode} <> 'author_declared'`),
        // The retry sweep's read. Declarations are excluded (they are not lookups that can later succeed), and so
        // are settled failures (food answered them).
        index('unresolved_foods_status_attempted_idx')
            .on(table.status, table.lastAttemptedAt)
            .where(sql`${table.reasonCode} <> 'author_declared' AND ${table.settledLookupId} IS NULL`),
    ],
);

/** An `unresolved_foods` row as selected. */
export type UnresolvedFoodRow = InferSelectModel<typeof unresolvedFoods>;
/** An `unresolved_foods` row for insert. */
export type NewUnresolvedFoodRow = InferInsertModel<typeof unresolvedFoods>;

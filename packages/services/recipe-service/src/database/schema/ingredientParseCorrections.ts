/**
 * Drizzle definitions for the parse-correction tier (plan U21, migration 0029).
 *
 * A cook's correction of how an ingredient LINE reads — the parse pipeline's TOP tier, consulted ahead of
 * the parse cache and ahead of both engines, because a correction that lost to a cached machine parse would
 * be a correction that does nothing.
 *
 * Deliberately shaped as the sibling of `ingredient_resolution_mappings` (0021): same scope/origin pair, same
 * supersession columns, same corroboration citation. That is not imitation — KTD-15 records that the two
 * tiers share ONE rule about how far a correction reaches, which is why both are decided by
 * `ingredients/domain/correctionScopePolicy.ts` and only their SUBJECT differs.
 *
 * ⚠️ The hand-authored SQL in `src/database/migrations/0029_ingredient_parse_corrections.sql` is the SOURCE
 * OF TRUTH (repo convention — the in-VPC runner applies those files in filename order). These definitions
 * drive the query layer and document the same final shape. Read that file for the reasoning behind every
 * constraint and index; the partial unique indexes in particular are load-bearing CONCURRENCY CONTROLS, not
 * optimisations, and the CHECKs are what make a half-erased row and an unjustified global correction
 * unrepresentable.
 */
import { sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import {
    CORRECTION_ORIGINS,
    CORRECTION_SCOPES,
    type CorrectionOrigin,
    type CorrectionScope,
} from '../../ingredients/domain/correctionScopePolicy.js';

/**
 * The controlled value sets, tied to the authoritative policy unions with `satisfies` — so a column's CHECK
 * constraint and the pure policy's union cannot drift apart without a compile error (the convention
 * `RESOLUTION_MAPPING_SCOPES` already follows).
 */
export const PARSE_CORRECTION_SCOPES = CORRECTION_SCOPES satisfies readonly CorrectionScope[];

/** The controlled `origin` value set — on whose authority a correction holds. */
export const PARSE_CORRECTION_ORIGINS = CORRECTION_ORIGINS satisfies readonly CorrectionOrigin[];

/** Any value that survives a `jsonb` round trip. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * The corrected parse, as persisted.
 *
 * ⛔ Its shape is `ParsedFacts` (`@kitchensink/recipe-import-core`) — `statedMeasure`, `quantity`, `unit`,
 * `foods[]` — and deliberately NOT the wider `ParsedLine`, whose `raw` member is the input byte-identical.
 * Storing `raw` here would put a SECOND copy of the erasable text in a column no sweep touches, which is the
 * "moved the data rather than removing it" failure the mappings suite already tests against.
 *
 * ⚠️ It is typed as an opaque JSON object rather than imported from `recipe-import-core`, because this
 * service does not otherwise depend on that package and NOTHING in this tier inspects the payload: it is
 * written, read back, and compared BY POSTGRES. Taking a package dependency to name a shape no statement
 * looks inside would buy a type at the cost of a dependency edge and four transitive runtime packages in the
 * service image. The day a caller in this service needs to read a field, that is the day the edge is worth
 * taking.
 */
export type CorrectedParse = { readonly [key: string]: JsonValue };

export const ingredientParseCorrections = pgTable(
    'ingredient_parse_corrections',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        /**
         * The match grain — `normalizedIngredientKey` over the WHOLE line.
         *
         * ⛔ NOT the parse cache's case-preserving digest, and the divergence is deliberate: corroboration
         * requires two cooks' lines to COLLIDE on this key, which a case-preserving digest would prevent.
         * Migration 0029's header carries the full reasoning.
         */
        normalizedKey: text('normalized_key').notNull(),
        /**
         * The raw line the key was derived FROM — what makes the key derivation a two-way door, since a
         * change to that function is then a backfill rather than data loss. NULL after erasure, and it moves
         * as a PAIR with {@link ingredientParseCorrections.ownerId}.
         */
        sourceLine: text('source_line'),
        /** The corrected parse. Survives erasure — it is the correction itself. */
        correctedFacts: jsonb('corrected_facts').$type<CorrectedParse>().notNull(),
        /** How far this correction reaches: `author` binds only its cook, `global` binds every user. */
        scope: text('scope').$type<CorrectionScope>().notNull(),
        /** On whose authority it holds: its writer alone, a grant holder, or two cooks agreeing. */
        origin: text('origin').$type<CorrectionOrigin>().notNull(),
        /**
         * The app-user ULID that typed the line — present so a correction is attributable AND erasable.
         *
         * ⛔ It moves as a PAIR with `sourceLine`, in every writer and in the erasure sweep alike, and
         * migration 0029 enforces that with a CHECK rather than trusting it. An owner id left beside another
         * cook's line would aim the NEXT erasure at the wrong person: it would sweep a line that owner never
         * typed and leave the one they did.
         *
         * ⚠️ NULL means one of two things and neither is an error: the row is a corroboration binding (nobody
         * wrote it — two cooks' agreement produced it), or the owner has been erased.
         */
        ownerId: varchar('owner_id', { length: 255 }),
        /** Which affordance produced the correction. Free text: a new surface must never fail a write. */
        surfacing: text('surfacing').notNull(),
        /** First of the two author corrections whose agreement produced a corroboration binding. */
        corroboratedA: uuid('corroborated_a'),
        /** Second of the two. Both are set exactly when `origin` is `corroboration`. */
        corroboratedB: uuid('corroborated_b'),
        /** When this correction stopped being in force. NULL means LIVE — the predicate every index uses. */
        supersededAt: timestamp('superseded_at', { withTimezone: true }),
        /** The correction that replaced it, or NULL when it was retired with no replacement. */
        supersededBy: uuid('superseded_by'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check('ingredient_parse_corrections_scope_check', sql`${table.scope} IN ('author', 'global')`),
        check(
            'ingredient_parse_corrections_origin_check',
            sql`${table.origin} IN ('author', 'curator', 'corroboration')`,
        ),
        check(
            'ingredient_parse_corrections_scope_origin_agree',
            sql`(${table.scope} = 'author') = (${table.origin} = 'author')`,
        ),
        // ⛔ A GLOBAL CORRECTION WITH NO JUSTIFICATION IS UNREPRESENTABLE.
        check(
            'ingredient_parse_corrections_corroboration_cites_both',
            sql`(${table.origin} = 'corroboration') = (${table.corroboratedA} IS NOT NULL AND ${table.corroboratedB} IS NOT NULL)`,
        ),
        // ⚠️ The `IS NULL` disjunct is REQUIRED: `NULL IS DISTINCT FROM NULL` is FALSE, so without it this
        // constraint rejects every ordinary row.
        check(
            'ingredient_parse_corrections_corroboration_distinct',
            sql`${table.corroboratedA} IS NULL OR ${table.corroboratedA} IS DISTINCT FROM ${table.corroboratedB}`,
        ),
        check(
            'ingredient_parse_corrections_supersession_coherent',
            sql`${table.supersededBy} IS NULL OR ${table.supersededAt} IS NOT NULL`,
        ),
        check(
            'ingredient_parse_corrections_supersession_forward',
            sql`${table.supersededBy} IS DISTINCT FROM ${table.id}`,
        ),
        // ⛔ THE PAIR INVARIANT (KTD-14) — the owner link and the text it identifies exist together or not at
        // all, so a half-erased row is a state the database refuses rather than a bug review has to catch.
        check(
            'ingredient_parse_corrections_owner_line_pair',
            sql`(${table.ownerId} IS NULL) = (${table.sourceLine} IS NULL)`,
        ),
        // ⛔ THE CORROBORATION COUNTER. A count of live author-scoped rows for a line equals a count of
        // DISTINCT COOKS only because this index makes a second live row from one cook impossible. Its
        // `owner_id IS NOT NULL` half is also what RELEASES an erased cook's slot.
        uniqueIndex('idx_parse_corrections_live_owner')
            .on(table.normalizedKey, table.ownerId)
            .where(sql`${table.scope} = 'author' AND ${table.supersededAt} IS NULL AND ${table.ownerId} IS NOT NULL`),
        // ⛔ The top tier must be deterministic. Enforcing this here is what makes supersession the ONLY way a
        // global correction can be replaced — and therefore what makes the scope policy's gate unbypassable.
        uniqueIndex('idx_parse_corrections_live_global')
            .on(table.normalizedKey)
            .where(sql`${table.scope} = 'global' AND ${table.supersededAt} IS NULL`),
        // Makes the concurrent-promotion race safe with an ordinary `ON CONFLICT DO NOTHING`: the loser gets
        // zero rows, which reads as "somebody else already promoted this", never as an error.
        uniqueIndex('idx_parse_corrections_corroboration_pair')
            .on(table.corroboratedA, table.corroboratedB)
            .where(sql`${table.origin} = 'corroboration'`),
        // ⚠️ `correctedFacts` is deliberately NOT a column of this index: a `jsonb` payload is unbounded and a
        // btree entry is not, so indexing it would turn a large correction into an INSERT failure.
        index('idx_parse_corrections_live_lookup')
            .on(table.normalizedKey)
            .where(sql`${table.supersededAt} IS NULL`),
        index('idx_parse_corrections_owner')
            .on(table.ownerId)
            .where(sql`${table.ownerId} IS NOT NULL`),
    ],
);

/** An `ingredient_parse_corrections` row as selected. */
export type IngredientParseCorrectionRow = InferSelectModel<typeof ingredientParseCorrections>;
/** An `ingredient_parse_corrections` row for insert. */
export type NewIngredientParseCorrectionRow = InferInsertModel<typeof ingredientParseCorrections>;

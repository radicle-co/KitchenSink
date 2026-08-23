/**
 * Drizzle definition for `recipe_ingredient_verifications` (plan U11/U14, migration 0023) — what the
 * verification gate CONCLUDED about one recipe line.
 *
 * ⛔ READ-ONLY FROM THIS SERVICE, and that is a boundary rather than an accident. The only writer is
 * `recipe-workers`' `verdictStore.ts`, which writes it over a schema-less handle precisely so those Lambdas
 * do not import this service's internals. This definition exists so the recipe service can SELECT from the
 * table with the same type safety it has everywhere else — nothing here inserts, updates or deletes, and a
 * write issued through it would put a second writer on a table whose idempotence argument assumes one.
 *
 * ⚠️ The hand-authored `src/database/migrations/0023_line_verifications.sql` is the SOURCE OF TRUTH (repo
 * convention — the in-VPC runner applies those files in filename order). Read its header before changing
 * anything here: it carries the reasoning for the content key, for the three CHECKed enums, and for the two
 * partial indexes, plus the one rule every reader depends on — **ABSENCE OF A ROW MEANS PUBLISH.**
 *
 * ⛔ `verification_key` is TEXT, not `uuid`: it is `{version}:{sha256hex}`, and the `v1:` prefix is part of
 * the value because a change to the derivation must be an enumerable re-partition rather than a silent one.
 */
import { sql, type InferSelectModel } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { VERIFICATION_BANDS, type VerificationBand } from '../../recipes/domain/lineVerification.js';

/**
 * The controlled `band` value set, tied to the authoritative reader policy with `satisfies` — so the column's
 * CHECK constraint and the pure module that interprets it cannot drift apart without a compile error (the
 * convention `RESOLUTION_MAPPING_SCOPES` already follows).
 */
export const LINE_VERIFICATION_BANDS = VERIFICATION_BANDS satisfies readonly VerificationBand[];

export const recipeIngredientVerifications = pgTable(
    'recipe_ingredient_verifications',
    {
        /** `{version}:{sha256hex}` over the canonical judgement — the content key, and the primary key. */
        verificationKey: text('verification_key').primaryKey(),
        /** The model's judgement: `agree`, `disagree`, or the first-class `abstain`. */
        verdict: text('verdict').notNull(),
        /** The ordinal rung the model reported. Named rungs, never a number (R16). */
        certainty: text('certainty').notNull(),
        /** The collapsed band, STORED rather than derived — a recalibration must not rewrite history. */
        band: text('band').notNull(),
        /**
         * Which aspects were actually asked about.
         *
         * ⛔ Load-bearing, not decoration: identity may be skipped when a human curated the mapping or a wide
         * margin established it, so an `agree` says nothing about identity unless `'identity'` appears here.
         */
        aspects: text('aspects').array().notNull(),
        /** R21 / KTD-4 — the model that produced this verdict. A verdict with no author cannot be rebaselined. */
        modelId: text('model_id').notNull(),
        /** The opaque food-service id the verdict was about. May DANGLE after U12's reseed; readers fall through. */
        foodId: text('food_id').notNull(),
        verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        check(
            'recipe_ingredient_verifications_verdict_check',
            sql`${table.verdict} IN ('agree', 'disagree', 'abstain')`,
        ),
        check('recipe_ingredient_verifications_certainty_check', sql`${table.certainty} IN ('low', 'medium', 'high')`),
        check(
            'recipe_ingredient_verifications_band_check',
            sql`${table.band} IN ('verified', 'contradicted', 'inconclusive')`,
        ),
        // ⛔ `cardinality`, NOT `array_length(…, 1)` — the migration's header explains why the obvious spelling
        // admits exactly the empty array it was written to forbid. This entry exists so a reader of the schema
        // sees the constraint; the migration is authoritative.
        check('recipe_ingredient_verifications_aspects_nonempty', sql`cardinality(${table.aspects}) >= 1`),
        index('idx_line_verifications_contradicted')
            .on(table.foodId, table.verifiedAt)
            .where(sql`band = 'contradicted'`),
        index('idx_line_verifications_model').on(table.modelId, table.verifiedAt),
    ],
);

/** A `recipe_ingredient_verifications` row as selected. */
export type RecipeIngredientVerificationRow = InferSelectModel<typeof recipeIngredientVerifications>;

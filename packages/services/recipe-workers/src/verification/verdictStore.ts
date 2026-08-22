/**
 * WHERE A VERDICT LANDS — the two writes the verification gate is allowed to make, and nothing else.
 *
 * DESIGN PATTERN: **Repository behind a deliberately narrow Port.** The handler holds this interface and no
 * database handle, so the set of tables the gate can touch is a two-line type rather than a code review.
 *
 * ## ⛔ WHAT IS DELIBERATELY ABSENT: `ingredients.food_resolution_status`
 *
 * The obvious place to record a disagreement is the column that already names a resolution's state. It is the
 * wrong place, three times over:
 *
 *  1. **Blast radius.** `ingredients` is a SHARED, ownerless catalog deduped one row per `food_id`. Flipping
 *     its status because ONE recipe line's quantity disagreed would withdraw nutrition from every recipe in
 *     the system that references that ingredient.
 *  2. **It is a MIRROR.** That column's own schema docstring defines it as mirroring food-service's
 *     `FoodStatus` lifecycle. Writing our own value asserts a status food-service never emitted.
 *  3. **`UNRESOLVED` already means something else, and it is a dead end.** It means "several candidates, ask
 *     the user to pick", and the candidates route serves that picker. A gate-written `UNRESOLVED` yields a
 *     picker with zero options and un-short-circuits `addByFoodId` for every future add of that food.
 *
 * ## ⛔ RAW SQL OVER A SCHEMA-LESS HANDLE IS THE ESTABLISHED SEAM, NOT A SHORTCUT
 *
 * `common/db.ts` reasons it out: the `kitchensink_recipes` Drizzle models live inside recipe-service's `src`,
 * and importing them here would couple these Lambdas to that service's internals — "the exact coupling the
 * raw-SQL boundary avoids". Five shipped handlers already write recipe-service-owned tables this way, and
 * `rawSqlParameterization.test.ts` guards the parameterisation.
 *
 * ## Both writes are IDEMPOTENT, because the caller may not retry them
 *
 * A verdict write that fails is metered and swallowed (a throw would redeliver a message whose call was
 * already billed). So a redelivery that DOES happen — from a failure earlier in the handler — must be able to
 * write the same verdict twice without an error. Both statements are therefore upserts, and the verdict's key
 * is the content of the judgement rather than a row id.
 */
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

/** One line verdict, ready to store. */
export interface VerdictRow {
    /** `{version}:{sha256hex}` over the canonical judgement. The primary key. */
    readonly verificationKey: string;
    readonly verdict: string;
    readonly certainty: string;
    readonly band: string;
    /** Which aspects were actually asked about. Reading a verdict without this over-claims what was checked. */
    readonly aspects: readonly string[];
    /** R21 — the model that produced the verdict. */
    readonly modelId: string;
    readonly foodId: string;
}

/** One agreed identity, ready to remember. */
export interface AgreementRow {
    /** The line the cook's source said — normalized into the knowledge base's match grain before storing. */
    readonly sourceLine: string;
    readonly foodId: string;
    readonly modelId: string;
}

/** The gate's entire write surface. */
export interface VerdictStore {
    /**
     * Record what the gate concluded about one line.
     *
     * @param row - The verdict.
     * @sideEffect Upserts `recipe_ingredient_verifications`.
     */
    recordVerdict(row: VerdictRow): Promise<void>;

    /**
     * Remember that a model agreed this phrase means this food (R21, cascade tier 3).
     *
     * @param row - The agreement.
     * @sideEffect Upserts `ingredient_resolution_memos`.
     */
    rememberAgreement(row: AgreementRow): Promise<void>;
}

/**
 * Build the store over a database handle.
 *
 * @param db - The schema-less recipe database handle.
 * @returns The store.
 * @sideEffect The returned methods write to the recipe database.
 */
export function createVerdictStore(db: NodePgDatabase<Record<string, never>>): VerdictStore {
    return {
        async recordVerdict(row: VerdictRow): Promise<void> {
            // A redelivery must be able to write the same verdict twice. `DO UPDATE` rather than `DO NOTHING`
            // so a RE-verification under a newer model supersedes the older judgement instead of being
            // silently dropped — the same rule `ingredient_resolution_memos` follows for the same reason.
            await db.execute(sql`
                INSERT INTO recipe_ingredient_verifications
                    (verification_key, verdict, certainty, band, aspects, model_id, food_id)
                VALUES (
                    ${row.verificationKey}, ${row.verdict}, ${row.certainty}, ${row.band},
                    ${[...row.aspects]}, ${row.modelId}, ${row.foodId}
                )
                ON CONFLICT (verification_key) DO UPDATE
                   SET verdict     = EXCLUDED.verdict,
                       certainty   = EXCLUDED.certainty,
                       band        = EXCLUDED.band,
                       aspects     = EXCLUDED.aspects,
                       model_id    = EXCLUDED.model_id,
                       verified_at = now()
            `);
        },

        async rememberAgreement(row: AgreementRow): Promise<void> {
            const key = normalizedIngredientKey(row.sourceLine);

            if (key === undefined) {
                // A phrase with no visible content cannot be a match grain. Total rather than throwing, for
                // the reason `normalizedIngredientKey` gives: this is a branch, not a failure.
                return;
            }

            await db.execute(sql`
                INSERT INTO ingredient_resolution_memos (normalized_key, food_id, source_phrase, verified_by)
                VALUES (${key}, ${row.foodId}, ${row.sourceLine}, ${row.modelId})
                ON CONFLICT (normalized_key) DO UPDATE
                   SET food_id     = EXCLUDED.food_id,
                       source_phrase = EXCLUDED.source_phrase,
                       verified_by = EXCLUDED.verified_by,
                       verified_at = now()
            `);
        },
    };
}

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
import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

/**
 * Render a string array as a PostgreSQL `text[]` expression with each element parameterised.
 *
 * ⛔ NOT `${values}` directly: drizzle's `sql` template expands a bare array into a parameter LIST —
 * `($1, $2)`, a record — so every real INSERT into a `text[]` column failed with "column is of type text[]
 * but expression is of type record" while the unit suite's fake store proved only that the method was called.
 * Found live 2026-08-31, twelve billed verdicts into the first full-corpus drain; pinned by
 * `verdictStore.integration.test.ts`.
 */
function textArray(values: readonly string[]): SQL {
    return sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
    )}]::text[]`;
}

/** One line verdict, ready to store. */
export interface VerdictRow {
    /** `{version}:{sha256hex}` over the canonical judgement. The primary key. */
    readonly verificationKey: string;
    readonly verdict: string;
    readonly certainty: string;
    readonly band: string;
    /** Which aspects were actually asked about. Reading a verdict without this over-claims what was checked. */
    readonly aspects: readonly string[];
    /**
     * The model's verdict on IDENTITY alone, when it itemized (migration 0042, owner ruling 2026-08-31).
     * `undefined` for an answer that carried no aspects object — an older prompt, or a model that omitted
     * it. U13's re-pick surface reads this: a joint `disagree` with an unparseable amount says nothing
     * about the food, and only an identity dispute belongs in front of a human.
     */
    readonly identityVerdict?: string | undefined;
    /** The model's verdict on QUANTITY alone, under the same rules. */
    readonly quantityVerdict?: string | undefined;
    /** R21 — the model that produced the verdict. */
    readonly modelId: string;
    readonly foodId: string;
}

/** One agreed identity, ready to remember. */
export interface AgreementRow {
    /**
     * The ingredient PHRASE the parse lifted out of the judged line — `all-purpose flour`, never
     * `2 cups all-purpose flour` (migration 0041, owner ruling 2026-08-31). This is what the memo key is
     * derived from, because the memo tier's read side queries `normalizedIngredientKey(name)` — the phrase
     * a picker types. It was `sourceLine` (the whole line) until U15 measured that not one of 289
     * line-keyed memos could ever serve any query. The caller (`verifyLine`) has already verified the
     * phrase is contained in the judged line.
     */
    readonly phrase: string;
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
                    (verification_key, verdict, certainty, band, aspects, identity_verdict, quantity_verdict,
                     model_id, food_id)
                VALUES (
                    ${row.verificationKey}, ${row.verdict}, ${row.certainty}, ${row.band},
                    ${textArray(row.aspects)}, ${row.identityVerdict ?? null}, ${row.quantityVerdict ?? null},
                    ${row.modelId}, ${row.foodId}
                )
                ON CONFLICT (verification_key) DO UPDATE
                   SET verdict     = EXCLUDED.verdict,
                       certainty   = EXCLUDED.certainty,
                       band        = EXCLUDED.band,
                       aspects     = EXCLUDED.aspects,
                       identity_verdict = EXCLUDED.identity_verdict,
                       quantity_verdict = EXCLUDED.quantity_verdict,
                       model_id    = EXCLUDED.model_id,
                       verified_at = now()
            `);
        },

        async rememberAgreement(row: AgreementRow): Promise<void> {
            // ⛔ THE SAME FUNCTION THE MEMO TIER QUERIES WITH — that identity is the whole repair (0041):
            // reads and writes cannot sit at different grains while both go through this one normalizer
            // over the same phrase. Pinned by `verdictStore.integration.test.ts`.
            const key = normalizedIngredientKey(row.phrase);

            if (key === undefined) {
                // A phrase with no visible content cannot be a match grain. Total rather than throwing, for
                // the reason `normalizedIngredientKey` gives: this is a branch, not a failure.
                return;
            }

            // ⛔ THE PHRASE IS STORED UNCONDITIONALLY, and that is the 2026-08-25 owner ruling (ADR-0027)
            // rather than a simplification. This statement used to carry an `owner_id` and to write
            // `source_phrase` only when the message named an owner — migration 0026 had added the column so
            // an erasure sweep had a predicate, and 0031 made the pairing a CHECK. The owner reversed the
            // premise: an ingredient phrase is not private data. Migration 0033 dropped the column, the CHECK
            // and the sweep, so a memo now records exactly what it always meant to — the machine's conclusion
            // and the words it judged. ⛔ Do not reintroduce a conditional here; a memo with no phrase would
            // silently cost the two-way door 0021 keeps the phrase for.
            //
            // ⚠️ Since 0041 the stored words are the parsed PHRASE, not the whole line — `source_phrase` is
            // 0021's two-way door (re-derive keys if the normalization ever changes), so it must hold the
            // raw text the KEY normalizes, or a re-key would reintroduce the line-grain mismatch.
            await db.execute(sql`
                INSERT INTO ingredient_resolution_memos
                    (normalized_key, food_id, source_phrase, verified_by)
                VALUES (${key}, ${row.foodId}, ${row.phrase}, ${row.modelId})
                ON CONFLICT (normalized_key) DO UPDATE
                   SET food_id     = EXCLUDED.food_id,
                       source_phrase = EXCLUDED.source_phrase,
                       verified_by = EXCLUDED.verified_by,
                       verified_at = now()
            `);
        },
    };
}

/**
 * U14 — the data-access layer for `recipe_ingredient_verifications`, and the FIRST reader that table has ever
 * had.
 *
 * DESIGN PATTERN: Repository behind a deliberately narrow port, the read-side mirror of `recipe-workers`'
 * `verdictStore.ts`. That module documents its own narrowness as the reason the gate's WRITE surface is a
 * two-line type rather than a code review; this one is the same argument in the other direction — one method,
 * one projection, no joins, and no way to write.
 *
 * ## ⛔ WHY THIS FILE EXISTS
 *
 * Migration 0023 shipped a verdict table, `recipe-workers` shipped the writer, and nothing anywhere selected
 * from it. A gate disagreement was durably recorded and structurally incapable of reaching a cook — the
 * migration's own header says so ("this table is written by the worker and read by nothing"). Its stated
 * blocker was `recipe_ingredients.source_line`, which migration 0024 has since added, so the join is now
 * derivable: a line's own columns plus its food id reproduce the content key a verdict is stored under.
 *
 * ## ⚠️ ONE BATCHED READ PER REQUEST, like every other lookup on the nutrition path
 *
 * The deferred batch endpoint answers for up to `MAX_NUTRITION_RECIPE_IDS` recipes in ONE database read and
 * ONE food call. A per-line verdict lookup would restore exactly the N+1 that endpoint exists to remove, so
 * this method takes every key the request needs at once — and deduplicates them, because the verdict table is
 * CONTENT-keyed and a line shared by two recipes is genuinely one row.
 *
 * @sideEffect Reads `recipe_ingredient_verifications`.
 */
import { inArray } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipeIngredientVerifications } from '../../database/schema/lineVerifications.js';
import { VERIFICATION_BANDS, type VerificationBand } from '../domain/lineVerification.js';

/** Whether a stored band is one this build knows how to act on. Pure. */
function isKnownBand(band: string): band is VerificationBand {
    return (VERIFICATION_BANDS as readonly string[]).includes(band);
}

export class LineVerificationsDal {
    /**
     * @param db - The shared Drizzle client. Held rather than passed per call, matching `IngredientsDal`
     *   and `PhotosDal`; this table is never touched inside a recipe write transaction.
     */
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * The band the gate recorded for each of the given verdict keys.
     *
     * ⛔ A KEY WITH NO ROW IS SIMPLY ABSENT FROM THE MAP, and callers must read that as "publish". Migration
     * 0023 settles it: the gate runs off a queue, so a line publishes between save and verification whatever
     * this table says, and the only coherent read-side rule is that an explicit contradiction withholds while
     * everything else behaves as it did before the gate existed.
     *
     * ⛔ AN UNRECOGNISED BAND IS TREATED AS ABSENT, not coerced. The database CHECK is the floor, but this
     * service and `recipe-workers` are separate deployables on separate release cadences; a band this build
     * cannot interpret has no defined publish behaviour, and guessing `contradicted` would withhold a cook's
     * nutrition on a value nobody defined.
     *
     * @param keys - Every verdict key the request needs; duplicates are collapsed.
     * @returns Verdict key → band, for the keys that have a row this build understands.
     * @sideEffect One `recipe_ingredient_verifications` read.
     */
    public async findBandsByKeys(keys: readonly string[]): Promise<Map<string, LineVerdictRow>> {
        const unique = [...new Set(keys)];

        if (unique.length === 0) {
            // Not an optimisation: `inArray(column, [])` renders `in ()`, which Postgres rejects outright.
            return new Map();
        }

        const rows = await this.db
            .select({
                verificationKey: recipeIngredientVerifications.verificationKey,
                band: recipeIngredientVerifications.band,
                certainty: recipeIngredientVerifications.certainty,
                identityVerdict: recipeIngredientVerifications.identityVerdict,
            })
            .from(recipeIngredientVerifications)
            .where(inArray(recipeIngredientVerifications.verificationKey, unique));

        const bands = new Map<string, LineVerdictRow>();

        for (const row of rows) {
            if (isKnownBand(row.band)) {
                bands.set(row.verificationKey, {
                    band: row.band,
                    certainty: row.certainty,
                    identityVerdict: row.identityVerdict,
                });
            }
        }

        return bands;
    }
}

/**
 * One stored verdict, as the read side consumes it (migration 0042, owner ruling 2026-08-31).
 *
 * The band is the publish decision, exactly as before; `certainty` and `identityVerdict` exist for ONE
 * consumer — `identityContradictedOf`, the U13 re-pick door — and `identityVerdict: null` is the pre-0042
 * population, which keeps its NEEDS_REVIEW treatment.
 */
export interface LineVerdictRow {
    readonly band: VerificationBand;
    readonly certainty: string;
    readonly identityVerdict: string | null;
}

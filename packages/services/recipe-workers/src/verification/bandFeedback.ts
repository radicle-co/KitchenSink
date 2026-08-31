/**
 * The gate's BAND FEEDBACK (plan U3) — after a verdict lands, tell the band-authority store what the gate
 * thought of the lexical bind it was checking, and let the band earn or lose its autonomy.
 *
 * The state machine's SQL lives ONCE in `@kitchensink/recipe-core/resolution/band-authority-store`
 * (see its header for why — recipe-service is the second writer, via R16 corrections, and the worker seam
 * forbids sharing a DAL). This module owns only what is local to the gate:
 *
 *  - **The verdict mapping** ({@link bandVerdictFor}) — which verdicts are observations at all.
 *  - **The band lookup** — the verdict names a `foodId`; the band it feeds back into is the one the
 *    RESOLUTION was made in, read from the latest lexical `ingredient_resolutions` event (its
 *    `ranker_version` is the version that produced the shortlist, deliberately NOT the currently deployed
 *    constant: a deploy between resolve and verdict must not pollute the new version's fresh record).
 *
 * ⚠️ Every failure is swallowed: by the time feedback runs the Bedrock call is billed and the verdict is
 * stored, so a throw here would redeliver a message that then reserves and calls AGAIN. A lost observation
 * costs one data point; bands converge from the rest.
 */
import { BandAuthorityStore } from '@kitchensink/recipe-core/resolution/band-authority-store';
import { marginBandOf } from '@kitchensink/recipe-core/resolution/band-policy';
import type { ConfidenceBand } from '@kitchensink/recipe-core/resolution/confidence';

import { logger } from '../common/logger.js';

/** The minimal query surface the feedback needs — `pg.Pool` satisfies it structurally. */
export interface BandQueryable {
    query(text: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

/** What the handler reports after each TERMINAL verdict. */
export interface BandFeedbackInput {
    readonly foodId: string;
    readonly band: ConfidenceBand;
    /** Which aspects the gate actually asked about — a verdict that skipped identity is not a bind verdict. */
    readonly aspects: readonly string[];
}

/** The gate's feedback port, injected into the handler so the unit suite can replace it wholesale. */
export interface BandFeedback {
    record(input: BandFeedbackInput): Promise<void>;
}

/**
 * Map one gate verdict to a band observation, or to nothing.
 *
 * ⛔ Two refusals: a verdict whose aspects never included `identity` says nothing about the lexical bind,
 * and `inconclusive` is ABSENCE, not dissent (ADR-0026 §3's rule one layer up).
 *
 * ⚠️ The accepted over-count: an identity-including `contradicted` may really be a QUANTITY disagreement —
 * the verdict is not per-aspect — and it still lands as `disagree`. That ambiguity deliberately falls
 * toward revocation, the direction that costs ~$0.000034 a line rather than a wrong published bind.
 *
 * @param band - The verdict's confidence band.
 * @param aspects - What the gate asked about.
 * @returns The observation verdict, or `undefined` for absence. Pure.
 */
export function bandVerdictFor(band: ConfidenceBand, aspects: readonly string[]): 'agree' | 'disagree' | undefined {
    if (!aspects.includes('identity')) {
        return undefined;
    }

    if (band === 'verified') {
        return 'agree';
    }

    if (band === 'contradicted') {
        return 'disagree';
    }

    return undefined;
}

/**
 * Build the gate's feedback recorder over the recipe database handle.
 *
 * @param client - The recipe database pool (`common/db.ts` `getRecipePool`), or any queryable double.
 * @returns The feedback port. @sideEffect The returned method reads and writes the band tables.
 */
export function createBandFeedback(client: BandQueryable): BandFeedback {
    const store = new BandAuthorityStore(async (text, params) => {
        const result = await client.query(text, [...params]);

        return result.rows as readonly Record<string, unknown>[];
    });

    return {
        async record(input: BandFeedbackInput): Promise<void> {
            try {
                const verdict = bandVerdictFor(input.band, input.aspects);

                if (verdict === undefined) {
                    return;
                }

                // The band the RESOLUTION was made in. `ingredients` is deduped one row per food_id (0006),
                // so the join is at most one ingredient; latest-first picks the event this verdict is
                // plausibly about (an aggregate log tolerates the rare misattribution across admissions).
                const rows = await client.query(
                    `SELECT r.rung, r.margin, r.query_shape, r.ranker_version
                       FROM ingredient_resolutions r
                       JOIN ingredients i ON i.id = r.ingredient_id
                      WHERE i.food_id = $1 AND r.tier = 'lexical'
                      ORDER BY r.created_at DESC
                      LIMIT 1`,
                    [input.foodId],
                );
                const resolution = rows.rows[0] as
                    | {
                          rung: string | null;
                          margin: string | null;
                          query_shape: string | null;
                          ranker_version: string | null;
                      }
                    | undefined;

                if (
                    resolution === undefined ||
                    resolution.rung === null ||
                    resolution.query_shape === null ||
                    resolution.ranker_version === null
                ) {
                    // No lexical bind to give feedback on — the verdict was about some other tier's work.
                    return;
                }

                const transition = await store.recordObservationAndEvaluate(
                    {
                        rung: resolution.rung,
                        marginBand: marginBandOf(resolution.margin === null ? undefined : Number(resolution.margin)),
                        queryShape: resolution.query_shape,
                        rankerVersion: resolution.ranker_version,
                    },
                    verdict,
                    'gate',
                );

                if (transition !== 'hold') {
                    logger.info('band authority transition', { transition, rung: resolution.rung });
                }
            } catch (error) {
                logger.error('band feedback failed; the observation is lost', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        },
    };
}

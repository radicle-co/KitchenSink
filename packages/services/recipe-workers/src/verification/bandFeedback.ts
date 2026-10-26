/**
 * The gate's BAND FEEDBACK (plan U3) — after a verdict lands, tell the band-authority store what the gate
 * thought of the lexical bind it was checking, and let the band earn or lose its autonomy. Since plan U4b
 * it is also the gate's AUTHORITY READ: the worker re-runs the verification policy with its OWN view of
 * band authority, never the message's claim (KTD-A).
 *
 * The state machine's SQL lives ONCE in `@kitchensink/recipe-core/resolution/band-authority-store`. This module owns
 * only what is local to the gate: the verdict mapping ({@link bandVerdictFor}), which verdicts are observations at all.
 *
 * ⛔ THE BAND IS THE ONE THE MESSAGE NAMES (ADR-0071), never one looked up. This module used to find a verdict's band
 * from the food's latest lexical `ingredient_resolutions` event. That row is shared by every cook who bound the food, so
 * one cook's verdict moved a band another cook's resolution was ranked in. The caller now passes the key the message
 * carries, and with no key there is nothing to record or read. No producer sends a key today: the band subsystem is
 * DORMANT BY DECISION (ADR-0071).
 *
 * ⚠️ Every failure is swallowed: by the time feedback runs the Bedrock call is billed and the verdict is
 * stored, so a throw here would redeliver a message that then reserves and calls AGAIN. The authority READ
 * degrades to `undefined` for the same reason plus KTD-B's stale-read rule — an unreadable band table VERIFIES
 * identity, the direction that costs money rather than correctness.
 */
import { BandAuthorityStore, type BandKey } from '@kitchensink/recipe-core/resolution/band-authority-store';
import type { BandAuthority } from '@kitchensink/recipe-core/resolution/band-policy';
import type { ConfidenceBand } from '@kitchensink/recipe-core/resolution/confidence';

import { logger } from '../common/logger.js';

/** The minimal query surface the feedback needs — `pg.Pool` satisfies it structurally. */
export interface BandQueryable {
    query(text: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

/** What the handler reports after each TERMINAL verdict. */
export interface BandFeedbackInput {
    /** The band the message named: the ranking that produced this line, never one looked up (ADR-0071). */
    readonly bandKey: BandKey;
    readonly band: ConfidenceBand;
    /** Which aspects the gate actually asked about — a verdict that skipped identity is not a bind verdict. */
    readonly aspects: readonly string[];
    /** Whether the message was shadow-sampled — the observation then lands under source `shadow`. */
    readonly shadowSample?: boolean | undefined;
}

/** The gate's feedback port, injected into the handler so the unit suite can replace it wholesale. */
export interface BandFeedback {
    record(input: BandFeedbackInput): Promise<void>;
    /**
     * The authority of the band the message named, for the gate's own policy re-run (KTD-A: the worker reads its OWN
     * authority from the store, never a claim of authority off the message).
     *
     * @param bandKey - The band the message named.
     * @returns The authority, or `undefined` — including on ANY failure, which verifies identity (the
     *   stale-read direction is fixed: revocation wins races).
     */
    authorityFor(bandKey: BandKey): Promise<BandAuthority | undefined>;
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
 * Build the gate's feedback recorder + authority reader over the recipe database.
 *
 * @param client - The recipe database pool (`common/db.ts` `getRecipePool`), or any queryable double.
 * @returns The feedback port. @sideEffect The returned methods read and write the band tables.
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

                const transition = await store.recordObservationAndEvaluate(
                    input.bandKey,
                    verdict,
                    input.shadowSample === true ? 'shadow' : 'gate',
                );

                if (transition !== 'hold') {
                    logger.info('band authority transition', { transition, rung: input.bandKey.rung });
                }
            } catch (error) {
                logger.error('band feedback failed; the observation is lost', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        },

        async authorityFor(bandKey: BandKey): Promise<BandAuthority | undefined> {
            try {
                return await store.authorityFor(bandKey);
            } catch (error) {
                logger.warn('band-authority read failed; the line verifies identity', {
                    error: error instanceof Error ? error.message : String(error),
                });

                return undefined;
            }
        },
    };
}

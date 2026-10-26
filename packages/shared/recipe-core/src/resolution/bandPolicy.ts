/**
 * The band-authority POLICY (plan U3, KTD-B) — pure, total, truth-table shaped. The sixth instance of the
 * ADR-0023 policy-module family.
 *
 * A BAND is a confidence shape — `(rung, margin band, query shape, ranker version)` — and AUTHORITY is
 * the earned right for lexical resolutions in that shape to skip the verification gate. Authority is:
 *
 *  - **EARNED** from measured gate agreement: at least {@link BAND_AGREEMENT_BAR} over at least
 *    {@link BAND_MINIMUM_OBSERVATIONS}. Never designed in: the a-priori skip conditions (KTD-3, D4a's
 *    conjunction) are ELIGIBILITY FLOORS the caller applies before consulting this policy at all.
 *  - **MAINTAINED**, not granted-once: an authorized band keeps being shadow-sampled
 *    ({@link shadowRateFor}) and {@link decideBandAuthority} revokes the moment its measured rate falls
 *    below the same bar.
 *  - **EPOCH-ED**: each grant increments the band's epoch, and every skip records the epoch it happened
 *    under — which is what makes revocation's re-verification enumerable (R14).
 *
 * ⛔ The asymmetry every branch encodes: a false GRANT publishes wrong binds silently — the class the
 * whole plan exists to prevent — while a false REVOKE costs ~$0.000034 per line. Ambiguity therefore
 * always falls toward `verify`: an unknown band verifies ({@link shouldSkipVerification} of `undefined`),
 * a revoked band verifies, and re-earning goes through the full gate with no shortcut.
 *
 * ⚠️ The numbers are PROVISIONAL calibration constants (plan Q2): the first corpus harvest (U15) proposes
 * measured values to the owner. They are exported so the tests pin the POLICY against whatever the
 * constants are, not against today's guesses.
 */

import { SCORE_CEILING, TIER_GAP } from './rankingTiers.js';

/** The measured-agreement floor a band must clear to hold authority. Provisional (Q2). */
export const BAND_AGREEMENT_BAR = 0.995;

/** The minimum observations before the bar means anything. Provisional (Q2). */
export const BAND_MINIMUM_OBSERVATIONS = 200;

/** The shadow-sample rate immediately after a grant — the burn-in. Provisional (Q2). */
export const POST_GRANT_SHADOW_RATE = 0.5;

/** How many post-grant observations the burn-in rate applies for. Provisional (Q2). */
const BURN_IN_OBSERVATIONS = 40;

/** The steady shadow-sample rate an authorized band never drops below. Provisional (Q2). */
export const STEADY_SHADOW_RATE = 0.05;

/** Where an observation's verdict came from: the gate's answer, a shadow sample, or R16's correction. */
export type BandObservationSourceId = 'gate' | 'shadow' | 'correction';

/** A band's lifecycle state (the KTD-B state machine). */
export type BandState = 'observing' | 'authorized' | 'revoked';

/** What the caller loaded about a band, or `undefined` when the read found nothing. */
export interface BandAuthority {
    readonly state: BandState;
    /** Increments on each grant; skips record the epoch they happened under (R14). */
    readonly epoch: number;
}

/** The band's measured record: gate agreements vs disagreements (including R16's corrections). */
export interface BandStats {
    readonly agreements: number;
    readonly disagreements: number;
}

/** What `decideBandAuthority` tells the caller to do to the stored state. */
export type BandTransition = 'authorize' | 'revoke' | 'hold';

/**
 * The rungs whose bands may never earn authority to skip the gate.
 *
 * ⛔ `default` (ADR-0070): its top hit is the curated default for a bare noun (`milk` → whole milk). Authority would let
 * the lexical tier bind that default with no cook involved, and the owner ruled that a default is shown, never selected
 * for the cook (2026-10-25). Its band is still observed; it is only never authorized.
 */
const RUNGS_WITHOUT_AUTHORITY: ReadonlySet<string> = new Set(['default']);

/**
 * The grant/revoke decision for one band, from its current state, its full measured record and its rung.
 *
 * @param state - The stored lifecycle state.
 * @param stats - Agreements and disagreements, all-time within the band's ranker version.
 * @param rung - The band key's rung. REQUIRED, so no caller can decide authority without saying which rung it is for.
 * @returns The transition to apply. Pure.
 */
export function decideBandAuthority(state: BandState, stats: BandStats, rung: string): BandTransition {
    if (RUNGS_WITHOUT_AUTHORITY.has(rung)) {
        return state === 'authorized' ? 'revoke' : 'hold';
    }

    const total = stats.agreements + stats.disagreements;

    if (total < BAND_MINIMUM_OBSERVATIONS) {
        // Below minimum-n nothing is knowable: a fresh band holds, and an authorized band that somehow
        // has too few observations (a ranker-version reset mid-flight) falls back to verify via revoke.
        return state === 'authorized' ? 'revoke' : 'hold';
    }

    const rate = stats.agreements / total;

    if (rate >= BAND_AGREEMENT_BAR) {
        return state === 'authorized' ? 'hold' : 'authorize';
    }

    return state === 'authorized' ? 'revoke' : 'hold';
}

/**
 * Whether a lexical resolution in this band may skip the gate.
 *
 * ⛔ `undefined` — the band the reader could not load, or that has never been observed — VERIFIES: the
 * stale-read direction is fixed so revocation wins races and a grant may lag (KTD-B).
 *
 * @param authority - The loaded band authority, or `undefined`.
 * @returns Whether to skip. Pure.
 */
export function shouldSkipVerification(authority: BandAuthority | undefined): boolean {
    return authority?.state === 'authorized';
}

/**
 * The shadow-sample rate for an authorized band, by how many observations have landed since its grant.
 *
 * @param observationsSinceGrant - Post-grant observation count.
 * @returns The probability a skipped line is sent to the gate anyway. Pure.
 */
export function shadowRateFor(observationsSinceGrant: number): number {
    return observationsSinceGrant < BURN_IN_OBSERVATIONS ? POST_GRANT_SHADOW_RATE : STEADY_SHADOW_RATE;
}

/** The margin-band labels — the band key's second axis, in rung units. Provisional bucket edges (Q2). */
export type MarginBand = 'none' | 'lt-0.3-rung' | '0.3-0.9-rung' | 'ge-0.9-rung';

/**
 * One rung of the ladder on the score scale: the score lead one rung gives at an equal base metric.
 *
 * ⚠️ The margin edges are fractions of THIS, never absolute scores. The score is normalized by `SCORE_CEILING`, which
 * grows with every rung the ladder gains, so an absolute edge silently moves: a one-rung lead was 2/12 = 0.167 (above
 * the old 0.15 edge) and is 2/16 = 0.125 with seven rungs. In rung units a one-rung lead is always 1 (the top band).
 */
const RUNG = TIER_GAP / SCORE_CEILING;

/** Below this lead, two candidates are a photo-finish. Provisional (Q2): 0.3 rung, the old 0.05 at 2/12 per rung. */
const NARROW_MARGIN_EDGE = 0.3 * RUNG;

/** At or above this lead, the winner is clear by about a rung. Provisional (Q2): 0.9 rung, the old 0.15 at 2/12. */
const CLEAR_MARGIN_EDGE = 0.9 * RUNG;

/**
 * Bucket a ranked shortlist's top-1/top-2 score margin into its band label.
 *
 * ⛔ A MISSING margin (a singleton shortlist has no runner-up to measure against) is its OWN band, never
 * folded into `lt-0.3-rung`: a singleton is a very different confidence shape from a photo-finish, and
 * sharing a bucket would let one earn authority on the other's record.
 *
 * @param margin - Top-1 minus top-2 relevance score, or `undefined` for a singleton shortlist.
 * @returns The band label. Pure.
 */
export function marginBandOf(margin: number | undefined): MarginBand {
    if (margin === undefined) {
        return 'none';
    }

    if (margin < NARROW_MARGIN_EDGE) {
        return 'lt-0.3-rung';
    }

    if (margin < CLEAR_MARGIN_EDGE) {
        return '0.3-0.9-rung';
    }

    return 'ge-0.9-rung';
}

/** The query-shape labels — the band key's third axis (single-token and multi-word rank differently). */
export type QueryShape = 'single-token' | 'multi-word';

/**
 * Classify a resolution query's shape for the band key.
 *
 * @param phrase - The ingredient name the tier queried with.
 * @returns The shape label. Pure.
 */
export function queryShapeOf(phrase: string): QueryShape {
    return phrase
        .trim()
        .split(/\s+/)
        .filter((token) => token !== '').length <= 1
        ? 'single-token'
        : 'multi-word';
}

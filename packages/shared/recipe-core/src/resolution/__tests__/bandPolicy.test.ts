/**
 * The band-authority POLICY (plan U3, KTD-B) — pure, truth-table shaped, written before the module exists.
 *
 * The asymmetry every table below encodes: a false GRANT publishes wrong binds silently (the
 * business-critical class); a false REVOKE costs ~$0.000034 per line. Every ambiguous case therefore
 * falls toward `verify`.
 */
import { describe, expect, it } from 'vitest';

import {
    BAND_AGREEMENT_BAR,
    marginBandOf,
    queryShapeOf,
    BAND_MINIMUM_OBSERVATIONS,
    POST_GRANT_SHADOW_RATE,
    STEADY_SHADOW_RATE,
    decideBandAuthority,
    shadowRateFor,
    shouldSkipVerification,
} from '../bandPolicy.js';
import { RANK_TIERS, SCORE_CEILING, TIER_GAP, tieredRelevanceScore } from '../rankingTiers.js';

const stats = (agreements: number, disagreements: number) => ({ agreements, disagreements });

describe('decideBandAuthority — grant, hold, revoke (KTD-B truth table)', () => {
    it('grants only at or above the bar over at least the minimum observations', () => {
        const n = BAND_MINIMUM_OBSERVATIONS;

        expect(decideBandAuthority('observing', stats(n, 0), 'head')).toBe('authorize');
        // one disagreement below the bar at minimum n holds
        expect(
            decideBandAuthority('observing', stats(n - 1, Math.ceil(n * (1 - BAND_AGREEMENT_BAR)) + 1), 'head'),
        ).toBe('hold');
    });

    it('holds below the minimum observation count, however perfect the agreement', () => {
        expect(decideBandAuthority('observing', stats(BAND_MINIMUM_OBSERVATIONS - 1, 0), 'head')).toBe('hold');
        expect(decideBandAuthority('observing', stats(1, 0), 'head')).toBe('hold');
        expect(decideBandAuthority('observing', stats(0, 0), 'head')).toBe('hold');
    });

    it('revokes an authorized band the moment its rate falls below the bar', () => {
        // Post-grant evidence: shadow disagreements count against the SAME stats.
        const n = BAND_MINIMUM_OBSERVATIONS;
        const disagreements = Math.ceil((n + 10) * (1 - BAND_AGREEMENT_BAR)) + 1;

        expect(decideBandAuthority('authorized', stats(n + 10 - disagreements, disagreements), 'head')).toBe('revoke');
    });

    it('keeps an authorized band that stays at the bar', () => {
        expect(decideBandAuthority('authorized', stats(BAND_MINIMUM_OBSERVATIONS * 2, 0), 'head')).toBe('hold');
    });

    it('a revoked band re-earns through the same gate as a fresh one — never a shortcut', () => {
        expect(decideBandAuthority('revoked', stats(BAND_MINIMUM_OBSERVATIONS, 0), 'head')).toBe('authorize');
        expect(decideBandAuthority('revoked', stats(BAND_MINIMUM_OBSERVATIONS - 1, 0), 'head')).toBe('hold');
    });
});

describe('shouldSkipVerification — the consultation (KTD-A: withhold semantics, authority is the ONLY door)', () => {
    it('skips only for an AUTHORIZED band', () => {
        expect(shouldSkipVerification({ state: 'authorized', epoch: 1 })).toBe(true);
    });

    it('⛔ verifies for observing, revoked, and — the stale-read direction — UNKNOWN bands', () => {
        expect(shouldSkipVerification({ state: 'observing', epoch: 1 })).toBe(false);
        expect(shouldSkipVerification({ state: 'revoked', epoch: 2 })).toBe(false);
        // A band the reader could not load errs toward verify: revocation wins races, grant may lag.
        expect(shouldSkipVerification(undefined)).toBe(false);
    });
});

describe('shadowRateFor — the post-grant burn-in ramp', () => {
    it('samples heavily right after a grant and settles to the steady rate', () => {
        expect(shadowRateFor(0)).toBe(POST_GRANT_SHADOW_RATE);
        expect(shadowRateFor(POST_GRANT_SHADOW_RATE > STEADY_SHADOW_RATE ? 1 : 0)).toBeGreaterThanOrEqual(
            STEADY_SHADOW_RATE,
        );
    });

    it('never falls below the steady rate — an authorized band is always still being sampled', () => {
        expect(shadowRateFor(10_000)).toBe(STEADY_SHADOW_RATE);
        expect(STEADY_SHADOW_RATE).toBeGreaterThan(0);
    });
});

describe('marginBandOf — the band key second axis (provisional buckets, Q2 calibration)', () => {
    // Rewritten (code-quality review M4): the edges were absolute (0.05 / 0.15) on a score scale that shrinks with every
    // rung the ladder gains, so a one-rung lead fell from the top band (2/12) to the middle one (2/16). They are now
    // fractions of one rung, and the labels name rung units, so a label never claims a number it no longer means.
    const RUNG = TIER_GAP / SCORE_CEILING;

    it('buckets a margin into a closed range of rung units', () => {
        expect(marginBandOf(0)).toBe('lt-0.3-rung');
        expect(marginBandOf(0.3 * RUNG - 1e-9)).toBe('lt-0.3-rung');
        expect(marginBandOf(0.3 * RUNG)).toBe('0.3-0.9-rung');
        expect(marginBandOf(0.9 * RUNG - 1e-9)).toBe('0.3-0.9-rung');
        expect(marginBandOf(0.9 * RUNG)).toBe('ge-0.9-rung');
        expect(marginBandOf(0.9)).toBe('ge-0.9-rung');
    });

    it('⛔ puts a one-rung lead at equal base metric in the top band, for every adjacent pair of the current ladder', () => {
        for (const [index, tier] of RANK_TIERS.entries()) {
            if (index === 0) {
                continue;
            }

            for (const baseMetric of [0, 0.5, 1]) {
                const lead =
                    tieredRelevanceScore({ tier, baseMetric, rawAffinity: false }) -
                    tieredRelevanceScore({ tier: RANK_TIERS[index - 1]!, baseMetric, rawAffinity: false });

                expect(marginBandOf(lead)).toBe('ge-0.9-rung');
            }
        }
    });

    it('keeps a within-rung lead out of the top band', () => {
        const lead =
            tieredRelevanceScore({ tier: 'head', baseMetric: 0.5, rawAffinity: false }) -
            tieredRelevanceScore({ tier: 'head', baseMetric: 0.35, rawAffinity: false });

        expect(marginBandOf(lead)).toBe('lt-0.3-rung');
    });

    it('⛔ a missing margin (singleton shortlist) is its OWN band — never bucketed with a real zero', () => {
        expect(marginBandOf(undefined)).toBe('none');
    });
});

describe('queryShapeOf — the band key third axis', () => {
    it('separates single-token from multi-word queries (the two retrieval strategies)', () => {
        expect(queryShapeOf('pepper')).toBe('single-token');
        expect(queryShapeOf('red wine vinegar')).toBe('multi-word');
        expect(queryShapeOf('  butter  ')).toBe('single-token');
    });
});

describe('decideBandAuthority — a default band never earns authority (ADR-0070, owner ruling 2026-10-25)', () => {
    // A `default` rung's top hit is the curated default for a bare noun. An authorized band skips the gate, and the
    // lexical tier would then bind the default with no cook involved — which the owner forbids.
    it('holds a default band that meets the bar, where any other rung would be authorized', () => {
        const perfect = stats(BAND_MINIMUM_OBSERVATIONS * 2, 0);

        expect(decideBandAuthority('observing', perfect, 'head')).toBe('authorize');
        expect(decideBandAuthority('observing', perfect, 'default')).toBe('hold');
        expect(decideBandAuthority('revoked', perfect, 'default')).toBe('hold');
    });

    it('revokes a default band found authorized, however good its record', () => {
        expect(decideBandAuthority('authorized', stats(BAND_MINIMUM_OBSERVATIONS * 2, 0), 'default')).toBe('revoke');
    });
});

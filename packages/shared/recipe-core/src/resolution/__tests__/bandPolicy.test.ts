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

const stats = (agreements: number, disagreements: number) => ({ agreements, disagreements });

describe('decideBandAuthority — grant, hold, revoke (KTD-B truth table)', () => {
    it('grants only at or above the bar over at least the minimum observations', () => {
        const n = BAND_MINIMUM_OBSERVATIONS;

        expect(decideBandAuthority('observing', stats(n, 0))).toBe('authorize');
        // one disagreement below the bar at minimum n holds
        expect(decideBandAuthority('observing', stats(n - 1, Math.ceil(n * (1 - BAND_AGREEMENT_BAR)) + 1))).toBe(
            'hold',
        );
    });

    it('holds below the minimum observation count, however perfect the agreement', () => {
        expect(decideBandAuthority('observing', stats(BAND_MINIMUM_OBSERVATIONS - 1, 0))).toBe('hold');
        expect(decideBandAuthority('observing', stats(1, 0))).toBe('hold');
        expect(decideBandAuthority('observing', stats(0, 0))).toBe('hold');
    });

    it('revokes an authorized band the moment its rate falls below the bar', () => {
        // Post-grant evidence: shadow disagreements count against the SAME stats.
        const n = BAND_MINIMUM_OBSERVATIONS;
        const disagreements = Math.ceil((n + 10) * (1 - BAND_AGREEMENT_BAR)) + 1;

        expect(decideBandAuthority('authorized', stats(n + 10 - disagreements, disagreements))).toBe('revoke');
    });

    it('keeps an authorized band that stays at the bar', () => {
        expect(decideBandAuthority('authorized', stats(BAND_MINIMUM_OBSERVATIONS * 2, 0))).toBe('hold');
    });

    it('a revoked band re-earns through the same gate as a fresh one — never a shortcut', () => {
        expect(decideBandAuthority('revoked', stats(BAND_MINIMUM_OBSERVATIONS, 0))).toBe('authorize');
        expect(decideBandAuthority('revoked', stats(BAND_MINIMUM_OBSERVATIONS - 1, 0))).toBe('hold');
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
    it('buckets a margin into a closed, labelled range', () => {
        expect(marginBandOf(0)).toBe('0.00-0.05');
        expect(marginBandOf(0.049)).toBe('0.00-0.05');
        expect(marginBandOf(0.05)).toBe('0.05-0.15');
        expect(marginBandOf(0.1499)).toBe('0.05-0.15');
        expect(marginBandOf(0.15)).toBe('0.15+');
        expect(marginBandOf(0.9)).toBe('0.15+');
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

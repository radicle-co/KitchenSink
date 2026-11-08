/**
 * The gate's band feedback (plan U3) — the verdict-to-observation mapping and the lookup discipline.
 *
 * ⛔ The mapping's two refusals are the point:
 *
 *  1. A verdict whose aspects did NOT include `identity` says nothing about the lexical bind — counting a
 *     quantity disagreement as a bind disagreement would revoke bands for reasons that are not theirs.
 *     (The CONVERSE over-count is accepted and documented in `bandVerdictFor`: an identity-including
 *     verdict may still disagree about quantity, and that ambiguity falls toward `disagree` — the safe
 *     direction, which costs money rather than correctness.)
 *  2. `inconclusive` is ABSENCE, not dissent — ADR-0026 §3's rule, one layer up.
 */
import { describe, expect, it, vi } from 'vitest';

import { bandVerdictFor, createBandFeedback, type BandQueryable } from '../bandFeedback.js';

/** A queryable double answering each call from `answers` in order, then empty. */
function dbDouble(answers: readonly Record<string, unknown>[][]): {
    db: BandQueryable;
    query: ReturnType<typeof vi.fn>;
} {
    const remaining = [...answers];
    const query = vi.fn().mockImplementation(() => Promise.resolve({ rows: remaining.shift() ?? [] }));

    return { db: { query } as unknown as BandQueryable, query };
}

/** The band a message names (ADR-0071): the key the observation and the authority read are both made under. */
const BAND_KEY = {
    rung: 'head',
    marginBand: 'ge-0.9-rung',
    queryShape: 'single-token',
    rankerVersion: 'ladder-v2-comma-head',
} as const;

/** Whether any statement the double received read the shared resolution events. */
const readResolutionEvents = (query: ReturnType<typeof vi.fn>): boolean =>
    query.mock.calls.some(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('ingredient_resolutions'),
    );

describe('bandVerdictFor — the verdict-to-observation mapping', () => {
    it('maps an identity-checked verified verdict to agree', () => {
        expect(bandVerdictFor('verified', ['identity', 'quantity'])).toBe('agree');
    });

    it('maps an identity-checked contradiction to disagree', () => {
        expect(bandVerdictFor('contradicted', ['identity'])).toBe('disagree');
    });

    it('⛔ a verdict that never asked about identity is not an observation at all', () => {
        expect(bandVerdictFor('verified', ['quantity'])).toBeUndefined();
        expect(bandVerdictFor('contradicted', ['quantity', 'unit'])).toBeUndefined();
    });

    it('⛔ inconclusive is absence, never dissent', () => {
        expect(bandVerdictFor('inconclusive', ['identity'])).toBeUndefined();
    });
});

/**
 * The band is the one the MESSAGE names (ADR-0071), never one looked up.
 *
 * Rewritten from "the lookup discipline": the feedback used to find a verdict's band from the food's latest lexical
 * `ingredient_resolutions` event, a row every cook who bound that food shares, so one cook's verdict moved a band
 * another cook was ranked in. These cases prove the key is the caller's and that the shared events are never read.
 */
describe('createBandFeedback — the band the message names', () => {
    it('records nothing without a mappable verdict — not a single statement', async () => {
        const { db, query } = dbDouble([]);

        await createBandFeedback(db).record({ bandKey: BAND_KEY, band: 'inconclusive', aspects: ['identity'] });

        expect(query).not.toHaveBeenCalled();
    });

    it('records an agree observation under the band the message named, and reads no resolution event', async () => {
        const { db, query } = dbDouble([]);

        await createBandFeedback(db).record({ bandKey: BAND_KEY, band: 'verified', aspects: ['identity'] });

        const observationCall = query.mock.calls.find(
            (call: unknown[]) =>
                typeof call[0] === 'string' && (call[0] as string).includes('resolution_band_observations'),
        );
        expect(observationCall?.[1]).toEqual([
            'head',
            'ge-0.9-rung',
            'single-token',
            'ladder-v2-comma-head',
            'agree',
            'gate',
        ]);
        expect(readResolutionEvents(query)).toBe(false);
    });

    it('files a shadow-sampled observation under the shadow source', async () => {
        const { db, query } = dbDouble([]);

        await createBandFeedback(db).record({
            bandKey: BAND_KEY,
            band: 'contradicted',
            aspects: ['identity'],
            shadowSample: true,
        });

        const observationCall = query.mock.calls.find(
            (call: unknown[]) =>
                typeof call[0] === 'string' && (call[0] as string).includes('resolution_band_observations'),
        );
        expect(observationCall?.[1]).toEqual(expect.arrayContaining(['disagree', 'shadow']));
    });

    it('⚠️ swallows a storage failure — band feedback must never fail a handler whose call is billed', async () => {
        const query = vi.fn().mockRejectedValue(new Error('connection reset'));
        const db = { query } as unknown as BandQueryable;

        await expect(
            createBandFeedback(db).record({ bandKey: BAND_KEY, band: 'verified', aspects: ['identity'] }),
        ).resolves.toBeUndefined();
    });
});

/**
 * `authorityFor` — the READ side, and the one KTD-A leans on.
 *
 * ⛔ Every answer other than a granted authority must be `undefined`, because `undefined` is what makes the line
 * VERIFY: a band that has never crossed a threshold (no row) and a read that FAILED. If a connection reset propagated,
 * the handler would fail a billed call; if it were ever "fail open", a database outage would skip verification for
 * every line at once.
 */
describe('createBandFeedback — authorityFor, the fail-closed read', () => {
    it('returns the stored authority for the band the message named, with no resolution lookup', async () => {
        const { db, query } = dbDouble([[{ state: 'authorized', epoch: 3 }]]);

        await expect(createBandFeedback(db).authorityFor(BAND_KEY)).resolves.toEqual({
            state: 'authorized',
            epoch: 3,
        });
        expect(query).toHaveBeenCalledTimes(1);
        expect(readResolutionEvents(query)).toBe(false);
    });

    it('is undefined for a band that has never crossed a threshold — an absent row reads as verify', async () => {
        const { db } = dbDouble([[]]);

        await expect(createBandFeedback(db).authorityFor(BAND_KEY)).resolves.toBeUndefined();
    });

    it('⛔ FAILS CLOSED — a failed read returns undefined so the line verifies, and never throws', async () => {
        const query = vi.fn().mockRejectedValue(new Error('connection reset'));
        const db = { query } as unknown as BandQueryable;

        await expect(createBandFeedback(db).authorityFor(BAND_KEY)).resolves.toBeUndefined();
    });
});

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

/** The latest-lexical-resolution row the lookup answers with. */
const LEXICAL_ROW = {
    rung: 'head',
    margin: '0.21',
    query_shape: 'single-token',
    ranker_version: 'ladder-v2-comma-head',
};

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

describe('createBandFeedback — the lookup discipline', () => {
    it('records nothing without a mappable verdict — not even the lookup', async () => {
        const { db, query } = dbDouble([]);

        await createBandFeedback(db).record({ foodId: 'f-1', band: 'inconclusive', aspects: ['identity'] });

        expect(query).not.toHaveBeenCalled();
    });

    it('records nothing when the food has no lexical resolution — absence, not a default band', async () => {
        const { db, query } = dbDouble([[]]);

        await createBandFeedback(db).record({ foodId: 'f-1', band: 'verified', aspects: ['identity'] });

        expect(query).toHaveBeenCalledTimes(1);
    });

    it('records an agree observation under the band the RESOLUTION was made in', async () => {
        const { db, query } = dbDouble([[LEXICAL_ROW]]);

        await createBandFeedback(db).record({ foodId: 'f-1', band: 'verified', aspects: ['identity'] });

        const observationCall = query.mock.calls.find(
            (call: unknown[]) =>
                typeof call[0] === 'string' && (call[0] as string).includes('resolution_band_observations'),
        );
        expect(observationCall).toBeDefined();
        expect(observationCall?.[1]).toEqual([
            'head',
            '0.15+',
            'single-token',
            'ladder-v2-comma-head',
            'agree',
            'gate',
        ]);
    });

    it('⚠️ swallows a storage failure — band feedback must never fail a handler whose call is billed', async () => {
        const query = vi.fn().mockRejectedValue(new Error('connection reset'));
        const db = { query } as unknown as BandQueryable;

        await expect(
            createBandFeedback(db).record({ foodId: 'f-1', band: 'verified', aspects: ['identity'] }),
        ).resolves.toBeUndefined();
    });

    it('a resolution recorded before U4 populated the ranked fields is absence, not a null band', async () => {
        const { db, query } = dbDouble([[{ rung: null, margin: null, query_shape: null, ranker_version: null }]]);

        await createBandFeedback(db).record({ foodId: 'f-1', band: 'verified', aspects: ['identity'] });

        expect(query).toHaveBeenCalledTimes(1);
    });
});

/**
 * `authorityForFood` — the READ side, and the one KTD-A leans on.
 *
 * ⛔ Every answer other than a granted authority must be `undefined`, because `undefined` is what makes the
 * line VERIFY. The three ways to reach it are a food with no lexical bind, a band that has never crossed a
 * threshold (no row — `authorityFor`'s own documented "absent row reads as verify"), and a read that FAILED.
 * The third is the one that matters: if a connection reset propagated, the handler would fail a billed call;
 * if it were ever "fail open", a database outage would silently skip verification for every line at once —
 * the failure correlated with the moment verification matters most.
 *
 * Nothing executed this function before: `verifyLine.test.ts` supplies its own `authorityForFood` spy, so
 * every reference to it outside this file was a mock of it rather than a run of it.
 */
describe('createBandFeedback — authorityForFood, the fail-closed read', () => {
    it('is undefined when the food has no lexical resolution, and never asks the store', async () => {
        const { db, query } = dbDouble([[]]);

        await expect(createBandFeedback(db).authorityForFood('f-1')).resolves.toBeUndefined();
        // One query: the lexical lookup. A band that does not exist has no authority to look up.
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('returns the stored authority for the band the resolution was made in', async () => {
        const { db, query } = dbDouble([[LEXICAL_ROW], [{ state: 'authorized', epoch: 3 }]]);

        await expect(createBandFeedback(db).authorityForFood('f-1')).resolves.toEqual({
            state: 'authorized',
            epoch: 3,
        });
        expect(query).toHaveBeenCalledTimes(2);
    });

    it('is undefined for a band that has never crossed a threshold — an absent row reads as verify', async () => {
        const { db } = dbDouble([[LEXICAL_ROW], []]);

        await expect(createBandFeedback(db).authorityForFood('f-1')).resolves.toBeUndefined();
    });

    it('⛔ FAILS CLOSED — a failed read returns undefined so the line verifies, and never throws', async () => {
        const query = vi.fn().mockRejectedValue(new Error('connection reset'));
        const db = { query } as unknown as BandQueryable;

        await expect(createBandFeedback(db).authorityForFood('f-1')).resolves.toBeUndefined();
    });
});

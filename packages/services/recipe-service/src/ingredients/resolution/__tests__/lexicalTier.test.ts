/**
 * TIER 2 of the resolution cascade — the lexical shortlist-builder (plan U4, KTD-A).
 *
 * ⛔ The design under test is ZERO INITIAL AUTHORITY: this tier proposes its top-ranked candidate on ANY
 * non-empty candidate set — it never applies a confidence threshold of its own, because safety lives at
 * the verification gate (every zero-authority lexical bind withholds as `pending-verification` until the
 * gate agrees), not in a tier-side cutoff. What the tier owes the gate is EVIDENCE: the structured
 * shortlist, the margin, and the top hit's ladder rung.
 */
import { describe, expect, it, vi } from 'vitest';

import type { CatalogSearchOutcome } from '../../foodCatalog.gateway.js';
import { decideLexicalTier, reformulateQuery, shouldReformulate, createLexicalTier } from '../lexicalTier.js';

const HITS = [
    { foodId: 'F-FLOUR', name: 'Flour, wheat, all-purpose', score: 0.91 },
    { foodId: 'F-CAROB', name: 'Carob flour', score: 0.62 },
    { foodId: 'F-RICE', name: 'Rice flour', score: 0.6 },
] as const;

describe('decideLexicalTier — the pure judgement', () => {
    it('passes on an empty candidate set', () => {
        const outcome = decideLexicalTier('flour', []);

        expect(outcome.kind).toBe('pass');
    });

    it('resolves the TOP hit on any non-empty set, with the margin in the reserved confidence field', () => {
        const outcome = decideLexicalTier('flour', HITS);

        expect(outcome).toMatchObject({
            kind: 'resolved',
            tier: 'lexical',
            foodId: 'F-FLOUR',
            confidence: expect.closeTo(0.29, 5),
            rung: 'head',
        });
    });

    it('a singleton shortlist resolves with NO margin — a missing runner-up is not a margin of zero', () => {
        const outcome = decideLexicalTier('flour', [HITS[0]]);

        expect(outcome).toMatchObject({ kind: 'resolved', confidence: undefined });
    });

    it('carries the structured shortlist as ScoredCandidate[] for the gate and the event log', () => {
        const outcome = decideLexicalTier('flour', HITS);

        expect(outcome.kind === 'resolved' && outcome.shortlist).toEqual([
            { foodId: 'F-FLOUR', score: 0.91 },
            { foodId: 'F-CAROB', score: 0.62 },
            { foodId: 'F-RICE', score: 0.6 },
        ]);
    });

    it('names the rung and candidate count in the human-readable evidence', () => {
        const outcome = decideLexicalTier('flour', HITS);

        expect(outcome.kind === 'resolved' && outcome.evidence).toMatch(/lexical.*head.*3 candidate/);
    });
});

describe('reformulateQuery — the deterministic synonym retry (origin D11)', () => {
    it('maps a curated synonym token', () => {
        expect(reformulateQuery('aubergine')).toBe('eggplant');
    });

    it('maps inside a multi-word phrase', () => {
        expect(reformulateQuery('roasted aubergine')).toBe('roasted eggplant');
    });

    it('answers undefined for a phrase the map does not change — no pointless second query', () => {
        expect(reformulateQuery('flour')).toBeUndefined();
    });
});

describe('shouldReformulate', () => {
    it('reformulates on an empty candidate set', () => {
        expect(shouldReformulate('aubergine', [])).toBe(true);
    });

    it('reformulates when every candidate sits on the base rung — nothing structural matched', () => {
        expect(shouldReformulate('aubergine', [{ foodId: 'F', name: 'Bergamot oil', score: 0.3 }])).toBe(true);
    });

    it('does NOT reformulate when a structural rung was reached', () => {
        expect(shouldReformulate('flour', HITS)).toBe(false);
    });
});

describe('createLexicalTier — the adapter', () => {
    const outcomeOf = (hits: CatalogSearchOutcome['hits'], availability = 'ok' as const): CatalogSearchOutcome => ({
        hits,
        availability,
    });

    const CALLER = { kind: 'caller-token' } as never;

    it('searches AS the caller and resolves from the ranked hits', async () => {
        const search = vi.fn().mockResolvedValue(outcomeOf([...HITS]));
        const tier = createLexicalTier({ search } as never);

        const outcome = await tier.resolve(
            { key: 'flour' as never, phrase: 'flour' },
            { userId: 'u1', caller: CALLER },
        );

        expect(outcome).toMatchObject({ kind: 'resolved', foodId: 'F-FLOUR' });
        expect(search).toHaveBeenCalledWith(CALLER, 'flour', expect.any(Number), { withNutrition: true });
    });

    it('retries ONCE through the synonym map on an empty first pass, and says so in the evidence', async () => {
        const search = vi
            .fn()
            .mockResolvedValueOnce(outcomeOf([]))
            .mockResolvedValueOnce(outcomeOf([{ foodId: 'F-EGGPLANT', name: 'Eggplant, raw', score: 0.9 }]));
        const tier = createLexicalTier({ search } as never);

        const outcome = await tier.resolve(
            { key: 'aubergine' as never, phrase: 'aubergine' },
            { userId: 'u1', caller: CALLER },
        );

        expect(outcome).toMatchObject({ kind: 'resolved', foodId: 'F-EGGPLANT' });
        expect(outcome.kind === 'resolved' && outcome.evidence).toMatch(/eggplant/);
        expect(search).toHaveBeenCalledTimes(2);
    });

    it('an unknown word still passes cleanly — one query, no reformulation to try', async () => {
        const search = vi.fn().mockResolvedValue(outcomeOf([]));
        const tier = createLexicalTier({ search } as never);

        const outcome = await tier.resolve(
            { key: 'blorvik' as never, phrase: 'blorvik' },
            { userId: 'u1', caller: CALLER },
        );

        expect(outcome.kind).toBe('pass');
        expect(search).toHaveBeenCalledTimes(1);
    });

    it('⛔ THROWS on an unavailable catalog, so the cascade records "could not look", never a false pass', async () => {
        const search = vi.fn().mockResolvedValue({ hits: [], availability: 'unavailable' });
        const tier = createLexicalTier({ search } as never);

        await expect(
            tier.resolve({ key: 'flour' as never, phrase: 'flour' }, { userId: 'u1', caller: CALLER }),
        ).rejects.toThrow(/unavailable/);
    });

    it('passes quietly when the catalog blend is DISABLED — an operator switch is not an outage', async () => {
        const search = vi.fn().mockResolvedValue({ hits: [], availability: 'disabled' });
        const tier = createLexicalTier({ search } as never);

        const outcome = await tier.resolve(
            { key: 'flour' as never, phrase: 'flour' },
            { userId: 'u1', caller: CALLER },
        );

        expect(outcome.kind).toBe('pass');
    });

    it('an unattended import (no caller) degrades like a down catalog — the gateway declines to call', async () => {
        // The REAL gateway answers `unavailable` without issuing a request when the caller is undefined;
        // the tier then throws, and the cascade records the tier as unavailable rather than passing.
        const search = vi.fn().mockResolvedValue({ hits: [], availability: 'unavailable' });
        const tier = createLexicalTier({ search } as never);

        await expect(
            tier.resolve({ key: 'flour' as never, phrase: 'flour' }, { userId: undefined, caller: undefined }),
        ).rejects.toThrow();
    });
});

/**
 * THE LEXICAL TIER of the resolution cascade — the shortlist-builder (plan U4, KTD-A).
 *
 * ⛔ The design under test is ZERO INITIAL AUTHORITY: this tier proposes its top-ranked candidate on ANY
 * non-empty candidate set — it never applies a confidence threshold of its own, because safety lives at
 * the verification gate (every zero-authority lexical bind withholds as `pending-verification` until the
 * gate agrees), not in a tier-side cutoff. What the tier owes the gate is EVIDENCE: the structured
 * shortlist, the margin, and the top hit's ladder rung.
 */
import { describe, expect, it, vi } from 'vitest';

import type { CatalogSearchOutcome } from '../../foodCatalog.gateway.js';
import {
    countUnrankedHits,
    createLexicalTier,
    decideLexicalTier,
    reformulateQuery,
    shouldReformulate,
} from '../lexicalTier.js';

const HITS = [
    { foodId: 'F-FLOUR', name: 'Flour, wheat, all-purpose', score: 0.91, rung: 'head' },
    { foodId: 'F-CAROB', name: 'Carob flour', score: 0.62, rung: 'head' },
    { foodId: 'F-RICE', name: 'Rice flour', score: 0.6, rung: 'head' },
] as const;

describe('decideLexicalTier — the pure judgement', () => {
    it('passes on an empty candidate set', () => {
        const outcome = decideLexicalTier([]);

        expect(outcome.kind).toBe('pass');
    });

    it('resolves the TOP hit on any non-empty set, with the margin in the reserved confidence field', () => {
        const outcome = decideLexicalTier(HITS);

        expect(outcome).toMatchObject({
            kind: 'resolved',
            tier: 'lexical',
            food: { kind: 'root', id: 'F-FLOUR' },
            confidence: expect.closeTo(0.29, 5),
            rung: 'head',
        });
    });

    it('⛔ R23: a top hit whose words name exactly ONE variant resolves to that variant (curated U9)', () => {
        const outcome = decideLexicalTier([
            { foodId: 'R-TOMATO', variantId: 'V-PASTE', name: 'tomatoes', score: 0.93 },
            { foodId: 'R-PUREE', name: 'tomato puree', score: 0.6 },
        ]);

        expect(outcome).toMatchObject({ kind: 'resolved', food: { kind: 'variant', id: 'V-PASTE' } });
        // The shortlist still ranks ROOTS — its margin says which root won, never which variant.
        expect(outcome.kind === 'resolved' && outcome.shortlist?.map((candidate) => candidate.foodId)).toStrictEqual([
            'R-TOMATO',
            'R-PUREE',
        ]);
    });

    it('a variant on a RUNNER-UP is not the answer — only the top hit binds', () => {
        const outcome = decideLexicalTier([
            { foodId: 'R-TOMATO', name: 'tomatoes', score: 0.93 },
            { foodId: 'R-PASTE', variantId: 'V-X', name: 'tomato products', score: 0.6 },
        ]);

        expect(outcome).toMatchObject({ kind: 'resolved', food: { kind: 'root', id: 'R-TOMATO' } });
    });

    it('⛔ RECORDS the rung food published rather than classifying the name a second time (ADR-0070)', () => {
        // `sugar` would classify at `head` for this query here; food said `synonym`, and food's SQL is the one
        // authority for the rung, so that is what the band key records.
        const outcome = decideLexicalTier([{ foodId: 'F-SUGAR', name: 'sugar', score: 0.75, rung: 'synonym' }]);

        expect(outcome).toMatchObject({ kind: 'resolved', rung: 'synonym' });
    });

    it('records NO rung for a crosswalk hit, which matched an identifier rather than a name', () => {
        const outcome = decideLexicalTier([{ foodId: 'F-BAR', name: 'cereal bar', score: 1 }]);

        expect(outcome.kind).toBe('resolved');
        expect(outcome.kind === 'resolved' ? outcome.rung : 'n/a').toBeUndefined();
    });

    it('a singleton shortlist resolves with NO margin — a missing runner-up is not a margin of zero', () => {
        const outcome = decideLexicalTier([HITS[0]]);

        expect(outcome).toMatchObject({ kind: 'resolved', confidence: undefined });
    });

    it('carries the structured shortlist as ScoredCandidate[] for the gate and the event log', () => {
        const outcome = decideLexicalTier(HITS);

        expect(outcome.kind === 'resolved' && outcome.shortlist).toEqual([
            { foodId: 'F-FLOUR', score: 0.91 },
            { foodId: 'F-CAROB', score: 0.62 },
            { foodId: 'F-RICE', score: 0.6 },
        ]);
    });

    it('names the rung and candidate count in the human-readable evidence', () => {
        const outcome = decideLexicalTier(HITS);

        expect(outcome.kind === 'resolved' && outcome.evidence).toMatch(/lexical.*head.*3 candidate/);
    });
});

/**
 * R20 (plan U11) — the author-augmentation flag.
 *
 * ⛔ The flag is about the SHORTLIST, not the winner: a private hit ANYWHERE in the set means these margins
 * describe one user's catalog rather than the shared ranker, so the resolution is excluded from shared band
 * statistics even when the top hit is a public catalog row.
 */
describe('decideLexicalTier — author augmentation (R20)', () => {
    const PRIVATE = { foodId: 'F-MINE', name: 'Gran’s pie filling', score: 0.95, visibility: 'private' } as const;

    it('is false for a shortlist of ordinary catalog rows', () => {
        expect(decideLexicalTier(HITS)).toMatchObject({ authorAugmented: false });
    });

    it('is true when the WINNER is the caller’s own private food', () => {
        expect(decideLexicalTier([PRIVATE, ...HITS])).toMatchObject({ authorAugmented: true });
    });

    it('is true when a private row sits BELOW the winner — the flag describes the whole shortlist', () => {
        expect(decideLexicalTier([HITS[0], PRIVATE])).toMatchObject({
            food: { kind: 'root', id: 'F-FLOUR' },
            authorAugmented: true,
        });
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
        expect(shouldReformulate([])).toBe(true);
    });

    it('reformulates when every candidate sits on the base rung — nothing structural matched', () => {
        expect(shouldReformulate([{ foodId: 'F', name: 'Bergamot oil', score: 0.3, rung: 'base' }])).toBe(true);
    });

    it('does NOT reformulate when a structural rung was reached', () => {
        expect(shouldReformulate(HITS)).toBe(false);
    });

    it('does NOT reformulate past a crosswalk hit, whose identifier match carries no rung', () => {
        expect(shouldReformulate([{ foodId: 'F-BAR', name: 'cereal bar', score: 1 }])).toBe(false);
    });

    // ⛔ An absent rung below score 1 is UNKNOWN, not a crosswalk: a food older than this service, or a rung this build
    // cannot read, publishes none. Reading it as "structural" would silently switch the D11 retry off for every query.
    it('DOES reformulate when every hit carries an UNKNOWN rung (no rung, score below 1)', () => {
        expect(shouldReformulate([{ foodId: 'F', name: 'Aubergine dip', score: 0.4 }])).toBe(true);
    });

    it('DOES reformulate over a mix of base and unknown rungs — nothing KNOWN to be structural matched', () => {
        expect(
            shouldReformulate([
                { foodId: 'F1', name: 'Bergamot oil', score: 0.3, rung: 'base' },
                { foodId: 'F2', name: 'Bergamot tea', score: 0.2 },
            ]),
        ).toBe(true);
    });

    it('does NOT reformulate when an unknown-rung hit sits beside a structural one', () => {
        expect(shouldReformulate([{ foodId: 'F2', name: 'Flour mix', score: 0.2 }, ...HITS])).toBe(false);
    });

    it('does NOT reformulate when a crosswalk hit leads unknown-rung hits', () => {
        expect(
            shouldReformulate([
                { foodId: 'F-BAR', name: 'cereal bar', score: 1 },
                { foodId: 'F2', name: 'cereal', score: 0.2 },
            ]),
        ).toBe(false);
    });
});

describe('countUnrankedHits — the visibility signal for rung-less name hits', () => {
    it('counts the hits with no rung below score 1, and never a crosswalk hit', () => {
        expect(
            countUnrankedHits([
                { foodId: 'F-BAR', name: 'cereal bar', score: 1 },
                { foodId: 'F2', name: 'cereal', score: 0.2 },
                { foodId: 'F3', name: 'cereal flakes', score: 0.1 },
                { foodId: 'F4', name: 'cereal mix', score: 0.1, rung: 'head' },
            ]),
        ).toBe(2);
    });

    it('is zero when every hit carries a rung', () => {
        expect(countUnrankedHits(HITS)).toBe(0);
    });
});

describe('createLexicalTier — the adapter', () => {
    const outcomeOf = (hits: CatalogSearchOutcome['hits'], availability = 'ok' as const): CatalogSearchOutcome => ({
        hits,
        availability,
    });

    const CALLER = { kind: 'caller-token' } as never;
    const NO_OBSERVER = { onUnrankedHits: () => undefined };

    it('reports how many hits arrived with no rung, so a food that stopped publishing rungs is visible', async () => {
        const search = vi.fn().mockResolvedValue(
            outcomeOf([
                { foodId: 'F-FLOUR', name: 'Flour, wheat', score: 0.9 },
                { foodId: 'F-RICE', name: 'Rice flour', score: 0.6 },
            ]),
        );
        const onUnrankedHits = vi.fn();
        const tier = createLexicalTier({ search } as never, { onUnrankedHits });

        const outcome = await tier.resolve(
            { key: 'flour' as never, phrase: 'flour' },
            { userId: 'u1', caller: CALLER },
        );

        expect(onUnrankedHits).toHaveBeenCalledWith(2);
        // The shortlist and margin survive a missing rung: they are facts about the scores, not the rung.
        expect(outcome).toMatchObject({ kind: 'resolved', rung: undefined, confidence: expect.closeTo(0.3, 6) });
        expect(outcome.kind === 'resolved' ? outcome.shortlist?.length : 0).toBe(2);
    });

    it('reports nothing when every hit carries a rung', async () => {
        const search = vi.fn().mockResolvedValue(outcomeOf([...HITS]));
        const onUnrankedHits = vi.fn();

        await createLexicalTier({ search } as never, { onUnrankedHits }).resolve(
            { key: 'flour' as never, phrase: 'flour' },
            { userId: 'u1', caller: CALLER },
        );

        expect(onUnrankedHits).not.toHaveBeenCalled();
    });

    it('still runs the synonym retry when the first pass carries only UNKNOWN rungs', async () => {
        const search = vi
            .fn()
            .mockResolvedValueOnce(outcomeOf([{ foodId: 'F-DIP', name: 'Aubergine dip', score: 0.3 }]))
            .mockResolvedValueOnce(outcomeOf([{ foodId: 'F-EGGPLANT', name: 'Eggplant, raw', score: 0.9 }]));
        const tier = createLexicalTier({ search } as never, NO_OBSERVER);

        const outcome = await tier.resolve(
            { key: 'aubergine' as never, phrase: 'aubergine' },
            { userId: 'u1', caller: CALLER },
        );

        expect(search).toHaveBeenCalledTimes(2);
        expect(outcome).toMatchObject({ kind: 'resolved', food: { kind: 'root', id: 'F-EGGPLANT' } });
    });

    it('searches AS the caller and resolves from the ranked hits', async () => {
        const search = vi.fn().mockResolvedValue(outcomeOf([...HITS]));
        const tier = createLexicalTier({ search } as never, NO_OBSERVER);

        const outcome = await tier.resolve(
            { key: 'flour' as never, phrase: 'flour' },
            { userId: 'u1', caller: CALLER },
        );

        expect(outcome).toMatchObject({ kind: 'resolved', food: { kind: 'root', id: 'F-FLOUR' } });
        expect(search).toHaveBeenCalledWith(CALLER, 'flour', expect.any(Number), { withNutrition: true });
    });

    it('retries ONCE through the synonym map on an empty first pass, and says so in the evidence', async () => {
        const search = vi
            .fn()
            .mockResolvedValueOnce(outcomeOf([]))
            .mockResolvedValueOnce(outcomeOf([{ foodId: 'F-EGGPLANT', name: 'Eggplant, raw', score: 0.9 }]));
        const tier = createLexicalTier({ search } as never, NO_OBSERVER);

        const outcome = await tier.resolve(
            { key: 'aubergine' as never, phrase: 'aubergine' },
            { userId: 'u1', caller: CALLER },
        );

        expect(outcome).toMatchObject({ kind: 'resolved', food: { kind: 'root', id: 'F-EGGPLANT' } });
        expect(outcome.kind === 'resolved' && outcome.evidence).toMatch(/eggplant/);
        expect(search).toHaveBeenCalledTimes(2);
    });

    it('an unknown word still passes cleanly — one query, no reformulation to try', async () => {
        const search = vi.fn().mockResolvedValue(outcomeOf([]));
        const tier = createLexicalTier({ search } as never, NO_OBSERVER);

        const outcome = await tier.resolve(
            { key: 'blorvik' as never, phrase: 'blorvik' },
            { userId: 'u1', caller: CALLER },
        );

        expect(outcome.kind).toBe('pass');
        expect(search).toHaveBeenCalledTimes(1);
    });

    it('⛔ THROWS on an unavailable catalog, so the cascade records "could not look", never a false pass', async () => {
        const search = vi.fn().mockResolvedValue({ hits: [], availability: 'unavailable' });
        const tier = createLexicalTier({ search } as never, NO_OBSERVER);

        await expect(
            tier.resolve({ key: 'flour' as never, phrase: 'flour' }, { userId: 'u1', caller: CALLER }),
        ).rejects.toThrow(/unavailable/);
    });

    it('passes quietly when the catalog blend is DISABLED — an operator switch is not an outage', async () => {
        const search = vi.fn().mockResolvedValue({ hits: [], availability: 'disabled' });
        const tier = createLexicalTier({ search } as never, NO_OBSERVER);

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
        const tier = createLexicalTier({ search } as never, NO_OBSERVER);

        await expect(
            tier.resolve({ key: 'flour' as never, phrase: 'flour' }, { userId: undefined, caller: undefined }),
        ).rejects.toThrow();
    });
});

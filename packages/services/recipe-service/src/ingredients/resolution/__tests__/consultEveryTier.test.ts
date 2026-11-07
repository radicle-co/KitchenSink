/**
 * Unit tests for `consultEveryTier` — the read-only sibling of `runResolutionCascade`.
 *
 * `runResolutionCascade` is first-wins: a resolved tier ENDS the chain, which is what binding needs. The editor's name
 * proposals want every tier's answer, so the cook sees what each source remembers. The two loops must not be merged
 * (a flag on the cascade would be a boolean selecting behaviour), so this file pins what only the new loop does:
 * it never stops at a resolution, it keeps the tier order, and a failing tier is reported and skipped.
 */
import { describe, expect, it, vi } from 'vitest';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import {
    consultEveryTier,
    type ResolutionContext,
    type ResolutionQuery,
    type ResolutionTier,
    type TierOutcome,
} from '../resolutionCascade.js';

const QUERY: ResolutionQuery = { key: normalizedIngredientKey('milk')!, phrase: 'milk' };
const CONTEXT: ResolutionContext = { userId: 'USER-1', caller: undefined, signal: undefined };

const resolvedBy = (tier: 'curated' | 'memo' | 'lexical', id: string): TierOutcome => ({
    kind: 'resolved',
    tier,
    food: { kind: 'root', id },
    evidence: `${tier} said ${id}`,
});

const passedBy = (tier: 'curated' | 'memo' | 'lexical'): TierOutcome => ({ kind: 'pass', tier, reason: 'nothing' });

const tierAnswering = (id: 'curated' | 'memo' | 'lexical', outcome: TierOutcome): ResolutionTier => ({
    id,
    resolve: vi.fn(async () => outcome),
});

describe('consultEveryTier', () => {
    it('asks EVERY tier even when an earlier one resolved, which is what first-wins binding must never do', async () => {
        const memo = tierAnswering('memo', resolvedBy('memo', 'FOOD-M'));
        const curated = tierAnswering('curated', resolvedBy('curated', 'FOOD-C'));

        const result = await consultEveryTier([curated, memo], QUERY, CONTEXT, { onTierFailure: vi.fn() });

        expect(curated.resolve).toHaveBeenCalledTimes(1);
        expect(memo.resolve).toHaveBeenCalledTimes(1);
        expect(result.outcomes.map((outcome) => outcome.tier)).toStrictEqual(['curated', 'memo']);
        expect(result.unavailable).toStrictEqual([]);
    });

    it('returns passes too, in tier order, so a caller can see what each source said', async () => {
        const result = await consultEveryTier(
            [tierAnswering('curated', passedBy('curated')), tierAnswering('memo', resolvedBy('memo', 'FOOD-M'))],
            QUERY,
            CONTEXT,
            { onTierFailure: vi.fn() },
        );

        expect(result.outcomes.map((outcome) => outcome.kind)).toStrictEqual(['pass', 'resolved']);
    });

    it('hands each tier the query and the context unchanged, so an unattended caller stays unattended', async () => {
        const curated = tierAnswering('curated', passedBy('curated'));

        await consultEveryTier([curated], QUERY, { ...CONTEXT, userId: undefined }, { onTierFailure: vi.fn() });

        expect(curated.resolve).toHaveBeenCalledWith(QUERY, { ...CONTEXT, userId: undefined });
    });

    it('reports a tier whose I/O failed, names it unavailable, and still asks the tiers after it', async () => {
        const failure = new Error('database down');
        const broken: ResolutionTier = {
            id: 'curated',
            resolve: vi.fn(async () => {
                throw failure;
            }),
        };
        const memo = tierAnswering('memo', resolvedBy('memo', 'FOOD-M'));
        const onTierFailure = vi.fn();

        const result = await consultEveryTier([broken, memo], QUERY, CONTEXT, { onTierFailure });

        expect(onTierFailure).toHaveBeenCalledExactlyOnceWith('curated', failure);
        expect(result.unavailable).toStrictEqual(['curated']);
        expect(result.outcomes.map((outcome) => outcome.tier)).toStrictEqual(['memo']);
    });

    it('survives an observer that throws: observability is never an availability dependency', async () => {
        const broken: ResolutionTier = {
            id: 'memo',
            resolve: async () => {
                throw new Error('boom');
            },
        };

        await expect(
            consultEveryTier([broken], QUERY, CONTEXT, {
                onTierFailure: () => {
                    throw new Error('observer');
                },
            }),
        ).resolves.toStrictEqual({ outcomes: [], unavailable: ['memo'] });
    });

    it('answers an empty chain with nothing, not an error', async () => {
        await expect(consultEveryTier([], QUERY, CONTEXT, { onTierFailure: vi.fn() })).resolves.toStrictEqual({
            outcomes: [],
            unavailable: [],
        });
    });
});

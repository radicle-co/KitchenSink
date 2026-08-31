/**
 * Unit tests for TIER 1 — the curated-mapping tier (plan U10 / R11, R19, R22).
 *
 * Split per the pure-`decide` / impure-adapter convention: `decideCuratedTier` is the judgement and is
 * exhaustible as a table; `createCuratedTier` is the adapter, and the only thing it can get wrong is WHICH
 * QUERY it issues — which is why the adapter tests assert the arguments reaching the DAL rather than
 * re-testing the decision.
 *
 * The property that carries the requirement: **an unattended caller's `userId` reaches the DAL as
 * `undefined`, unchanged** (R22). A mutant substituting a placeholder, or defaulting it to the last seen
 * user, would let one user's private correction silently rewrite every unattended import — and no assertion
 * on the RESULT would notice, because the result would look perfectly reasonable.
 */
import { describe, expect, it, vi } from 'vitest';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import type { MappingInForce, ResolutionMappingsDal } from '../resolutionMappings.dal.js';
import { createCuratedTier, decideCuratedTier } from '../curatedTier.js';
import type { ResolutionQuery } from '../resolutionCascade.js';

const KEY = normalizedIngredientKey('plain flour')!;
const QUERY: ResolutionQuery = { key: KEY, phrase: 'Plain Flour' };
const AUTHOR = '01JU10TIER00000000000AUTHOR';

/** A mapping in force, of the given scope/origin. */
function inForce(overrides: Partial<MappingInForce> = {}): MappingInForce {
    return { id: 'row-1', foodId: 'FOOD-A', scope: 'global', origin: 'curator', ...overrides };
}

describe('decideCuratedTier — pure', () => {
    it('PASSES when nothing binds this phrase for this caller', () => {
        const outcome = decideCuratedTier(undefined);

        expect(outcome.kind).toBe('pass');
        expect(outcome.tier).toBe('curated');
        expect(outcome.kind === 'pass' && outcome.reason.length).toBeGreaterThan(0);
    });

    it.each([
        ['a curator’s global mapping', inForce({ scope: 'global', origin: 'curator' })],
        ['a corroborated global mapping', inForce({ scope: 'global', origin: 'corroboration' })],
        ['the caller’s own author-scoped mapping', inForce({ scope: 'author', origin: 'author' })],
    ])('RESOLVES on %s', (_label, mapping) => {
        const outcome = decideCuratedTier(mapping);

        expect(outcome.kind).toBe('resolved');
        expect(outcome.kind === 'resolved' && outcome.foodId).toBe('FOOD-A');
    });

    it('names the ORIGIN in its evidence, so a reviewer can tell a curator ruling from a machine one', () => {
        const outcome = decideCuratedTier(inForce({ origin: 'corroboration' }));

        expect(outcome.kind === 'resolved' && outcome.evidence).toContain('corroboration');
    });
});

describe('createCuratedTier — the adapter', () => {
    it('is registered as tier `curated`', () => {
        const dal = { findInForce: vi.fn() } as unknown as ResolutionMappingsDal;

        expect(createCuratedTier(dal).id).toBe('curated');
    });

    it('asks the DAL for the mapping in force for THIS caller', async () => {
        const findInForce = vi.fn().mockResolvedValue(inForce());
        const tier = createCuratedTier({ findInForce } as unknown as ResolutionMappingsDal);

        const outcome = await tier.resolve(QUERY, { userId: AUTHOR, caller: undefined });

        expect(findInForce).toHaveBeenCalledWith(KEY, AUTHOR);
        expect(outcome.kind === 'resolved' && outcome.foodId).toBe('FOOD-A');
    });

    it('⛔ passes an UNATTENDED caller through as `undefined`, never a substitute (R22)', async () => {
        const findInForce = vi.fn().mockResolvedValue(undefined);
        const tier = createCuratedTier({ findInForce } as unknown as ResolutionMappingsDal);

        await tier.resolve(QUERY, { userId: undefined, caller: undefined });

        // Asserted on the ARGUMENT, not the result: a mutant substituting a placeholder user would return a
        // perfectly reasonable-looking outcome while making one user's private correction rewrite every
        // unattended import.
        expect(findInForce).toHaveBeenCalledWith(KEY, undefined);
    });

    it('lets a DAL failure propagate — containment is the cascade’s job, not the tier’s', async () => {
        const findInForce = vi.fn().mockRejectedValue(new Error('connection reset'));
        const tier = createCuratedTier({ findInForce } as unknown as ResolutionMappingsDal);

        // Swallowing it here would report "no curated mapping exists" for a phrase that may well have one —
        // a miss and an outage reported identically. The cascade distinguishes them; the tier must not
        // pre-empt that by deciding for it.
        await expect(tier.resolve(QUERY, { userId: AUTHOR, caller: undefined })).rejects.toThrow('connection reset');
    });
});

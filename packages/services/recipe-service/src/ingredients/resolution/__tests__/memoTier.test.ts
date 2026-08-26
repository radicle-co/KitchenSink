/**
 * Unit tests for TIER 3 — the remembered-resolution tier (plan U10 / R11, R14).
 *
 * The tier the plan calls the knowledge base: exact key first, nearest neighbour second, and R14 is explicit
 * that "equality-only matching does not satisfy this requirement". The decision half asserted here is what
 * the tier does with what it finds; the k-NN search itself is only provable against a real Postgres with
 * `pg_trgm` and the GiST index, and lives in the DAL's integration suite.
 *
 * ⚠️ The floor lives in the DAL, not here, and that is deliberate: a k-NN scan over a non-empty table ALWAYS
 * returns a row, so a tier that decided "close enough" after the fact would still have paid for a
 * full-precision answer it then discarded. The bound belongs in the query.
 */
import { describe, expect, it, vi } from 'vitest';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import type { MemoHit, ResolutionMappingsDal } from '../resolutionMappings.dal.js';
import { createMemoTier, decideMemoTier } from '../memoTier.js';
import type { ResolutionQuery } from '../resolutionCascade.js';

const KEY = normalizedIngredientKey('all purpose flour')!;
const QUERY: ResolutionQuery = { key: KEY, phrase: 'all purpose flour' };

describe('decideMemoTier — pure', () => {
    it('PASSES when nothing is remembered close enough', () => {
        const outcome = decideMemoTier(undefined);

        expect(outcome.kind).toBe('pass');
        expect(outcome.tier).toBe('memo');
    });

    it.each([
        ['exact', { foodId: 'FOOD-A', match: 'exact', similarity: 1 } satisfies MemoHit],
        ['near', { foodId: 'FOOD-A', match: 'near', similarity: 0.72 } satisfies MemoHit],
    ])('RESOLVES on a %s hit', (_label, hit) => {
        const outcome = decideMemoTier(hit);

        expect(outcome.kind).toBe('resolved');
        expect(outcome.kind === 'resolved' && outcome.foodId).toBe('FOOD-A');
    });

    it('records HOW it matched and how closely, so a near hit is distinguishable after the fact', () => {
        // R14's near-twin path is the one most likely to be wrong in a way nobody notices, so the evidence a
        // resolution carries has to say it was approximate and by how much — otherwise every later audit of
        // "why did this line resolve here?" has only the food id to go on.
        const outcome = decideMemoTier({ foodId: 'FOOD-A', match: 'near', similarity: 0.72 });

        expect(outcome.kind === 'resolved' && outcome.evidence).toContain('near');
        expect(outcome.kind === 'resolved' && outcome.evidence).toContain('0.72');
    });
});

describe('createMemoTier — the adapter', () => {
    it('is registered as tier `memo`', () => {
        const dal = { findMemo: vi.fn() } as unknown as ResolutionMappingsDal;

        expect(createMemoTier(dal).id).toBe('memo');
    });

    it('looks the memo up by KEY, and does not key on the caller', async () => {
        const findMemo = vi.fn().mockResolvedValue({ foodId: 'FOOD-A', match: 'exact', similarity: 1 });
        const tier = createMemoTier({ findMemo } as unknown as ResolutionMappingsDal);

        await tier.resolve(QUERY, { userId: '01JU10MEMO000000000AUTHOR' });

        // A memo is machine-derived and belongs to nobody, so the lookup takes the key alone. Passing an
        // author here would imply a per-user memo table that does not exist.
        expect(findMemo).toHaveBeenCalledWith(KEY);
    });

    it('lets a DAL failure propagate — containment is the cascade’s job', async () => {
        const findMemo = vi.fn().mockRejectedValue(new Error('connection reset'));
        const tier = createMemoTier({ findMemo } as unknown as ResolutionMappingsDal);

        await expect(tier.resolve(QUERY, { userId: undefined })).rejects.toThrow('connection reset');
    });
});

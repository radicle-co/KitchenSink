/**
 * Unit tests for THE MEMO TIER — the remembered-resolution tier (plan U10 / R11, R14).
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

    it('RESOLVES on an EXACT hit — the gate agreed THIS key', () => {
        const outcome = decideMemoTier({ foodId: 'FOOD-A', match: 'exact', similarity: 1 } satisfies MemoHit);

        expect(outcome.kind).toBe('resolved');
        expect(outcome.kind === 'resolved' && outcome.foodId).toBe('FOOD-A');
    });

    it('⛔ PASSES on a NEAR hit — nobody agreed the QUERY phrase means that food', () => {
        // ⚠️ READ BEFORE "FIXING" THIS BACK. `verifiedBy` is a fact about the STORED key: on the near branch
        // no human and no model ever agreed that the phrase being asked about means this food, so it is a
        // retrieval guess of the same epistemic class as a lexical top hit — and KTD-A's answer to that class
        // is to WITHHOLD until the gate agrees. The withholding machinery keys on the TIER: `pendingStateOf`
        // returns `'none'` for anything but `lexical`, and `pendingRedrives` only covers `ranked` evidence.
        // So a near memo that RESOLVED would publish immediately, counted, and un-redriveable — the published
        // wrong bind KTD-A exists to prevent — while passing lets the lexical tier answer, which withholds and
        // gets a verdict. At `MEMO_SIMILARITY_FLOOR = 0.5`, the midpoint of the trigram scale, that distance
        // is not theoretical.
        //
        // ⚠️ A DEFERRAL OF AE8, NOT A REJECTION OF IT, and the one thing here owed an owner ruling. AE8 wants
        // a near-twin to resolve from the knowledge base without an LLM call; R14 forbids equality-only
        // MATCHING, which `findMemo` still honours — the k-NN lookup is unchanged and only the tier's verdict
        // on its result moved. Flip this back to `resolved` the day `MemoHit.match` is persisted on the
        // resolution and `pendingStateOf` / `pendingRedrives` treat a near memo as a withholding class
        // (ADR-0026 §3's `single-engine` != `differ`, one field over).
        const outcome = decideMemoTier({ foodId: 'FOOD-A', match: 'near', similarity: 0.72 } satisfies MemoHit);

        expect(outcome.kind).toBe('pass');
        expect(outcome.tier).toBe('memo');
    });

    it('says WHY it declined a near hit, and how close it was', () => {
        // A near hit reported as "nothing remembered" makes the deferral above invisible to anyone auditing
        // why a line did not resolve at the knowledge base.
        const outcome = decideMemoTier({ foodId: 'FOOD-A', match: 'near', similarity: 0.72 });

        expect(outcome.kind === 'pass' && outcome.reason).toContain('near');
        expect(outcome.kind === 'pass' && outcome.reason).toContain('0.72');
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

        await tier.resolve(QUERY, { userId: '01JU10MEMO000000000AUTHOR', caller: undefined });

        // A memo is machine-derived and belongs to nobody, so the lookup takes the key alone. Passing an
        // author here would imply a per-user memo table that does not exist.
        expect(findMemo).toHaveBeenCalledWith(KEY);
    });

    it('lets a DAL failure propagate — containment is the cascade’s job', async () => {
        const findMemo = vi.fn().mockRejectedValue(new Error('connection reset'));
        const tier = createMemoTier({ findMemo } as unknown as ResolutionMappingsDal);

        await expect(tier.resolve(QUERY, { userId: undefined, caller: undefined })).rejects.toThrow('connection reset');
    });
});

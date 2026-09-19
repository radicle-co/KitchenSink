/**
 * The lease window is DERIVED from what one food can legitimately spend at a source (U5/R16), not
 * asserted as a literal.
 *
 * ⛔ Why this suite exists at all: FR-018 fixed the lease at 30 seconds, while one food's fan-out may
 * issue a search, a batch chunk and up to twenty per-key recoveries — twenty-two requests, each with a
 * ten-second client timeout. A 30-second lease therefore EXPIRES DURING NORMAL WORK: the reaper reverts
 * the row, a second claim loop picks it up, and the same food is fetched from USDA twice while the first
 * loop is still running. That is not an edge case, it is the ordinary slow path.
 *
 * So the floor is computed from the same four facts the fan-out is built from. A test that restated
 * "220" would go green on a derivation that had stopped tracking them — every assertion here is written
 * against the structure instead.
 */
import { describe, expect, it, vi } from 'vitest';

import { createUsdaSourceRegistry } from '../../sources/usda/usdaRegistry.js';

import {
    FOOD_LEASE_FLOOR_SECONDS,
    PRODUCTION_BUDGET,
    SETTLE_ALLOWANCE_SECONDS,
    worstCaseClaimSeconds,
    type ClaimBudget,
} from '../leaseWindow.js';

/** A budget with every dimension distinct, so a term read from the wrong field cannot pass by accident. */
const BUDGET: ClaimBudget = {
    adapters: 2,
    keysPerSearch: 7,
    batchSize: 3,
    backingItemsPerAdapter: 5,
    requestTimeoutMs: 1_000,
};

describe('worstCaseClaimSeconds — the fan-out leg', () => {
    it('counts the search, every batch chunk AND every per-key recovery, per adapter', () => {
        // 2 adapters × (1 search + ceil(7/3)=3 chunks + 7 recoveries) = 2 × 11 = 22 requests × 1s.
        expect(worstCaseClaimSeconds(BUDGET)).toBe(22);
    });

    it('⛔ grows with the recovery fan-out — a chunk that fails validation costs one request PER KEY', () => {
        const wider = worstCaseClaimSeconds({ ...BUDGET, keysPerSearch: BUDGET.keysPerSearch + 3 });

        // +3 keys adds 3 recoveries and one more chunk, per adapter: 2 × (3 + 1) = 8 more requests.
        expect(wider - worstCaseClaimSeconds(BUDGET)).toBe(8);
    });

    it('scales with the number of wired adapters — the fan-out is sequential, never parallel', () => {
        expect(worstCaseClaimSeconds({ ...BUDGET, adapters: 4 })).toBe(2 * worstCaseClaimSeconds(BUDGET));
    });
});

describe('worstCaseClaimSeconds — the change-refresh leg', () => {
    /**
     * `refreshResolvedFood` re-fetches one backing crosswalk at a time, so its cost is driven by a
     * DIFFERENT number than the fan-out's. Taking the larger of the two is what makes the floor cover
     * BOTH shapes a claim can take; deriving from the fan-out alone would leave the refresh path
     * uncovered the moment a food accumulated more backing items than a fan-out issues requests.
     */
    it('takes the refresh cost when it exceeds the fan-out cost', () => {
        const refreshHeavy: ClaimBudget = { ...BUDGET, keysPerSearch: 1, batchSize: 1, backingItemsPerAdapter: 40 };

        // Fan-out: 2 × (1 + 1 + 1) = 6. Refresh: 2 × 40 = 80. The refresh leg wins.
        expect(worstCaseClaimSeconds(refreshHeavy)).toBe(80);
    });

    it('takes the fan-out cost when IT is the larger — the floor is a maximum, not a sum', () => {
        expect(worstCaseClaimSeconds({ ...BUDGET, backingItemsPerAdapter: 1 })).toBe(22);
    });
});

describe('PRODUCTION_BUDGET tracks what is actually wired', () => {
    /**
     * ⛔ `adapters` MULTIPLIES the whole derivation (the fan-out walks adapters sequentially, so their
     * costs add), and it is the one input the module states rather than imports — the count lives in
     * `createUsdaSourceRegistry`, a composition root that reads `process.env`, which a pure module must
     * not depend on. This is the binding that replaces the import: wire a second source and the floor is
     * half the real worst case unless this goes red first.
     */
    it('⛔ counts the adapters the production registry ACTUALLY registers', () => {
        vi.stubEnv('USDA_API_KEY', 'binding-test-key');
        vi.stubEnv('USDA_API_BASE_URL', 'https://api.nal.usda.gov/fdc/v1');

        try {
            expect(PRODUCTION_BUDGET.adapters).toBe(createUsdaSourceRegistry().adapters().length);
        } finally {
            vi.unstubAllEnvs();
        }
    });
});

describe('FOOD_LEASE_FLOOR_SECONDS — the shipped derivation', () => {
    /** The scenario the plan names: "the lease derivation exceeds the worst-case fetch duration". */
    it('⛔ EXCEEDS the worst case of the wired configuration — a claim can never outlive its lease', () => {
        expect(FOOD_LEASE_FLOOR_SECONDS).toBeGreaterThan(worstCaseClaimSeconds(PRODUCTION_BUDGET));
    });

    it('leaves the whole settle allowance above the worst case, not a rounding sliver', () => {
        expect(FOOD_LEASE_FLOOR_SECONDS - worstCaseClaimSeconds(PRODUCTION_BUDGET)).toBe(SETTLE_ALLOWANCE_SECONDS);
    });

    it('⛔ clears the 30 seconds FR-018 originally fixed — the literal this derivation replaces', () => {
        // Not a nicety: at 30s the reaper fires mid-fan-out, which is the double-claim R16 forbids.
        expect(FOOD_LEASE_FLOOR_SECONDS).toBeGreaterThan(30);
    });

    it('is a whole number of seconds — `make_interval(secs => …)` takes the value verbatim', () => {
        expect(Number.isInteger(FOOD_LEASE_FLOOR_SECONDS)).toBe(true);
    });
});

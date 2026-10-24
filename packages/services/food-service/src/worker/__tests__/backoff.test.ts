import { describe, expect, it } from 'vitest';

import {
    backoffSeconds,
    isRetryBudgetExhausted,
    isTimeoutBudgetExhausted,
    MAX_FAILURE_ATTEMPTS,
    MAX_TIMEOUT_DEFERRALS,
} from '../backoff.js';

describe('backoffSeconds (FR-016 — exponential 2^attempts)', () => {
    it('doubles with each real failure (1→2, 2→4, 3→8, 4→16, 5→32)', () => {
        expect(backoffSeconds(1)).toBe(2);
        expect(backoffSeconds(2)).toBe(4);
        expect(backoffSeconds(3)).toBe(8);
        expect(backoffSeconds(4)).toBe(16);
        expect(backoffSeconds(5)).toBe(32);
    });
});

describe('retry budget (FR-016/FR-027)', () => {
    it('tolerates exactly 5 real failures before FAILED', () => {
        expect(MAX_FAILURE_ATTEMPTS).toBe(5);
    });

    it('is exhausted once attempts reaches the budget', () => {
        expect(isRetryBudgetExhausted(4)).toBe(false);
        expect(isRetryBudgetExhausted(5)).toBe(true);
        expect(isRetryBudgetExhausted(6)).toBe(true);
    });
});

describe('timeout budget (a source that never answers must not defer a row forever)', () => {
    it('tolerates exactly 5 timeout deferrals before the row fails', () => {
        expect(MAX_TIMEOUT_DEFERRALS).toBe(5);
    });

    it('is exhausted once the post-increment count reaches the cap', () => {
        expect(isTimeoutBudgetExhausted(4)).toBe(false);
        expect(isTimeoutBudgetExhausted(5)).toBe(true);
        expect(isTimeoutBudgetExhausted(6)).toBe(true);
    });
});

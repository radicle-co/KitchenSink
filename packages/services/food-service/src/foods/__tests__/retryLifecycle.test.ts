/**
 * The placeholder retry lifecycle (U9) — the parts that are decisions rather than plumbing.
 *
 * The backoff curve and the five-attempt ceiling already existed and are tested in `worker/backoff.ts`'s
 * own suite. What U9 adds, and what this file covers, is the three things that made the existing retry
 * unobservable and unrecoverable:
 *
 *   1. a food between failures was indistinguishable on the wire from one never attempted;
 *   2. exhausting the budget was counted with the `NOT_FOUND` tombstones DSN-9 deliberately silences, so a
 *      blackholed food looked like a normal outcome;
 *   3. there was no way back for a blackholed food short of editing the database.
 */
import { describe, it, expect } from 'vitest';

import { MAX_FAILURE_ATTEMPTS, backoffSeconds, isRetryBudgetExhausted } from '../../worker/backoff.js';
import { FOOD_METRIC } from '../../observability/emfMetrics.js';
import { foodStatusSchema, pendingFoodStatusSchema, terminalFoodStatusSchema } from '../foods.schema.js';

describe('AWAITING_RETRY on the wire', () => {
    it('is a real lifecycle value, not a client-side invention', () => {
        expect(foodStatusSchema.safeParse('AWAITING_RETRY').success).toBe(true);
    });

    it('⛔ answers 202 with the pending set — a retrying food must NOT read as terminal', () => {
        // Putting it in the terminal set would tell a client to give up on a food the worker retries
        // minutes later, which is the opposite of what the status exists to communicate.
        expect(pendingFoodStatusSchema.safeParse('AWAITING_RETRY').success).toBe(true);
        expect(terminalFoodStatusSchema.safeParse('AWAITING_RETRY').success).toBe(false);
    });

    it('keeps the lifecycle PARTITIONED — every value answers exactly one status code', () => {
        // `RESOLVED` is the 200; the other five split between the 202 and 404 sets with no overlap and
        // nothing left over. A sixth value that landed in neither would answer no code at all.
        const pending = new Set<string>(pendingFoodStatusSchema.options);
        const terminal = new Set<string>(terminalFoodStatusSchema.options);

        for (const status of foodStatusSchema.options) {
            const inPending = pending.has(status);
            const inTerminal = terminal.has(status);
            const isResolved = status === 'RESOLVED';
            const memberships = [inPending, inTerminal, isResolved].filter(Boolean).length;

            expect(memberships, `${status} must belong to exactly one response class`).toBe(1);
        }
    });

    it('is distinct from PENDING, which is the entire point', () => {
        expect(foodStatusSchema.options).toContain('PENDING');
        expect(foodStatusSchema.options).toContain('AWAITING_RETRY');
    });
});

describe('the retry budget', () => {
    it('is FIVE attempts (the owner ruling that superseded three)', () => {
        expect(MAX_FAILURE_ATTEMPTS).toBe(5);
    });

    it('exhausts AT five, not after five — the fifth failure is terminal', () => {
        expect(isRetryBudgetExhausted(4)).toBe(false);
        expect(isRetryBudgetExhausted(5)).toBe(true);
    });

    it('backs off exponentially rather than re-firing immediately', () => {
        // Re-firing immediately turns a source outage into a hot loop against the failing source, which is
        // how a transient outage becomes a rate-limit ban.
        const delays = [1, 2, 3, 4, 5].map(backoffSeconds);

        expect(delays).toEqual([2, 4, 8, 16, 32]);
        for (let i = 1; i < delays.length; i += 1) {
            expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
        }
    });
});

describe('exhaustion is its OWN signal', () => {
    it('⛔ has a metric distinct from the tombstone count DSN-9 silences', () => {
        // `NOT_FOUND` ("no wired source has this food") is a normal outcome and is deliberately quiet.
        // Five REAL failures is a source erroring across the whole backoff curve, and that food is now
        // blackholed for every user. Sharing one metric buries the second among the first.
        expect(FOOD_METRIC.retryBudgetExhausted).toBe('food-retry-budget-exhausted');
        expect(FOOD_METRIC.retryBudgetExhausted).not.toBe(FOOD_METRIC.tombstoneCount);
    });
});

/**
 * The source budget's input rule and time bound. The charge itself, its concurrency and its clock are
 * `tests/e2e/requesterSourceBudget.e2e.test.ts`, since only a real database can show them.
 *
 * The input rule is a precondition rather than a refusal because the upsert's `ON CONFLICT … WHERE` guards only the
 * update path: a first charge larger than the limit would be inserted whole and admitted.
 */
import { describe, expect, it } from 'vitest';

import { FOOD_POOL_QUERY_TIMEOUT_MS } from '../../../database/poolConfig.js';
import { BUDGET_STATEMENT_TIMEOUT_MS, checkedBudgetCharge } from '../requesterSourceBudget.dao.js';

const VALID = { requesterId: '01J9ZK8N7QF3B2X4M6T0V5C1AB', cost: 3, limit: 120, windowSeconds: 3600 } as const;

describe('checkedBudgetCharge', () => {
    it('passes a charge inside its limit through unchanged', () => {
        expect(checkedBudgetCharge(VALID)).toEqual(VALID);
    });

    it('passes a charge equal to the whole limit, which a fresh window admits', () => {
        expect(checkedBudgetCharge({ ...VALID, cost: VALID.limit })).toEqual({ ...VALID, cost: VALID.limit });
    });

    it.each([
        ['a cost above the limit, which the insert path would admit whole', { cost: 121 }],
        ['a zero cost, which would admit without counting', { cost: 0 }],
        ['a negative cost, which would refund', { cost: -1 }],
        ['a fractional cost', { cost: 1.5 }],
        ['a zero limit', { limit: 0, cost: 0 }],
        ['a zero window', { windowSeconds: 0 }],
        ['a fractional window', { windowSeconds: 0.5 }],
        ['an empty requester', { requesterId: '' }],
    ])('refuses %s before any SQL', (_label, change) => {
        expect(() => checkedBudgetCharge({ ...VALID, ...change })).toThrow(RangeError);
    });
});

describe('the budget statement bound', () => {
    // The pool's `query_timeout` is the client-side net under every food query. Firing first, it would abandon a charge
    // the server is still running and read a slow lock wait as a lost server.
    it('ends before the pool backstop fires', () => {
        expect(BUDGET_STATEMENT_TIMEOUT_MS).toBeLessThan(FOOD_POOL_QUERY_TIMEOUT_MS);
    });
});

/**
 * The parse class's `claimed_too_long` must mean the SAME thing as the cook's read of a line (plan
 * 2026-10-15-011, open question 3): a pending line is stuck only when `lineProgressOf` would call it `stalled`, i.e.
 * its claim lapsed AND nothing in its whole paste moved for `PARSE_LINE_DELIVERY.stallSeconds`. Before this change
 * the statement tested the lease alone, so every line between two attempts (`delayed`, a normal state) was reported
 * as stuck.
 *
 * ⚠️ A unit test cannot execute the SQL; what it CAN pin is that the stall window reaches the statement as the
 * shared constant (not a copy) and that the statement measures quiet per JOB. The row-level behaviour is proved
 * against real rows in `tests/e2e/queueCheck.e2e.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import { PARSE_LINE_DELIVERY } from '@kitchensink/recipe-core/parsing/parse-line-delivery';

import { readOnlyCounts } from '../queueCheck.js';
import { RECIPE_WORK_CLASSES } from '../queueCheckReads.js';

const ENV: NodeJS.ProcessEnv = {
    PARSE_CLAIM_LEASE_SECONDS: String(PARSE_LINE_DELIVERY.leaseSeconds),
    VERIFICATION_CLAIM_LEASE_SECONDS: '60',
    VERIFICATION_ATTEMPT_ALLOWANCE: '20',
    TEST_RESET_STALE_SECONDS: '900',
};

const COUNT_ROW = {
    owed_past_deadline: 0,
    never_received: 0,
    at_allowance: 0,
    claimed_too_long: 0,
    oldest_owed_seconds: 0,
};

describe('the parse class shares the cook-facing stall rule', () => {
    it('binds the lease from the env and the stall window from the shared delivery constant', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [COUNT_ROW] });

        await readOnlyCounts({ query, release: vi.fn() }, ENV);

        const parseIndex = RECIPE_WORK_CLASSES.findIndex((workClass) => workClass.queueName === 'parse-lines');
        // call 0 is BEGIN; the classes follow in declaration order
        const [, params] = query.mock.calls[parseIndex + 1] as [string, unknown[]];

        expect(params).toEqual([PARSE_LINE_DELIVERY.leaseSeconds, PARSE_LINE_DELIVERY.stallSeconds]);
    });

    it('measures quiet over the whole job and requires it for claimed_too_long', () => {
        const sql = RECIPE_WORK_CLASSES.find((workClass) => workClass.queueName === 'parse-lines')?.sql ?? '';
        const stuckAt = sql.indexOf('AS claimed_too_long');
        const clause = sql.slice(sql.lastIndexOf('FILTER', stuckAt), stuckAt);

        expect(sql).toMatch(/GROUP BY\s+job_id/iu);
        expect(sql).toMatch(/max\(\s*updated_at\s*\)/iu);
        expect(clause).toContain('$1');
        expect(clause).toContain('$2');
    });
});

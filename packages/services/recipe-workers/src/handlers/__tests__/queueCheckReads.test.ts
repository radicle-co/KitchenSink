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

import { ERASURE_GIVE_UP_AGE_SECONDS, ERASURE_GIVE_UP_ATTEMPTS } from '../../common/erasureGiveUp.js';
import { readOnlyCounts } from '../queueCheck.js';
import { RECIPE_WORK_CLASSES } from '../queueCheckReads.js';

const ENV: NodeJS.ProcessEnv = {
    PARSE_CLAIM_LEASE_SECONDS: String(PARSE_LINE_DELIVERY.leaseSeconds),
    VERIFICATION_CLAIM_LEASE_SECONDS: '60',
    VERIFICATION_ATTEMPT_ALLOWANCE: '20',
    TEST_RESET_STALE_SECONDS: '900',
    ERASURE_CLAIM_LEASE_SECONDS: '300',
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

/**
 * Owner rule: every worker queue has an active watcher over the ENTIRE queue. The account-erasure queue (GDPR Art. 17)
 * was the one the backstop did not read, so a stuck or dead-lettered erasure was visible only to a prod-only age
 * alarm that treats missing data as healthy.
 */
describe('the account-erasure class (the queue the backstop used to skip)', () => {
    const erasure = RECIPE_WORK_CLASSES.find((workClass) => workClass.queueName === 'account-erasure');

    it('is covered, and reads BOTH the queue and its dead-letter queue', () => {
        expect(erasure).toBeDefined();
        expect(erasure?.queueUrlEnv).toBe('ACCOUNT_ERASURE_QUEUE_URL');
        expect(erasure?.dlqUrlEnv).toBe('ACCOUNT_ERASURE_DLQ_URL');
    });

    it('counts the owed jobs from account_erasure_jobs, judged by the sweeper give-up allowance and the worker lease', () => {
        expect(erasure?.sql).toContain('account_erasure_jobs');
        expect(erasure?.params).toEqual([
            ERASURE_GIVE_UP_ATTEMPTS,
            'ERASURE_CLAIM_LEASE_SECONDS',
            ERASURE_GIVE_UP_AGE_SECONDS,
        ]);
    });

    /**
     * ⛔ THE ALLOWANCE COUNT CARRIES THE SWEEPER'S AGE FLOOR. `attempts` is not per-job: a fresh row re-POSTed after a
     * failure is claimed by the old cycle's leftover messages, so it can cross the allowance within minutes. The sweeper
     * abandons only a job that is attempts-exhausted AND older than the floor (`erasureGiveUp.ts`); the backstop that
     * reported such a fresh job as exhausted contradicted the policy it watches.
     */
    it('⛔ counts a job at the allowance only once it is also past the sweeper’s age floor', () => {
        const sql = (erasure?.sql ?? '').replace(/\s+/gu, ' ');

        expect(sql).toContain(
            "FILTER ( WHERE attempts >= $1 AND created_at < now() - ($3 || ' seconds')::interval )::int AS at_allowance",
        );
    });

    it('binds the allowance and the age floor as the shared constants and the lease from the env, in $1/$2/$3 order', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [COUNT_ROW] });

        await readOnlyCounts({ query, release: vi.fn() }, ENV);

        const index = RECIPE_WORK_CLASSES.findIndex((workClass) => workClass.queueName === 'account-erasure');
        const [, params] = query.mock.calls[index + 1] as [string, unknown[]];

        expect(params).toEqual([ERASURE_GIVE_UP_ATTEMPTS, 300, ERASURE_GIVE_UP_AGE_SECONDS]);
    });

    // Reset messages RIDE the erasure queue (recipe-service enqueues `testPrincipalReset`; the sweeper re-drains
    // test_reset_jobs onto it). With no transport, a queued reset read as "nothing is carrying this" -> `lost`.
    it('lets the test-resets class see the queue its messages ride, while the DLQ is read once, by erasure', () => {
        const resets = RECIPE_WORK_CLASSES.find((workClass) => workClass.queueName === 'test-resets');

        expect(resets?.queueUrlEnv).toBe('ACCOUNT_ERASURE_QUEUE_URL');
        expect(resets?.dlqUrlEnv).toBeUndefined();
    });
});

/**
 * U12 — the recipe queue backstop, against real PostgreSQL (R29/R30/R32/R34/R36).
 *
 * ⛔ WHY THIS TIER, AND NOT A UNIT SUITE. Three of the four claims this backstop makes are claims about the
 * DATABASE, not about the code:
 *
 *  - **that it cannot write.** `BEGIN TRANSACTION READ ONLY` is enforced by Postgres, and a fake pool answers
 *    whatever it is told. A unit test would assert the string of an SQL statement, which proves the statement
 *    was composed, never that it was obeyed — and "the backstop is read-only" is the one property whose
 *    failure means the thing watching the queue can corrupt it.
 *  - **that the counts are what the tables actually hold.** Every statement in `queueCheckReads.ts` is a
 *    `FILTER` over real columns with real `now()` arithmetic. A mock returns the numbers the test author
 *    expected, which is exactly the assumption being checked.
 *  - **that the five statements see ONE instant.** `REPEATABLE READ` is a database guarantee.
 *
 * Runs against the role-split fixture as `recipe_app` (ADR-0039); skipped when no admin server is configured.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

import type { EscalationPayload, ReadSession } from '@kitchensink/queue-check';

import { batchedCounts, checkedQueues, readOnlyCounts, runRecipeQueueCheck } from '../../src/handlers/queueCheck.js';
import { RECIPE_WORK_CLASSES } from '../../src/handlers/queueCheckReads.js';
import { hasTestDatabase, recipeWorkersDb } from './roleDb.js';

const roleDb = recipeWorkersDb();
const OWNER = 'u12-backstop-owner';

/** Mid-morning in New York — outside ADR-0007's nightly stop. */
const AWAKE = new Date('2026-07-15T15:00:00Z');

/** 01:00 in New York — inside it. */
const ASLEEP = new Date('2026-07-15T05:00:00Z');

/** Every env the reads need, with the queue URLs left OUT so the fake transport answers instead. */
const PARAMS: NodeJS.ProcessEnv = {
    PARSE_CLAIM_LEASE_SECONDS: '150',
    VERIFICATION_CLAIM_LEASE_SECONDS: '60',
    VERIFICATION_ATTEMPT_ALLOWANCE: '20',
    TEST_RESET_STALE_SECONDS: '900',
};

describe.skipIf(!hasTestDatabase)('the recipe queue backstop (integration)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_parse_jobs WHERE owner_id = $1`, [OWNER]);
        await pool.query(`DELETE FROM test_reset_jobs WHERE user_id = $1`, [OWNER]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /**
     * One checked-out connection, released after the caller is done with it.
     *
     * ⚠️ A CLIENT, never the pool — `readOnlyCounts` takes a {@link ReadSession} precisely so a pool cannot be
     * passed, and this is what the production handlers do too. Each spec below takes its own, so nothing
     * leaks a transaction into the next one.
     */
    async function withSession<T>(run: (session: ReadSession) => Promise<T>): Promise<T> {
        const client = await pool.connect();

        try {
            return await run({
                query: async (text, params) => client.query(text, params as unknown[]),
                release: () => {
                    client.release();
                },
            });
        } finally {
            client.release();
        }
    }

    /** One parse job with `lineCount` pending lines, aged `ageSeconds`, expiring `ttlSeconds` from now. */
    async function seedParseJob(lineCount: number, ageSeconds: number, ttlSeconds: number): Promise<void> {
        const jobId = randomUUID();

        await pool.query(
            `INSERT INTO recipe_parse_jobs (id, owner_id, status, created_at, expires_at)
             VALUES ($1, $2, 'running', now() - ($3 || ' seconds')::interval,
                     now() + ($4 || ' seconds')::interval)`,
            [jobId, OWNER, String(ageSeconds), String(ttlSeconds)],
        );

        for (let index = 0; index < lineCount; index += 1) {
            await pool.query(
                `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest, status)
                 VALUES ($1, $2, $3, $4, 'pending')`,
                [jobId, index, `u12 backstop line ${String(index)}`, `digest-${jobId}-${String(index)}`],
            );
        }
    }

    /**
     * ⛔ THE ASSERTION THE WHOLE DESIGN RESTS ON. A backstop that can write is a backstop that can make the
     * thing it is watching worse — and the one failure it must never cause is the one it exists to detect.
     * This proves the guarantee is Postgres's rather than the author's: the write is attempted INSIDE the
     * check's own transaction and the database refuses it.
     */
    it('⛔ refuses a write inside the check’s own read-only transaction', async () => {
        const client = await pool.connect();

        try {
            await client.query('BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ');

            await expect(
                client.query(`INSERT INTO test_reset_jobs (user_id, status) VALUES ($1, 'queued')`, [OWNER]),
            ).rejects.toThrow(/read-only transaction/iu);
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    /**
     * ⚠️ THERE IS NO RUNTIME TEST HERE THAT THE READ USES ONE CONNECTION, and that is a decision rather than
     * a gap.
     *
     * The defect it would cover is real: `pg.Pool.query()` checks a connection OUT per call, so a pool-backed
     * runner would put `BEGIN TRANSACTION READ ONLY`, the five statements and `COMMIT` on different backends —
     * the BEGIN applying to a session nothing else uses, the reads running with no transaction at all, and
     * the read-only guarantee silently absent while every assertion in this file still passed.
     *
     * Two runtime tests for it were written and BOTH were theatre. Comparing `pg_backend_pid()` across the
     * statements passes under the bug, because an idle pool hands back the same connection every time; so
     * does attempting a write mid-read, for the same reason. The property only diverges under concurrency,
     * which makes it exactly the kind of test that is green until production.
     *
     * So it is a TYPE instead. `readOnlyCounts` takes a {@link ReadSession}, whose `release` a `pg.Pool` does
     * not have and a `pg.PoolClient` does — a pool is not assignable, the compiler says so at every call
     * site, and there is nothing left to be flaky about.
     */
    it('reads one row of counts per work class, in declaration order', async () => {
        const counts = await withSession(async (session) => readOnlyCounts(session, PARAMS));

        expect(counts).toHaveLength(RECIPE_WORK_CLASSES.length);

        for (const row of counts) {
            expect(Number.isFinite(row.owedPastDeadline)).toBe(true);
            expect(Number.isFinite(row.oldestOwedSeconds)).toBe(true);
        }
    });

    /**
     * ⛔ "SLOW IS NOT LOST", proved against real rows rather than against a classifier fixture. The SAME
     * backlog resolves two different ways depending only on the transport — and getting this wrong in the
     * `delayed` direction pages somebody for a queue that is draining normally, which is how the channel
     * gets muted before the `lost` case ever arrives.
     */
    it('⛔ calls a backlog behind a MOVING queue delayed, not lost', async () => {
        await seedParseJob(3, 600, 3600);

        const escalate = vi.fn();
        const busy = { visible: 12, inFlight: 4, deadLettered: 0 };

        await runRecipeQueueCheck({
            stage: 'sandbox',
            service: 'recipe-workers',
            queues: [
                {
                    queueName: 'parse-lines',
                    counts: async () => withSession(async (session) => batchedCounts(session, PARAMS)(0)),
                    depth: async () => busy,
                },
            ],
            escalate,
            checkIn: vi.fn(),
            now: () => AWAKE,
        });

        const payload = escalate.mock.calls[0]?.[0] as EscalationPayload | undefined;

        expect(payload?.condition).toBe('delayed');
    });

    it('⛔ calls the SAME backlog behind an EMPTY queue lost', async () => {
        await seedParseJob(3, 600, 3600);

        const escalate = vi.fn();

        await runRecipeQueueCheck({
            stage: 'sandbox',
            service: 'recipe-workers',
            queues: [
                {
                    queueName: 'parse-lines',
                    counts: async () => withSession(async (session) => batchedCounts(session, PARAMS)(0)),
                    depth: async () => ({ visible: 0, inFlight: 0, deadLettered: 0 }),
                },
            ],
            escalate,
            checkIn: vi.fn(),
            now: () => AWAKE,
        });

        const payload = escalate.mock.calls[0]?.[0] as EscalationPayload | undefined;

        expect(payload?.condition).toBe('lost');
        expect(payload?.owedCount).toBe(3);
    });

    /**
     * ⛔ An EXPIRED job's pending lines are not owed. The sweep discards whatever would land for them, so
     * counting them escalates work the system has correctly abandoned — forever, because nothing ever clears
     * an expired job's lines.
     */
    it('⛔ does not count lines belonging to an expired job', async () => {
        await seedParseJob(4, 7200, -60);

        const [parse] = await withSession(async (session) => readOnlyCounts(session, PARAMS));

        expect(parse?.owedPastDeadline).toBe(0);
    });

    /**
     * ⛔ NOTHING A COOK WROTE REACHES THE ESCALATION, proved end to end from a row that contains some.
     *
     * ⚠️ WHAT THIS ADDS, stated precisely, because the obvious reading overstates it. A statement that merely
     * selected `source_line` cannot leak on its own: `runRecipeQueueCheck` builds the payload by naming its
     * nine fields, so an extra column stops at that boundary. Verified by mutation — adding
     * `MAX(source_line)` to the parse statement leaves this green. That explicit mapping IS the protection,
     * and the reason to have this test is that it is the only thing standing between the mapping and the
     * realistic change that removes it: somebody widening the payload with `...counts` to "include a bit
     * more context". With the column selected AND the payload spread, this reds — which is the pair of edits
     * a reviewer would have to make, and neither the type guard nor the adapter suite would notice either.
     *
     * A Sentry event sits outside every erasure path in this repository, so the failure is permanent.
     *
     * ⚠️ The phrase is distinctive on purpose: a substring search for "flour" would match the word in a
     * queue name, and a test that can pass by accident proves nothing.
     */
    it('⛔ carries no text from the rows it read, however distinctive', async () => {
        const PHRASE = 'zzqq-u12-secret-ingredient-phrase';
        const jobId = randomUUID();

        await pool.query(
            `INSERT INTO recipe_parse_jobs (id, owner_id, status, created_at, expires_at)
             VALUES ($1, $2, 'running', now() - interval '600 seconds', now() + interval '3600 seconds')`,
            [jobId, OWNER],
        );
        await pool.query(
            `INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest, status)
             VALUES ($1, 0, $2, $3, 'pending')`,
            [jobId, `2 cups ${PHRASE}`, `digest-${jobId}-0`],
        );

        const escalate = vi.fn();

        await runRecipeQueueCheck({
            stage: 'sandbox',
            service: 'recipe-workers',
            queues: await withSession(async (session) =>
                checkedQueues(session, async () => ({ visible: 0, inFlight: 0 }), PARAMS),
            ),
            escalate,
            checkIn: vi.fn(),
            now: () => AWAKE,
        });

        // The seeded row must actually have produced an escalation, or the assertion below passes vacuously.
        expect(escalate).toHaveBeenCalled();

        for (const [payload] of escalate.mock.calls as [EscalationPayload][]) {
            expect(JSON.stringify(payload)).not.toContain(PHRASE);
        }
    });

    /**
     * ⛔ THE FINGERPRINT IS STABLE ACROSS RUNS. If it moved — with a count, a timestamp, an age — every run
     * would open a NEW Sentry issue for the same stuck queue, and by morning the one real problem would be
     * three hundred issues nobody can read. Two runs over the same condition must group as one.
     */
    it('⛔ produces the same payload identity on two runs over the same condition', async () => {
        await seedParseJob(2, 600, 3600);

        const run = async (): Promise<EscalationPayload | undefined> => {
            const escalate = vi.fn();

            await runRecipeQueueCheck({
                stage: 'sandbox',
                service: 'recipe-workers',
                queues: [
                    {
                        queueName: 'parse-lines',
                        counts: async () => withSession(async (session) => batchedCounts(session, PARAMS)(0)),
                        depth: async () => ({ visible: 0, inFlight: 0, deadLettered: 0 }),
                    },
                ],
                escalate,
                checkIn: vi.fn(),
                now: () => AWAKE,
            });

            return escalate.mock.calls[0]?.[0] as EscalationPayload | undefined;
        };

        const first = await run();
        const second = await run();

        expect(first?.service).toBe(second?.service);
        expect(first?.stage).toBe(second?.stage);
        expect(first?.queueName).toBe(second?.queueName);
        expect(first?.condition).toBe(second?.condition);
    });

    /**
     * ⛔ NO DATABASE CALL AND NO CHECK-IN inside ADR-0007's nightly stop (R35). The non-prod tier's RDS is
     * stopped from 00:00 to 09:00, so a check that ran would find it unreachable and every queue apparently
     * stalled — escalating every night, in every preview, for a reason nobody can act on. A signal that fires
     * nightly is a signal its reader mutes, and the one night it means something is the night nobody looks.
     */
    it('⛔ touches neither the database nor the monitor during the nightly stop', async () => {
        await seedParseJob(9, 7200, 3600);

        const reader = vi.fn(async (text: string, params?: readonly unknown[]) =>
            withSession(async (session) => session.query(text, params)),
        );
        const escalate = vi.fn();
        const checkIn = vi.fn();

        const raised = await runRecipeQueueCheck({
            stage: 'sandbox',
            service: 'recipe-workers',
            queues: await withSession(async (session) =>
                checkedQueues(
                    { query: reader, release: session.release },
                    async () => ({ visible: 0, inFlight: 0 }),
                    PARAMS,
                ),
            ),
            escalate,
            checkIn,
            now: () => ASLEEP,
        });

        expect(raised).toEqual([]);
        expect(reader).not.toHaveBeenCalled();
        expect(escalate).not.toHaveBeenCalled();
        expect(checkIn).not.toHaveBeenCalled();
    });

    /** And the same check on `prod`, which has no nightly stop, does read — so the skip above is the WINDOW. */
    it('reads on prod at the same instant, so the skip is the window and not the stage', async () => {
        const reader = vi.fn(async (text: string, params?: readonly unknown[]) =>
            withSession(async (session) => session.query(text, params)),
        );

        await runRecipeQueueCheck({
            stage: 'prod',
            service: 'recipe-workers',
            queues: await withSession(async (session) =>
                checkedQueues(
                    { query: reader, release: session.release },
                    async () => ({ visible: 0, inFlight: 0 }),
                    PARAMS,
                ),
            ),
            escalate: vi.fn(),
            checkIn: vi.fn(),
            now: () => ASLEEP,
        });

        expect(reader).toHaveBeenCalled();
    });
});

/**
 * Integration suite for the placeholder retry lifecycle (plan U9) against a REAL Postgres.
 *
 * | Requirement | Proved here |
 * | ----------- | ----------- |
 * | R2.1 | a failed sync marks the placeholder — `AWAITING_RETRY` is a value the `food_status` ENUM accepts, round-trips through the real column, and is a legal prior for every state a retrying food can still reach |
 * | R2.3 | the retry re-enqueues with backoff — `fetch_queue.attempts` increments and `last_requested` is PERSISTED as `now() + 2^attempts` seconds, and that stored gate is what `leaseNext` obeys |
 * | R2.4 | the budget is capped at five, a lease reclaim does NOT spend it (DSN-5), a re-request does not reset it, and an operator requeue clears BOTH halves |
 *
 * ## Why this tier, and not another unit test
 *
 * U9's unit tests mock the DAO, so all of the following are structurally invisible to them and every one has
 * a plausible way to be wrong:
 *
 *  - `AWAITING_RETRY` exists in the TypeScript union whether or not migration `0005` ever ran. Postgres
 *    cannot store a value its enum type does not carry, and `setStatus`'s conditional UPDATE reports an
 *    unknown enum label as a *statement* error, not as a rejected transition.
 *  - the backoff is computed IN SQL (`make_interval(secs => power(2, attempts + 1))`) against the row's own
 *    pre-increment `attempts`. Nothing in the TypeScript layer holds that number, so only a real column read
 *    can say whether the curve stored is the curve documented.
 *  - `leaseNext` obeys `last_requested <= now()`. Whether the persisted gate actually withholds the row is a
 *    property of the stored timestamp and the claim statement together.
 *  - `AdminMetricsService.requeueFood` issues two writes to two tables and had NO test at any tier.
 *
 * ## Known gap, deliberately not asserted here
 *
 * Requeuing a `RESOLVED`/`UNRESOLVED` food still surfaces `IllegalStatusTransitionError` as a `500`
 * (`FR-028a` makes `RESOLVED → PENDING` illegal, and the exception filter has no arm for that error). That is
 * a wire-contract decision — which published code a caller should receive — so it is reported rather than
 * settled by a test that would bless either answer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { AdminMetricsDao } from '../src/foods/admin/adminMetrics.dao.js';
import { AdminMetricsService } from '../src/foods/admin/adminMetrics.service.js';
import { isFoodNotFoundError } from '../src/foods/foods.errors.js';
import { FetchQueueDao } from '../src/foods/dao/fetchQueue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetchRequesters.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { SourceCallLogDao } from '../src/foods/dao/sourceCallLog.dao.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { isRetryBudgetExhausted, MAX_FAILURE_ATTEMPTS } from '../src/worker/backoff.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** Seconds remaining on a queue row's backoff gate, read from the stored column against the server clock. */
async function secondsUntilEligible(pool: pg.Pool, foodId: string): Promise<number> {
    const { rows } = await pool.query<{ seconds: string }>(
        `SELECT EXTRACT(EPOCH FROM (last_requested - now())) AS seconds FROM fetch_queue WHERE food_id = $1`,
        [foodId],
    );

    return Number(rows[0]?.seconds);
}

/** The raw `food.status` text, straight from the column (never the DAO's mapped view). */
async function rawFoodStatus(pool: pg.Pool, foodId: string): Promise<string | undefined> {
    const { rows } = await pool.query<{ status: string }>('SELECT status FROM food WHERE id = $1', [foodId]);

    return rows[0]?.status;
}

describe.skipIf(!DATABASE_URL)('placeholder retry lifecycle (U9, integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;
    let admin: AdminMetricsService;

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);
        foods = new FoodDao(db);
        queue = new FetchQueueDao(db);
        requesters = new FetchRequestersDao(db);
        admin = new AdminMetricsService(
            new AdminMetricsDao(db),
            new RollingWindowLimiter(new SourceCallLogDao(db), {
                caps: { usda: { hardCap: 1000, pauseThreshold: 900 } },
            }),
            foods,
            queue,
        );
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /** A queued placeholder: a `PENDING` food, one requester, one `pending` queue row. */
    async function placeholder(name: string): Promise<string> {
        const { id } = await foods.createByName({ normalizedName: name });
        await requesters.add({ foodId: id, requesterId: 'user_retry' });
        await queue.enqueue(id);

        return id;
    }

    describe('the AWAITING_RETRY mark reaches the database (R2.1)', () => {
        it('the food_status ENUM carries AWAITING_RETRY — the migration ran, not just the TypeScript union', async () => {
            const { rows } = await pool.query<{ enumlabel: string }>(
                `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'food_status'`,
            );

            expect(rows.map((row) => row.enumlabel).sort()).toStrictEqual([
                'AWAITING_RETRY',
                'FAILED',
                'NOT_FOUND',
                'PENDING',
                'RESOLVED',
                'UNRESOLVED',
            ]);
        });

        it('a PENDING placeholder marked AWAITING_RETRY stores that literal in the food.status column', async () => {
            const id = await placeholder('marked banana');

            await foods.setStatus({ id, status: 'AWAITING_RETRY' });

            expect(await rawFoodStatus(pool, id)).toBe('AWAITING_RETRY');
            expect((await foods.getById(id))?.status).toBe('AWAITING_RETRY');
        });

        it('a second failure re-marks an already-AWAITING_RETRY food (the self-transition is legal)', async () => {
            const id = await placeholder('twice failed');
            await foods.setStatus({ id, status: 'AWAITING_RETRY' });

            await expect(foods.setStatus({ id, status: 'AWAITING_RETRY' })).resolves.toMatchObject({
                status: 'AWAITING_RETRY',
            });
        });

        it.each(['RESOLVED', 'UNRESOLVED', 'NOT_FOUND', 'FAILED', 'PENDING'] as const)(
            'a retrying food can still reach %s — the first failure is not a dead end',
            async (target) => {
                const id = await placeholder(`retry to ${target}`);
                await foods.setStatus({ id, status: 'AWAITING_RETRY' });

                await foods.setStatus({ id, status: target });

                expect(await rawFoodStatus(pool, id)).toBe(target);
            },
        );

        it('AWAITING_RETRY is NOT terminal — it carries no tombstoned_at stamp', async () => {
            const id = await placeholder('not tombstoned');

            await foods.setStatus({ id, status: 'AWAITING_RETRY' });

            const { rows } = await pool.query<{ tombstoned_at: Date | null }>(
                'SELECT tombstoned_at FROM food WHERE id = $1',
                [id],
            );
            expect(rows[0]?.tombstoned_at).toBeNull();
        });
    });

    describe('the retry re-enqueues with an exponential backoff that is PERSISTED (R2.3)', () => {
        it('the first failure increments attempts to 1, re-queues pending, clears the lease and records the error', async () => {
            const id = await placeholder('first failure');
            await queue.leaseNext();

            const row = await queue.recordFailure(id, 'source 503');

            expect(row.attempts).toBe(1);
            expect(row.status).toBe('pending');
            expect(row.leasedAt).toBeNull();
            expect(row.lastError).toBe('source 503');
        });

        it.each([
            [1, 2],
            [2, 4],
            [3, 8],
            [4, 16],
        ])(
            'failure #%i stores a gate of ~%i seconds — the 2^attempts curve, as the column holds it',
            async (attempt, expectedSeconds) => {
                const id = await placeholder(`backoff ${attempt}`);

                for (let n = 0; n < attempt; n += 1) {
                    await queue.recordFailure(id);
                }

                const remaining = await secondsUntilEligible(pool, id);

                // Read strictly after the write, so the observed remainder is at most the interval and at least
                // the interval minus the round trip. A pre-increment exponent (2^attempts-1), a linear curve or a
                // constant delay all fall outside this window at one of the four points.
                expect(remaining).toBeLessThanOrEqual(expectedSeconds);
                expect(remaining).toBeGreaterThan(expectedSeconds - 1);
            },
        );

        it('a row inside its stored backoff window is NOT claimable, and becomes claimable once it elapses', async () => {
            const id = await placeholder('gated by backoff');
            await queue.recordFailure(id);

            expect(await queue.leaseNext()).toBeUndefined();

            // The first failure's curve is 2s. Waiting it out is the only honest way to prove the PERSISTED
            // timestamp is what withholds the row: rewriting `last_requested` would test the rewrite.
            await new Promise((resolve) => setTimeout(resolve, 2_200));

            expect((await queue.leaseNext())?.foodId).toBe(id);
        });

        it('a backed-off row does not block a ready one — the gate is per row, not a global stall', async () => {
            const gated = await placeholder('gated');
            const ready = await placeholder('ready');
            await queue.recordFailure(gated);

            expect((await queue.leaseNext())?.foodId).toBe(ready);
        });
    });

    describe('the retry budget is capped at five and is spent only by real failures (R2.4, DSN-5)', () => {
        it('five recorded failures reach the budget ceiling; the fourth has not', async () => {
            const id = await placeholder('exhausting');
            let attempts = 0;

            for (let n = 0; n < MAX_FAILURE_ATTEMPTS; n += 1) {
                attempts = (await queue.recordFailure(id)).attempts;

                if (n < MAX_FAILURE_ATTEMPTS - 1) {
                    expect(isRetryBudgetExhausted(attempts)).toBe(false);
                }
            }

            expect(attempts).toBe(MAX_FAILURE_ATTEMPTS);
            expect(isRetryBudgetExhausted(attempts)).toBe(true);
        });

        it('a tombstoned, FAILED food is claimable by nothing — the placeholder reached a terminal state', async () => {
            const id = await placeholder('blackholed');

            for (let n = 0; n < MAX_FAILURE_ATTEMPTS; n += 1) {
                await queue.recordFailure(id);
            }

            await queue.tombstone(id, 'all_sources_errored');
            await foods.setStatus({ id, status: 'FAILED' });

            expect(await rawFoodStatus(pool, id)).toBe('FAILED');
            expect((await queue.getByFoodId(id))?.status).toBe('tombstone');
            expect(await queue.leaseNext()).toBeUndefined();
        });

        it('a re-request of the same food does NOT reset the attempt count', async () => {
            const id = await placeholder('re-requested');
            await queue.recordFailure(id);
            await queue.recordFailure(id);

            await requesters.add({ foodId: id, requesterId: 'user_second' });
            const row = await queue.enqueue(id);

            expect(row.attempts).toBe(2);
            expect(row.requestCount).toBe(2);
        });

        it('reapExpiredLeases reclaims a lapsed lease WITHOUT spending an attempt (DSN-5)', async () => {
            const id = await placeholder('crashed worker');
            await queue.recordFailure(id);
            await pool.query(
                `UPDATE fetch_queue SET status = 'in_flight', leased_at = now() - interval '10 minutes' WHERE food_id = $1`,
                [id],
            );

            expect(await queue.reapExpiredLeases(30)).toBe(1);

            const row = await queue.getByFoodId(id);
            expect(row?.status).toBe('pending');
            expect(row?.attempts).toBe(1);
        });
    });

    describe('the operator requeue clears BOTH halves and gives a blackholed food a way back (R2.4)', () => {
        /** Drive a placeholder all the way to the blackholed resting state an operator would find. */
        async function blackhole(name: string): Promise<string> {
            const id = await placeholder(name);

            for (let n = 0; n < MAX_FAILURE_ATTEMPTS; n += 1) {
                await queue.recordFailure(id);
            }

            await queue.tombstone(id, 'all_sources_errored');
            await foods.setStatus({ id, status: 'FAILED' });

            return id;
        }

        it('resets food.status to PENDING and fetch_queue.attempts to 0, and clears the recorded error', async () => {
            const id = await blackhole('recoverable');

            await expect(admin.requeueFood(id)).resolves.toStrictEqual({ id, status: 'PENDING' });

            expect(await rawFoodStatus(pool, id)).toBe('PENDING');
            const row = await queue.getByFoodId(id);
            expect(row?.attempts).toBe(0);
            expect(row?.status).toBe('pending');
            expect(row?.lastError).toBeNull();
        });

        it('makes the food claimable again immediately — the backoff gate is cleared, not merely reset', async () => {
            const id = await blackhole('re-drained');

            await admin.requeueFood(id);

            expect((await queue.leaseNext())?.foodId).toBe(id);
        });

        it('restores the full budget — the next failure is attempt 1, not a re-exhaustion', async () => {
            const id = await blackhole('budget restored');
            await admin.requeueFood(id);

            const row = await queue.recordFailure(id, 'source 503');

            expect(row.attempts).toBe(1);
            expect(isRetryBudgetExhausted(row.attempts)).toBe(false);
        });

        it('requeues a food marked AWAITING_RETRY (the mid-backoff case, not only the tombstoned one)', async () => {
            const id = await placeholder('mid backoff');
            await queue.recordFailure(id);
            await foods.setStatus({ id, status: 'AWAITING_RETRY' });

            await admin.requeueFood(id);

            expect(await rawFoodStatus(pool, id)).toBe('PENDING');
            expect((await queue.getByFoodId(id))?.attempts).toBe(0);
        });

        it('is IDEMPOTENT — a second requeue of the now-PENDING food succeeds, as the route documents', async () => {
            const id = await blackhole('requeued twice');
            await admin.requeueFood(id);

            await expect(admin.requeueFood(id)).resolves.toStrictEqual({ id, status: 'PENDING' });
            expect(await rawFoodStatus(pool, id)).toBe('PENDING');
        });

        it('reports an unknown food id as FOOD_NOT_FOUND, not as an internal fault', async () => {
            await expect(admin.requeueFood('01J9ZK8N7QF3B2X4M6T0V5C1AB')).rejects.toSatisfy(isFoodNotFoundError);
        });
    });
});

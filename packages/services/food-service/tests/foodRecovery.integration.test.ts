/**
 * THE U9 RECOVERY LOOP, end to end over REAL Postgres (FR-028a × FR-048).
 *
 * Every other tier stops one step short of the thing that matters. `foodRecovery.service.test.ts` proves
 * the requeue writes both halves over doubles; `fetchQueue.dao.integration.test.ts` proves the revived row
 * is CLAIMABLE. Neither can observe the refusal, because it happens later — inside
 * `FoodConsumerService.processRow`, after the lease, when the producer-provenance gate reads the row's
 * requester set. That gap is exactly how the escape hatch shipped unable to recover anything:
 *
 *   `tombstone` prunes `fetch_requesters` (DSN-10) → a blackholed food has ZERO requesters →
 *   `hasValidProvenance` refuses an empty set → the requeued row is re-tombstoned
 *   `unauthenticated_producer` on the very next drain → the food rests at `PENDING` forever, which is a
 *   permanent `202` to every reader: WORSE than the `404` the FAILED tombstone gave them.
 *
 * The fix records an accountable principal rather than widening the gate: the requeue re-enqueues through
 * the ORDINARY `EnqueueEmitter.publishFoodRequested` path as the named service principal
 * `svc_admin_requeue`, exactly as change-refresh does with `svc_change_refresh`. So this suite asserts the
 * LOOP, blackholing the food through the real retry budget rather than hand-constructing a resting state:
 * fail it for real → requeue it → drain → it must actually RESOLVE.
 *
 * It also pins the two operational properties that path buys, EMPIRICALLY rather than by reasoning about
 * the SQL: the recovered row lands in the PROMOTED drain tier (no starvation behind live demand), and the
 * enqueue's `pg_notify` wakes a real `WorkerRuntime` (recovery is not sitting behind the 60s reap timer).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type pg from 'pg';

import { InMemoryPublisher } from '@kitchensink/messaging';
import { FoodEventEmitter } from '../src/events/FoodEventEmitter.js';
import { FoodRecoveryService } from '../src/foods/admin/foodRecovery.service.js';
import { FetchQueueDao } from '../src/foods/dao/fetchQueue.dao.js';
import { eraseFoodRows } from '../src/foods/eraseFoodRows.js';
import { FetchRequestersDao } from '../src/foods/dao/fetchRequesters.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/foodSources.dao.js';
import { SourceCallLogDao } from '../src/foods/dao/sourceCallLog.dao.js';
import { EnqueueEmitter } from '../src/foods/enqueue.emitter.js';
import { makeMergeCandidate } from '../src/foods/merge/__fixtures__/merge.fixtures.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../src/foods/merge/mergeAndPersist.service.js';
import { SourceAdapterRegistry } from '../src/sources/SourceAdapterRegistry.js';
import { SourceApiError } from '../src/sources/foodSource.errors.js';
import { type FoodSourceAdapter, type SourceCandidate } from '../src/sources/foodSourceAdapter.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { SVC_ADMIN_REQUEUE } from '../src/worker/change-refresh/changeRefresh.consumer.js';
import { FoodConsumerService } from '../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../src/worker/SilentWorkerLogger.js';
import { WorkerRuntime } from '../src/worker/WorkerRuntime.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** The admin principal every requeue in this suite is issued by (the Clerk `sub` — the audit identity). */
const OPERATOR = 'admin_2incident';
/** A real app-user ULID — the requester behind the original, user-driven add. */
const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

type OutageAdapter = FoodSourceAdapter & {
    searchByName: Mock<(name: string) => Promise<SourceCandidate[]>>;
    /** Flip to `false` to end the simulated source outage. */
    down: { value: boolean };
};

/** Poll `predicate` until it is true or the timeout elapses; returns whether it became true. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2000): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (await predicate()) {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 15));
    }

    return false;
}

describe.skipIf(!DATABASE_URL)('U9 operator requeue — the recovery loop (integration, FR-028a × FR-048)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foodDao: FoodDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;
    let emitter: EnqueueEmitter;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foodDao = new FoodDao(db);
        queue = new FetchQueueDao(db);
        requesters = new FetchRequestersDao(db);
        emitter = new EnqueueEmitter(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /** A consumer over an adapter whose source can be taken down and brought back mid-test. */
    function build(): { consumer: FoodConsumerService; adapter: OutageAdapter } {
        const down = { value: true };
        const adapter: OutageAdapter = {
            source: 'usda',
            down,
            searchByName: vi.fn(async (name: string) => {
                if (down.value) {
                    // A genuine per-food server error — the class that consumes the retry budget.
                    throw new SourceApiError('usda', 500, 'source unavailable');
                }

                return [{ source: 'usda', externalKey: `ek-${name}`, name }];
            }),
            fetchByKey: async (key: string) => makeMergeCandidate('usda', { externalKey: key, name: 'Recovered' }),
            fetchByKeys: async (keys: readonly string[]) =>
                keys.map((key) => makeMergeCandidate('usda', { externalKey: key, name: 'Recovered' })),
        };
        const registry = new SourceAdapterRegistry();
        registry.register(adapter);
        const consumer = new FoodConsumerService({
            foodDao,
            sources: new FoodSourcesDao(db),
            queue,
            registry,
            limiter: new RollingWindowLimiter(new SourceCallLogDao(db)),
            merge: new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
            events: new FoodEventEmitter(new InMemoryPublisher()),
            logger: new SilentWorkerLogger(),
        });

        return { consumer, adapter };
    }

    /** The recovery command under test, wired exactly as `FoodsModule` wires it. */
    function recovery(): FoodRecoveryService {
        return new FoodRecoveryService(foodDao, emitter, new SilentWorkerLogger());
    }

    /**
     * Drain repeatedly until `id` reaches a terminal lifecycle state, clearing the exponential-backoff
     * gate between passes (a deterministic stand-in for elapsed time — `recordFailure` pushes
     * `last_requested` to `now() + 2^attempts`).
     *
     * @param consumer - The consumer to drive.
     * @param id - The food to watch.
     * @returns The food's terminal status (or `MISSING` when its row vanished).
     * @sideEffect Drains the real queue and rewrites `last_requested` between passes.
     */
    async function drainUntilTerminal(consumer: FoodConsumerService, id: string): Promise<string> {
        const terminal = new Set(['RESOLVED', 'UNRESOLVED', 'NOT_FOUND', 'FAILED']);

        for (let pass = 0; pass < 12; pass += 1) {
            await consumer.drain();
            const status = (await foodDao.getById(id))?.status;

            if (status === undefined || terminal.has(status)) {
                return status ?? 'MISSING';
            }

            await pool.query(
                `UPDATE fetch_queue SET status = 'pending', leased_at = NULL, last_requested = now()
                  WHERE food_id = $1`,
                [id],
            );
        }

        return (await foodDao.getById(id))?.status ?? 'MISSING';
    }

    /**
     * Blackhole a food the way production does: a user adds it, every source call fails, and the retry
     * budget runs out into a `FAILED` tombstone.
     *
     * @param consumer - The consumer to drive.
     * @param name - The food's normalized name.
     * @returns The blackholed food's id.
     * @sideEffect Creates a food, its requester and queue rows, then exhausts its retry budget.
     */
    async function blackhole(consumer: FoodConsumerService, name: string): Promise<string> {
        const { id } = await foodDao.createByName({ normalizedName: name, displayName: name });
        await requesters.add({ foodId: id, requesterId: USER_ULID });
        await queue.enqueue(id);

        expect(await drainUntilTerminal(consumer, id)).toBe('FAILED');
        // The premise of the whole defect: the tombstone took the requesters with it (DSN-10).
        expect(await requesters.countForFood(id)).toBe(0);

        return id;
    }

    it('requeue → drain → the food actually RESOLVES (it is not re-tombstoned as unauthenticated_producer)', async () => {
        const { consumer, adapter } = build();
        const id = await blackhole(consumer, 'tempeh starter');

        // The outage ends, and the operator requeues the food it blackholed.
        adapter.down.value = false;
        await recovery().requeueFood(id, OPERATOR);

        expect(await drainUntilTerminal(consumer, id)).toBe('RESOLVED');
        // The row is gone because the food completed — NOT tombstoned, and NOT left pending forever.
        expect(await queue.getByFoodId(id)).toBeUndefined();
    });

    it('records SVC_ADMIN_REQUEUE as the requester, and never the operator (fetch_requesters is the erasure surface)', async () => {
        const { consumer, adapter } = build();
        const id = await blackhole(consumer, 'shiro miso');
        adapter.down.value = false;

        await recovery().requeueFood(id, OPERATOR);

        expect(await queue.listRequesterIds(id)).toStrictEqual([SVC_ADMIN_REQUEUE]);
        // Erasing a human can never touch it: it is a constant belonging to no person. Driven through the
        // REAL sweep (`eraseFoodRows`, plan U17) — the one statement erasure actually issues.
        expect((await eraseFoodRows(db, OPERATOR)).deletedRequesterRows).toBe(0);
        expect(await queue.listRequesterIds(id)).toStrictEqual([SVC_ADMIN_REQUEUE]);
    });

    it('the failure it fixes: strip the recorded principal and the requeued row is refused, stalling at PENDING', async () => {
        // The OLD behaviour, pinned as a regression guard by deleting the requester the requeue recorded.
        // It asserts the REFUSAL, which only an intact FR-048 gate produces — so if anyone ever "fixes" U9
        // by widening that gate to accept a zero-requester row, this case goes RED and says so.
        const { consumer, adapter } = build();
        const id = await blackhole(consumer, 'miso koji');
        adapter.down.value = false;

        await recovery().requeueFood(id, OPERATOR);
        await pool.query(`DELETE FROM fetch_requesters WHERE food_id = $1`, [id]);

        expect(await consumer.processNext()).toBe('rejected_provenance');
        expect((await queue.getByFoodId(id))?.lastError).toBe('unauthenticated_producer');
        expect((await foodDao.getById(id))?.status).toBe('PENDING');
    });

    it('a food requeued twice is still recovered — the idempotent path re-enqueues too', async () => {
        const { consumer, adapter } = build();
        const id = await blackhole(consumer, 'natto spores');
        adapter.down.value = false;

        await recovery().requeueFood(id, OPERATOR);
        // The second call finds the food already PENDING: an idempotent success (202), and it must not
        // leave the row in a state the drain refuses.
        await expect(recovery().requeueFood(id, OPERATOR)).resolves.toStrictEqual({ id, status: 'PENDING' });

        expect(await drainUntilTerminal(consumer, id)).toBe('RESOLVED');
    });

    it('a requeue that fails again re-tombstones on the SOURCE outage, never on provenance', async () => {
        // The recorded principal has to survive the whole retry cycle: `recordFailure` returns the row to
        // `pending` between attempts, and if the requester were consumed on first claim the food would die
        // of `unauthenticated_producer` on attempt two and hide the real cause from the operator.
        const { consumer } = build();
        const id = await blackhole(consumer, 'shio koji');

        await recovery().requeueFood(id, OPERATOR);

        expect(await drainUntilTerminal(consumer, id)).toBe('FAILED');
        expect((await queue.getByFoodId(id))?.lastError).toBe('all_sources_errored');
    });

    /**
     * ⛔ THE TWO OPERATIONAL PROPERTIES THE ENQUEUE PATH BUYS, asserted against the real SQL and a real
     * runtime rather than argued from the statement. Both were live residuals of the rejected design (a
     * non-personal marker on `fetch_queue`), where the recovered row had NO requester and could therefore
     * appear in neither `leaseNext`'s demand CTE nor its promoted branch.
     */
    describe('operational properties of the recovered row', () => {
        it('lands in the PROMOTED drain tier — claimed AHEAD of live requester-backed demand, not behind it', async () => {
            const { consumer, adapter } = build();
            const id = await blackhole(consumer, 'kombucha scoby');
            adapter.down.value = false;

            // A busy queue of ordinary, requester-backed demand, all enqueued AFTER the blackholed food.
            for (const name of ['busy one', 'busy two', 'busy three']) {
                const other = await foodDao.createByName({ normalizedName: name, displayName: name });
                await requesters.add({ foodId: other.id, requesterId: USER_ULID });
                await queue.enqueue(other.id);
            }

            await recovery().requeueFood(id, OPERATOR);

            // (a) The requeue principal is IN the demand set `leaseNext`'s promoted branch is built from.
            //     A row whose requesters are all absent from that set can only be reached by the fallback
            //     branch, i.e. after every promoted row — which is the starvation this asserts away.
            expect(await queue.pendingCountForRequester(SVC_ADMIN_REQUEUE)).toBe(1);

            // (b) The observable consequence: it is claimed FIRST. All four rows tie at request_count = 1,
            //     so the promoted branch breaks the tie on `first_requested ASC` — and the blackholed food
            //     is the oldest, having been enqueued before the outage. With no requester it would have
            //     been invisible here and claimed LAST.
            expect((await queue.leaseNext())?.foodId).toBe(id);
        });

        it("wakes a real WorkerRuntime through the enqueue's pg_notify — not on the 60s reap timer", async () => {
            const { consumer, adapter } = build();
            const id = await blackhole(consumer, 'tempeh spore');
            adapter.down.value = false;

            // The reaper cadence is set 10 MINUTES out, so a drain inside the assertion window can only
            // have been caused by the NOTIFY. `start()` performs one initial drain — issued before the
            // requeue, so it cannot account for the result either.
            const lockSession = await pool.connect();
            const listenSession = await pool.connect();
            const runtime = new WorkerRuntime({
                lockSession,
                listenSession,
                consumer,
                queue,
                logger: new SilentWorkerLogger(),
                reapIntervalMs: 600_000,
            });

            try {
                expect(await runtime.start()).toBe(true);
                expect((await foodDao.getById(id))?.status).toBe('FAILED');

                await recovery().requeueFood(id, OPERATOR);

                const woke = await waitFor(async () => (await foodDao.getById(id))?.status === 'RESOLVED');
                expect(woke).toBe(true);
            } finally {
                await runtime.stop();
                lockSession.release();
                listenSession.release();
            }
        });
    });
});

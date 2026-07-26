/**
 * Integration suite for the change-refresh Fargate scheduled task (T-170 + T-172) over REAL Postgres
 * with a MOCKED source adapter. The task is the producer/idle-drainer of refresh work (ARCH-018/MOD-020):
 *
 *   - it scans `RESOLVED` foods' backing items, compares `food_sources.item_version` against a re-fetch,
 *     and re-enqueues only the CHANGED foods via the ORDINARY low-demand `enqueue(food_id,'svc_change_refresh')`
 *     path (deduped via `ON CONFLICT`); `NOT_FOUND`/`FAILED` tombstones are never refreshed (FR-032);
 *   - it expires an `UNRESOLVED` food's `food_candidates` set 30 days after `created_at`
 *     (`FOOD_UNRESOLVED_TTL_DAYS`, config-overridable) — the food STAYS `UNRESOLVED` (FR-025a).
 *
 * The EventBridge-schedule → ECS `RunTask` trigger is infra/CDK (T-001c) and out of this slice's scope;
 * this exercises the runnable task logic directly. No real network/AWS.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ulid } from 'ulidx';
import type pg from 'pg';

import { CandidateStore } from '../src/foods/dao/food-candidates.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/food-sources.dao.js';
import { SourceCallLogDao } from '../src/foods/dao/source-call-log.dao.js';
import { EnqueueEmitter } from '../src/foods/enqueue.emitter.js';
import { makeMergeCandidate } from '../src/foods/merge/__fixtures__/merge.fixtures.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/merge-engine.js';
import { MergeAndPersistService } from '../src/foods/merge/merge-and-persist.service.js';
import {
    SourceAdapterRegistry,
    type CanonicalCandidate,
    type FoodSourceAdapter,
    type SourceCandidate,
} from '../src/sources/food-source-adapter.js';
import { RollingWindowLimiter } from '../src/sources/rolling-window-limiter.js';
import { ChangeRefreshConsumer } from '../src/worker/change-refresh/change-refresh.consumer.js';
import { SilentWorkerLogger } from '../src/worker/worker-logger.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

type FakeUsdaAdapter = FoodSourceAdapter & {
    fetchByKey: Mock<(externalKey: string) => Promise<CanonicalCandidate>>;
};

describe.skipIf(!DATABASE_URL)('ChangeRefreshConsumer (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foodDao: FoodDao;
    let sources: FoodSourcesDao;
    let candidates: CandidateStore;
    let enqueue: EnqueueEmitter;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foodDao = new FoodDao(db);
        sources = new FoodSourcesDao(db);
        candidates = new CandidateStore(db);
        enqueue = new EnqueueEmitter(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /** A fake adapter whose `fetchByKey` returns a per-key programmed itemVersion. */
    function fakeAdapter(versionByKey: Record<string, string>): FakeUsdaAdapter {
        return {
            source: 'usda',
            searchByName: vi.fn<(name: string) => Promise<SourceCandidate[]>>(async () => []),
            fetchByKey: vi.fn<(externalKey: string) => Promise<CanonicalCandidate>>(async (key) =>
                makeMergeCandidate('usda', { externalKey: key, name: key, itemVersion: versionByKey[key] ?? null }),
            ),
        };
    }

    /** Build a consumer over the fake adapter. */
    function build(adapter: FoodSourceAdapter, options?: { unresolvedTtlDays?: number }): ChangeRefreshConsumer {
        const registry = new SourceAdapterRegistry();
        registry.register(adapter);

        return new ChangeRefreshConsumer({
            sources,
            candidates,
            registry,
            limiter: new RollingWindowLimiter(new SourceCallLogDao(db)),
            enqueue,
            logger: new SilentWorkerLogger(),
            unresolvedTtlDays: options?.unresolvedTtlDays ?? 30,
        });
    }

    /** Resolve a single-source food to RESOLVED with one backing item at `itemVersion`. */
    async function seedResolved(normalizedName: string, externalKey: string, itemVersion: string): Promise<string> {
        const { id } = await foodDao.createByName({ normalizedName, displayName: normalizedName });
        const merge = new MergeAndPersistService(db, new GoldenRecordMergeEngine(new SourceAdapterRegistry()));
        await merge.resolveAndPersist({
            foodId: id,
            candidates: [makeMergeCandidate('usda', { externalKey, name: normalizedName, itemVersion })],
        });

        return id;
    }

    /** Count pending queue rows for a food. */
    async function pendingRows(id: string): Promise<number> {
        const res = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1 AND status = 'pending'`,
            [id],
        );

        return res.rows[0]!.n;
    }

    // ── T-170: change detection → re-enqueue only the changed RESOLVED foods ────────────────────────
    it('re-enqueues a RESOLVED food whose backing item changed; leaves an unchanged one alone', async () => {
        const changed = await seedResolved('broccoli', 'ek-broccoli', 'v1');
        const unchanged = await seedResolved('spinach', 'ek-spinach', 'v1');

        // Upstream: broccoli's item moved to v2; spinach is still v1.
        const adapter = fakeAdapter({ 'ek-broccoli': 'v2', 'ek-spinach': 'v1' });
        const consumer = build(adapter);

        const result = await consumer.runOnce();

        expect(result.enqueued).toBe(1);
        expect(await pendingRows(changed)).toBe(1);
        expect(await pendingRows(unchanged)).toBe(0);

        // The enqueue is the ordinary low-demand path: one distinct service requester.
        const requesters = await pool.query<{ requester_id: string }>(
            'SELECT requester_id FROM fetch_requesters WHERE food_id = $1',
            [changed],
        );
        expect(requesters.rows.map((r) => r.requester_id)).toEqual(['svc_change_refresh']);
        const row = await pool.query<{ request_count: number }>(
            'SELECT request_count FROM fetch_queue WHERE food_id = $1',
            [changed],
        );
        expect(row.rows[0]!.request_count).toBe(1);
    });

    it('never refreshes NOT_FOUND / FAILED tombstones (status filter)', async () => {
        // A tombstoned food WITH a backing crosswalk row must still be excluded by the RESOLVED-only scan.
        const notFoundId = ulid();
        await pool.query(`INSERT INTO food (id, name, normalized_name, status) VALUES ($1,$2,$2,'NOT_FOUND')`, [
            notFoundId,
            'phantom',
        ]);
        await pool.query(
            `INSERT INTO food_sources (id, food_id, source, external_key, item_version) VALUES ($1,$2,'usda','ek-phantom','v1')`,
            [ulid(), notFoundId],
        );

        const failedId = ulid();
        await pool.query(`INSERT INTO food (id, name, normalized_name, status) VALUES ($1,$2,$2,'FAILED')`, [
            failedId,
            'broken',
        ]);
        await pool.query(
            `INSERT INTO food_sources (id, food_id, source, external_key, item_version) VALUES ($1,$2,'usda','ek-broken','v1')`,
            [ulid(), failedId],
        );

        const adapter = fakeAdapter({ 'ek-phantom': 'v2', 'ek-broken': 'v2' });
        const consumer = build(adapter);

        const result = await consumer.runOnce();

        expect(result.enqueued).toBe(0);
        expect(adapter.fetchByKey).not.toHaveBeenCalled();
        expect(await pendingRows(notFoundId)).toBe(0);
        expect(await pendingRows(failedId)).toBe(0);
    });

    // ── T-172: UNRESOLVED candidate-set TTL expiry ──────────────────────────────────────────────────
    it('expires an UNRESOLVED candidate set older than the TTL but keeps the food UNRESOLVED', async () => {
        const stale = await foodDao.createByName({ normalizedName: 'stale food', displayName: 'stale food' });
        await foodDao.setStatus({ id: stale.id, status: 'UNRESOLVED' });
        await pool.query(
            `INSERT INTO food_candidates (id, food_id, source, external_key, name, created_at)
             VALUES ($1,$2,'usda','ek-stale','Stale', now() - interval '40 days')`,
            [ulid(), stale.id],
        );

        const recent = await foodDao.createByName({ normalizedName: 'recent food', displayName: 'recent food' });
        await foodDao.setStatus({ id: recent.id, status: 'UNRESOLVED' });
        await pool.query(
            `INSERT INTO food_candidates (id, food_id, source, external_key, name) VALUES ($1,$2,'usda','ek-recent','Recent')`,
            [ulid(), recent.id],
        );

        const consumer = build(fakeAdapter({}));
        const result = await consumer.runOnce();

        expect(result.expiredCandidateRows).toBe(1);
        expect(
            (await pool.query('SELECT count(*)::int AS n FROM food_candidates WHERE food_id = $1', [stale.id])).rows[0]
                .n,
        ).toBe(0);
        expect(
            (await pool.query('SELECT count(*)::int AS n FROM food_candidates WHERE food_id = $1', [recent.id])).rows[0]
                .n,
        ).toBe(1);

        // The food is NEVER swept to NOT_FOUND — it stays UNRESOLVED awaiting a (future) human pick.
        expect((await foodDao.getById(stale.id))?.status).toBe('UNRESOLVED');
        expect((await foodDao.getById(recent.id))?.status).toBe('UNRESOLVED');
    });

    it('honors a configurable FOOD_UNRESOLVED_TTL_DAYS override (a 40-day set survives a 60-day TTL)', async () => {
        const food = await foodDao.createByName({ normalizedName: 'cfg food', displayName: 'cfg food' });
        await foodDao.setStatus({ id: food.id, status: 'UNRESOLVED' });
        await pool.query(
            `INSERT INTO food_candidates (id, food_id, source, external_key, name, created_at)
             VALUES ($1,$2,'usda','ek-cfg','Cfg', now() - interval '40 days')`,
            [ulid(), food.id],
        );

        const consumer = build(fakeAdapter({}), { unresolvedTtlDays: 60 });
        const result = await consumer.runOnce();

        expect(result.expiredCandidateRows).toBe(0);
        expect(
            (await pool.query('SELECT count(*)::int AS n FROM food_candidates WHERE food_id = $1', [food.id])).rows[0]
                .n,
        ).toBe(1);
    });
});

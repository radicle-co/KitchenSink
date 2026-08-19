/**
 * Integration tests for the admin operational-metrics path (T-184) against a REAL Postgres. Seeds
 * fetch_queue rows (pending / in_flight / tombstone), foods in each lifecycle state, and source_call_log
 * rows, then asserts {@link AdminMetricsService} reports the true counts + per-source window utilization.
 *
 * Requirement → test mapping:
 * - FR-039 / US-10 → queue depth (pending/in-flight/tombstone), UNRESOLVED backlog, NOT_FOUND/FAILED
 *   tombstone counts, per-source trailing-60-min window utilization.
 * - FR-019/FR-020 → the per-source window count reflects only calls inside the trailing 60 minutes.
 *
 * Reuses `tests/support/db.ts`; shares one database, resets in `beforeAll`, truncates between cases.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { SourceCallLogDao } from '../src/foods/dao/sourceCallLog.dao.js';
import { AdminMetricsDao } from '../src/foods/admin/adminMetrics.dao.js';
import { AdminMetricsService } from '../src/foods/admin/adminMetrics.service.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** Seed a food in a given lifecycle status; `queued` adds a fetch_queue row with the given status. */
async function seed(
    pool: pg.Pool,
    input: { id: string; status: string; queue?: 'pending' | 'in_flight' | 'tombstone' },
): Promise<void> {
    await pool.query(`INSERT INTO food (id, name, normalized_name, status) VALUES ($1, $1, $1, $2::food_status)`, [
        input.id,
        input.status,
    ]);

    if (input.queue) {
        await pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ($1, $2)`, [input.id, input.queue]);
    }
}

describe.skipIf(!DATABASE_URL)('AdminMetricsService operational signals (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let service: AdminMetricsService;

    beforeAll(async () => {
        pool = makePool();
        await resetSchema(pool);
        db = makeDb(pool);
        // A 1,000/hr cap so utilization is the seeded window count / 1000.
        const limiter = new RollingWindowLimiter(new SourceCallLogDao(db), {
            caps: { usda: { hardCap: 1000, pauseThreshold: 900 } },
        });
        service = new AdminMetricsService(new AdminMetricsDao(db), limiter);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE food, fetch_queue, source_call_log RESTART IDENTITY CASCADE');
    });

    it('reports fetch_queue depths by status (pending / in_flight / tombstone)', async () => {
        await seed(pool, { id: 'p1', status: 'PENDING', queue: 'pending' });
        await seed(pool, { id: 'p2', status: 'PENDING', queue: 'pending' });
        await seed(pool, { id: 'if1', status: 'PENDING', queue: 'in_flight' });
        await seed(pool, { id: 'tomb1', status: 'NOT_FOUND', queue: 'tombstone' });

        const metrics = await service.collect();

        expect(metrics.queue).toEqual({ pending: 2, inFlight: 1, tombstone: 1 });
    });

    it('reports the UNRESOLVED backlog and the NOT_FOUND / FAILED tombstone counts (DSN-9 split)', async () => {
        await seed(pool, { id: 'u1', status: 'UNRESOLVED' });
        await seed(pool, { id: 'u2', status: 'UNRESOLVED' });
        await seed(pool, { id: 'nf1', status: 'NOT_FOUND', queue: 'tombstone' });
        await seed(pool, { id: 'nf2', status: 'NOT_FOUND', queue: 'tombstone' });
        await seed(pool, { id: 'fa1', status: 'FAILED', queue: 'tombstone' });
        await seed(pool, { id: 'r1', status: 'RESOLVED' });

        const metrics = await service.collect();

        expect(metrics.backlog).toEqual({ unresolved: 2, notFound: 2, failed: 1 });
        expect(metrics.queue.tombstone).toBe(3);
    });

    it('reports per-source trailing-60-min window utilization (FR-019/FR-020)', async () => {
        // 3 calls inside the window, 1 aged out (2 hours ago) → window count 3, utilization 3/1000.
        await pool.query(`INSERT INTO source_call_log (source, called_at) VALUES ('usda', now())`);
        await pool.query(
            `INSERT INTO source_call_log (source, called_at) VALUES ('usda', now() - interval '10 minutes')`,
        );
        await pool.query(
            `INSERT INTO source_call_log (source, called_at) VALUES ('usda', now() - interval '59 minutes')`,
        );
        await pool.query(`INSERT INTO source_call_log (source, called_at) VALUES ('usda', now() - interval '2 hours')`);

        const metrics = await service.collect();

        expect(metrics.sources).toHaveLength(1);
        expect(metrics.sources[0]).toMatchObject({
            source: 'usda',
            windowCount: 3,
            hardCap: 1000,
            pauseThreshold: 900,
            paused: false,
        });
        expect(metrics.sources[0]!.utilization).toBeCloseTo(0.003, 6);
    });

    it('returns zeroed signals on an empty store (never throws)', async () => {
        const metrics = await service.collect();

        expect(metrics.queue).toEqual({ pending: 0, inFlight: 0, tombstone: 0 });
        expect(metrics.backlog).toEqual({ unresolved: 0, notFound: 0, failed: 0 });
        expect(metrics.sources[0]).toMatchObject({ windowCount: 0, utilization: 0, paused: false });
    });
});

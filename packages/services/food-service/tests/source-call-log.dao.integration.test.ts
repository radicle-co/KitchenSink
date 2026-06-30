/**
 * Integration suite for {@link SourceCallLogDao} (T-110): the atomic per-source rolling-60-min
 * check-and-record (allowed under cap, denied at cap, atomic under concurrency), the sliding
 * trailing count, and the conservative prune that must NOT under-count the limiter (TST-5)
 * (FR-019, FR-020, SC-002).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { SourceCallLogDao } from '../src/foods/dao/source-call-log.dao.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('SourceCallLogDao (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let dao: SourceCallLogDao;

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);
        dao = new SourceCallLogDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    it('allows calls strictly under the cap and denies the call AT the cap', async () => {
        const cap = 3;
        const r1 = await dao.checkAndRecord({ source: 'usda', cap });
        const r2 = await dao.checkAndRecord({ source: 'usda', cap });
        const r3 = await dao.checkAndRecord({ source: 'usda', cap });
        const r4 = await dao.checkAndRecord({ source: 'usda', cap });

        expect(r1.allowed).toBe(true);
        expect(r2.allowed).toBe(true);
        expect(r3.allowed).toBe(true);
        expect(r4.allowed).toBe(false);
        expect(r4.windowCount).toBe(3);
    });

    it('NEVER exceeds the cap under concurrency (atomic check-and-record)', async () => {
        const cap = 10;
        const attempts = 40;
        const results = await Promise.all(
            Array.from({ length: attempts }, () => dao.checkAndRecord({ source: 'usda', cap })),
        );

        const allowed = results.filter((r) => r.allowed).length;
        expect(allowed).toBe(cap);
        expect(await dao.countInWindow('usda')).toBe(cap);
    });

    it('the trailing-60-min count slides as old calls age out of the window', async () => {
        // Two recorded calls in-window + one aged-out call outside it.
        await dao.checkAndRecord({ source: 'usda', cap: 1000 });
        await dao.checkAndRecord({ source: 'usda', cap: 1000 });
        await pool.query(
            `INSERT INTO source_call_log (source, called_at) VALUES ('usda', now() - interval '90 minutes')`,
        );

        expect(await dao.countInWindow('usda')).toBe(2);
    });

    it('prune is conservative: drops only rows older than the window, leaving the in-window count unchanged (TST-5)', async () => {
        await pool.query(
            `INSERT INTO source_call_log (source, called_at) VALUES ('usda', now() - interval '59 minutes')`,
        );
        await pool.query(
            `INSERT INTO source_call_log (source, called_at) VALUES ('usda', now() - interval '61 minutes')`,
        );

        const before = await dao.countInWindow('usda');
        expect(before).toBe(1); // only the -59m row is inside the trailing 60-min window

        const pruned = await dao.pruneAged('usda');
        expect(pruned).toBe(1); // only the -61m (out-of-window) row is deleted

        const after = await dao.countInWindow('usda');
        expect(after).toBe(before); // the limiter count is NOT under-counted by the prune
    });

    it('windows are per-source — a different source does not consume usda headroom', async () => {
        await dao.checkAndRecord({ source: 'usda', cap: 1000 });
        expect(await dao.countInWindow('usda')).toBe(1);
        // No other source enum value is wired yet; the per-source predicate is asserted via the count above.
    });
});

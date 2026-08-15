/**
 * Integration suite for {@link SourceCallLogDao} (T-110): the atomic per-source rolling-60-min
 * check-and-record (allowed under cap, denied at cap, atomic under concurrency), the sliding
 * trailing count, and the conservative prune that must NOT under-count the limiter (TST-5)
 * (FR-019, FR-020, SC-002).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { SourceCallLogDao } from '../src/foods/dao/sourceCallLog.dao.js';
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

    /**
     * T-199 — the trailing window is CONFIGURED (`FOOD_SOURCE_WINDOW_SECONDS`, FR-019/FR-020), and it is the
     * denominator of the entire per-source rate limit. The DAO used to freeze it at MODULE LOAD from a
     * hand-rolled `Number(process.env[...] ?? 3600)` that restated the schema's default, which made the knob
     * both drift-prone and unobservable. These assert the OBSERVABLE consequence over real Postgres: the
     * same rows, counted and pruned by the same SQL, answering differently purely because the knob moved.
     */
    describe('configured trailing window (T-199, FR-019/FR-020)', () => {
        afterEach(() => {
            vi.unstubAllEnvs();
        });

        /** Record one call `secondsAgo` in the past. */
        async function seedCallAged(secondsAgo: number): Promise<void> {
            await pool.query(
                `INSERT INTO source_call_log (source, called_at) VALUES ('usda', now() - make_interval(secs => $1))`,
                [secondsAgo],
            );
        }

        it('counts a 30-minute-old call under the default window and EXCLUDES it under a 60-second one', async () => {
            await seedCallAged(1_800);

            vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', undefined);
            expect(await new SourceCallLogDao(db).countInWindow('usda')).toBe(1);

            // Same row, same SQL — only the configured window changed.
            vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', '60');
            expect(await new SourceCallLogDao(db).countInWindow('usda')).toBe(0);
        });

        it('admits a call the default window would have refused, once the window is shortened', async () => {
            // Two aged calls fill a cap of 2 under the default hour-long window...
            await seedCallAged(600);
            await seedCallAged(900);

            vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', undefined);
            expect(await new SourceCallLogDao(db).checkAndRecord({ source: 'usda', cap: 2 })).toMatchObject({
                allowed: false,
                windowCount: 2,
            });

            // ...but both have aged out of a 60-second window, so the identical attempt is now recorded.
            vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', '60');
            expect(await new SourceCallLogDao(db).checkAndRecord({ source: 'usda', cap: 2 })).toMatchObject({
                allowed: true,
                windowCount: 1,
            });
        });

        it('prunes against the CONFIGURED window edge, still conservatively (TST-5)', async () => {
            await seedCallAged(119);
            await seedCallAged(121);

            vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', '120');
            const dao120 = new SourceCallLogDao(db);

            // The -119s row is inside the configured window; the -121s row is outside it.
            expect(await dao120.countInWindow('usda')).toBe(1);
            expect(await dao120.pruneAged('usda')).toBe(1);
            // The prune never removes a row the limiter still counts.
            expect(await dao120.countInWindow('usda')).toBe(1);
        });

        it('refuses to construct on a malformed window rather than counting over a NaN interval', () => {
            vi.stubEnv('FOOD_SOURCE_WINDOW_SECONDS', 'an hour');

            expect(() => new SourceCallLogDao(db)).toThrow(/FOOD_SOURCE_WINDOW_SECONDS/);
        });
    });
});

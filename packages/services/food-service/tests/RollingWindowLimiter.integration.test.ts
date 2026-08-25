/**
 * Integration suite for {@link RollingWindowLimiter} (T-122) over a real Postgres `SourceCallLogDao`:
 * allowed strictly under the hard cap, denied AT the cap boundary, the soft 90% pause threshold, the
 * 429-failsafe (treat window full → deny + pause regardless of count), per-source scoping, and
 * atomicity under concurrency (FR-019, FR-020, FR-021, FR-026, SC-002).
 *
 * Caps are injected small so the boundary is cheap to exercise; the production caps are the CONFIGURED
 * ones (`FOOD_SOURCE_RATE_LIMIT_PER_HOUR`, default 1,000 → pause at 900), which the limiter resolves
 * itself via `sourceCapsFromEnv` when a caller passes none — see `src/sources/__tests__`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { SourceCallLogDao } from '../src/foods/dao/sourceCallLog.dao.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('RollingWindowLimiter (integration)', () => {
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

    it('records calls strictly under the hard cap and denies the call AT the cap', async () => {
        const limiter = new RollingWindowLimiter(dao, { caps: { usda: { hardCap: 3, pauseThreshold: 3 } } });

        const r1 = await limiter.tryRecord('usda', 'interactive');
        const r2 = await limiter.tryRecord('usda', 'interactive');
        const r3 = await limiter.tryRecord('usda', 'interactive');
        const r4 = await limiter.tryRecord('usda', 'interactive');

        expect(r1.allowed).toBe(true);
        expect(r2.allowed).toBe(true);
        expect(r3.allowed).toBe(true);
        expect(r4.allowed).toBe(false);
        expect(r4.windowCount).toBe(3);
        expect(await limiter.count('usda')).toBe(3);
    });

    it('isPaused flips at the 90% pause threshold, below the hard cap', async () => {
        const limiter = new RollingWindowLimiter(dao, { caps: { usda: { hardCap: 10, pauseThreshold: 3 } } });

        await limiter.tryRecord('usda', 'interactive');
        await limiter.tryRecord('usda', 'interactive');
        expect(await limiter.isPaused('usda')).toBe(false); // 2 < 3

        await limiter.tryRecord('usda', 'interactive');
        expect(await limiter.isPaused('usda')).toBe(true); // 3 >= 3, still under the hard cap of 10
    });

    it('429 failsafe: markWindowFull denies tryRecord and pauses even when the count is under cap', async () => {
        const limiter = new RollingWindowLimiter(dao, {
            caps: { usda: { hardCap: 10, pauseThreshold: 9 } },
            backoffMs: 60_000,
        });

        await limiter.tryRecord('usda', 'interactive'); // count = 1, far below cap and pause threshold

        limiter.markWindowFull('usda');

        expect(await limiter.isPaused('usda')).toBe(true);
        const denied = await limiter.tryRecord('usda', 'interactive');
        expect(denied.allowed).toBe(false);
        // The failsafe must NOT have recorded a call — the count is unchanged at 1.
        expect(await limiter.count('usda')).toBe(1);
    });

    it('429 failsafe expires after the back-off elapses (injected clock)', async () => {
        let clock = 1_000_000;
        const limiter = new RollingWindowLimiter(dao, {
            caps: { usda: { hardCap: 10, pauseThreshold: 9 } },
            backoffMs: 5_000,
            now: () => clock,
        });

        limiter.markWindowFull('usda');
        expect(await limiter.isPaused('usda')).toBe(true);

        clock += 5_001; // past the back-off window
        expect(await limiter.isPaused('usda')).toBe(false);
        expect((await limiter.tryRecord('usda', 'interactive')).allowed).toBe(true);
    });

    it('is per-source: the usda window counts only usda calls', async () => {
        const limiter = new RollingWindowLimiter(dao, { caps: { usda: { hardCap: 10, pauseThreshold: 9 } } });

        await limiter.tryRecord('usda', 'interactive');
        await limiter.tryRecord('usda', 'interactive');

        // Only the `usda` enum value is wired today; the per-source WHERE predicate is asserted via the
        // count reflecting exactly the usda calls (mirrors sourceCallLog.dao.integration.test.ts).
        expect(await limiter.count('usda')).toBe(2);
    });

    it('NEVER exceeds the hard cap under concurrency (atomic check-and-record)', async () => {
        const cap = 10;
        const limiter = new RollingWindowLimiter(dao, { caps: { usda: { hardCap: cap, pauseThreshold: cap } } });

        const results = await Promise.all(Array.from({ length: 40 }, () => limiter.tryRecord('usda', 'interactive')));

        const allowed = results.filter((r) => r.allowed).length;
        expect(allowed).toBe(cap);
        expect(await limiter.count('usda')).toBe(cap);
    });

    it('pruneAged drops only out-of-window rows, never under-counting the live window (TST-5)', async () => {
        const limiter = new RollingWindowLimiter(dao);
        await pool.query(
            `INSERT INTO source_call_log (source, called_at) VALUES ('usda', now() - interval '59 minutes')`,
        );
        await pool.query(
            `INSERT INTO source_call_log (source, called_at) VALUES ('usda', now() - interval '61 minutes')`,
        );

        const before = await limiter.count('usda');
        expect(before).toBe(1);

        const pruned = await limiter.pruneAged('usda');
        expect(pruned).toBe(1);
        expect(await limiter.count('usda')).toBe(before);
    });

    /**
     * F-W1 (plan U29) — the reserved interactive lane, over a REAL ledger.
     *
     * The unit suite proves the limiter's arithmetic against an in-memory ledger; these prove the same
     * guarantee survives the real SQL, the real enum and the real advisory lock — the three things a
     * double cannot vouch for. Caps are `hardCap: 10 / pauseThreshold: 9`, so the reserve is exactly one
     * call and every boundary below is one row wide.
     *
     * ⚠️ Every case above this block passes `'interactive'` after the split, and that is not a weakening:
     * their subject was "the HARD cap", which is precisely the interactive lane's ceiling. Each still
     * asserts the identical numbers it asserted before F-W1.
     */
    describe('interactive vs worker lanes (F-W1, FR-019)', () => {
        const caps = { usda: { hardCap: 10, pauseThreshold: 9 } } as const;

        /** Fill the window with `count` rows already attributed to the background drain. */
        async function seedWorkerCalls(count: number): Promise<void> {
            await pool.query(
                `INSERT INTO source_call_log (source, channel, called_at)
                 SELECT 'usda', 'worker', now() FROM generate_series(1, $1)`,
                [count],
            );
        }

        it('admits a waiting human into the reserve the drain has just been shut out of', async () => {
            const limiter = new RollingWindowLimiter(dao, { caps });
            await seedWorkerCalls(9);

            // ⛔ THE mutation this suite exists to catch. Charge the drain's budget here instead of the
            // interactive lane and the cook's search is refused with a tenth of the key still unspent —
            // while the drain, which is what filled the window, is correctly refused.
            await expect(limiter.tryRecord('usda', 'interactive')).resolves.toMatchObject({ allowed: true });
            await expect(limiter.tryRecord('usda', 'worker')).resolves.toMatchObject({ allowed: false });

            // ...and the ledger says so, which is the other half: a reserve nobody can measure is a claim,
            // not a guarantee.
            expect(await limiter.count('usda', 'interactive')).toBe(1);
            expect(await limiter.count('usda', 'worker')).toBe(9);
            expect(await limiter.count('usda')).toBe(10);
        });

        it('refuses the interactive lane at the hard cap — the reserve is a floor, not an exemption (SC-002)', async () => {
            const limiter = new RollingWindowLimiter(dao, { caps });
            await seedWorkerCalls(10);

            await expect(limiter.tryRecord('usda', 'interactive')).resolves.toMatchObject({ allowed: false });
            expect(await limiter.count('usda')).toBe(10);
        });

        it('counts the interactive lane against the drain — one shared quota, not two budgets', async () => {
            const limiter = new RollingWindowLimiter(dao, { caps });

            for (let index = 0; index < 9; index += 1) {
                await limiter.tryRecord('usda', 'interactive');
            }

            // The drain has spent NOTHING, and is still at its ceiling: per-lane counting would admit here
            // and let the two lanes together reach 19 calls against a key that permits 10.
            await expect(limiter.tryRecord('usda', 'worker')).resolves.toMatchObject({ allowed: false });
            expect(await limiter.count('usda', 'worker')).toBe(0);
        });

        it('never overshoots the hard cap when both lanes charge concurrently', async () => {
            const limiter = new RollingWindowLimiter(dao, { caps });

            const results = await Promise.all(
                Array.from({ length: 40 }, (_unused, index) =>
                    limiter.tryRecord('usda', index % 2 === 0 ? 'interactive' : 'worker'),
                ),
            );

            // The aggregate can never exceed the hard cap however the lanes interleave; the worker's own
            // share is separately bounded by its lower ceiling.
            expect(results.filter((result) => result.allowed).length).toBeLessThanOrEqual(caps.usda.hardCap);
            expect(await limiter.count('usda')).toBeLessThanOrEqual(caps.usda.hardCap);
            expect(await limiter.count('usda', 'worker')).toBeLessThanOrEqual(caps.usda.pauseThreshold);
        });
    });
});

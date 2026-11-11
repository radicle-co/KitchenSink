/**
 * `purgeFinishedImports` — the 30-day retention bound on a bulk import's working data (ADR-0072 §9).
 *
 * The SQL itself is a claim about the database and is proved by the LOCAL e2e (`tests/e2e/import/importPurge.e2e.test.ts`).
 * What this tier proves is the LOOP: it deletes in bounded batches, stops at the first short batch, never runs past its
 * per-tick cap, and passes the horizon and the batch size as parameters (never spliced into the text).
 */
import { describe, expect, it, vi } from 'vitest';

import type { EmfMetric } from '../../common/metrics.js';

import {
    IMPORT_PURGE_AFTER_DAYS,
    IMPORT_PURGE_BATCH_SIZE,
    IMPORT_PURGE_MAX_BATCHES_PER_TICK,
    IMPORT_PURGE_TIME_BUDGET_MS,
    IMPORT_METRIC_NAMESPACE,
    IMPORTS_PURGED_METRIC_NAME,
    OLDEST_IMPORT_AGE_METRIC_NAME,
    purgeFinishedImports,
    runImportPurge,
} from '../importPurge.js';

/** A pool whose successive batches delete the given counts. */
function poolDeleting(...counts: number[]) {
    const query = vi.fn(async (_text: string, _params: unknown[]) => ({
        rows: [{ n: counts[query.mock.calls.length - 1] ?? 0 }],
    }));

    return { query };
}

describe('purgeFinishedImports', () => {
    it('keeps an import for 30 days after its last write', () => {
        expect(IMPORT_PURGE_AFTER_DAYS).toBe(30);
    });

    it('does one batch and stops when there is nothing to delete', async () => {
        const pool = poolDeleting(0);

        expect(await purgeFinishedImports(pool)).toBe(0);
        expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('stops at the first batch that is shorter than the batch size', async () => {
        const short = IMPORT_PURGE_BATCH_SIZE - 1;
        const pool = poolDeleting(IMPORT_PURGE_BATCH_SIZE, short);

        expect(await purgeFinishedImports(pool)).toBe(IMPORT_PURGE_BATCH_SIZE + short);
        expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('stops at the per-tick cap even when every batch is full, and leaves the rest for the next tick', async () => {
        const pool = poolDeleting(
            ...Array.from({ length: IMPORT_PURGE_MAX_BATCHES_PER_TICK + 20 }, () => IMPORT_PURGE_BATCH_SIZE),
        );

        expect(await purgeFinishedImports(pool)).toBe(IMPORT_PURGE_BATCH_SIZE * IMPORT_PURGE_MAX_BATCHES_PER_TICK);
        expect(pool.query).toHaveBeenCalledTimes(IMPORT_PURGE_MAX_BATCHES_PER_TICK);
    });

    it('⛔ stops when the time budget is spent, even with full batches left: the host Lambda has 60 seconds for three sweeps', async () => {
        const pool = poolDeleting(...Array.from({ length: 50 }, () => IMPORT_PURGE_BATCH_SIZE));
        let now = 0;

        const clock = () => {
            now += IMPORT_PURGE_TIME_BUDGET_MS / 4;

            return now;
        };

        const deleted = await purgeFinishedImports(pool, clock);

        // The clock is read once at the start and once after each full batch, and moves a quarter of the budget per read:
        // after the fourth batch a whole budget has passed.
        expect(pool.query.mock.calls.length).toBeLessThan(IMPORT_PURGE_MAX_BATCHES_PER_TICK);
        expect(pool.query).toHaveBeenCalledTimes(4);
        expect(deleted).toBe(IMPORT_PURGE_BATCH_SIZE * 4);
    });

    it('passes the horizon and the batch size as parameters, and reads the last WRITE (updated_at), not the creation', async () => {
        const pool = poolDeleting(0);

        await purgeFinishedImports(pool);

        const [text, params] = pool.query.mock.calls[0] ?? ['', []];

        expect(params).toStrictEqual([String(IMPORT_PURGE_AFTER_DAYS), IMPORT_PURGE_BATCH_SIZE]);
        expect(text).toMatch(/DELETE FROM recipe_imports/);
        expect(text).toMatch(/updated_at\s*</);
        expect(text).not.toMatch(/created_at/);
        expect(text).not.toContain(String(IMPORT_PURGE_AFTER_DAYS) + ' days');
    });

    it('lets a database failure through, so the tick fails loudly rather than keeping data past its bound in silence', async () => {
        const pool = { query: vi.fn().mockRejectedValue(new Error('connection reset')) };

        await expect(purgeFinishedImports(pool)).rejects.toThrow('connection reset');
    });
});

/**
 * `runImportPurge` — the purge plus what an operator sees of it (review finding 6 on #185-#188): a purged count and the
 * age of the oldest import still held, both with `Stage` (ADR-0062). Before this the purge logged only when it deleted
 * something, so a purge that had stopped, or fallen behind, looked exactly like one with nothing to do.
 */
describe('runImportPurge', () => {
    const STAGE = 'pr-7';

    /** A pool whose purge batches answer `purged` (then a short batch) and whose age read answers `ageSeconds`. */
    function poolWith(options: { purged?: number; ageSeconds?: number; purgeFails?: boolean; ageFails?: boolean }) {
        const query = vi.fn(async (text: string) => {
            if (/DELETE FROM recipe_imports/u.test(text)) {
                if (options.purgeFails === true) {
                    throw new Error('purge failed');
                }

                return { rows: [{ n: query.mock.calls.length === 1 ? (options.purged ?? 0) : 0 }] };
            }

            if (options.ageFails === true) {
                throw new Error('age read failed');
            }

            return { rows: [{ age: options.ageSeconds ?? 0 }] };
        });

        return { query };
    }

    it('⛔ publishes the purged count EVERY tick, zero included, so a stopped purge is not mistaken for an idle one', async () => {
        const emit = vi.fn<(metric: EmfMetric) => void>();

        await runImportPurge({ pool: poolWith({ purged: 0 }), stage: STAGE, emit });

        expect(emit).toHaveBeenCalledWith({
            namespace: IMPORT_METRIC_NAMESPACE,
            name: IMPORTS_PURGED_METRIC_NAME,
            unit: 'Count',
            stage: STAGE,
            value: 0,
        });
    });

    it('publishes how many imports it deleted, and the age of the oldest import left, after the delete', async () => {
        const emit = vi.fn<(metric: EmfMetric) => void>();
        const pool = poolWith({ purged: 2, ageSeconds: 86_400 });

        await runImportPurge({ pool, stage: STAGE, emit });

        expect(emit.mock.calls.map(([metric]) => metric)).toStrictEqual([
            {
                namespace: IMPORT_METRIC_NAMESPACE,
                name: IMPORTS_PURGED_METRIC_NAME,
                unit: 'Count',
                stage: STAGE,
                value: 2,
            },
            {
                namespace: IMPORT_METRIC_NAMESPACE,
                name: OLDEST_IMPORT_AGE_METRIC_NAME,
                unit: 'Seconds',
                stage: STAGE,
                value: 86_400,
            },
        ]);
        // The age is read AFTER the delete: it reports what the purge left, not what it was about to clear.
        expect(pool.query.mock.calls.at(-1)?.[0]).not.toMatch(/DELETE/u);
    });

    it('⛔ still publishes the oldest age when the purge fails, then fails the tick: the age is how a broken purge shows', async () => {
        const emit = vi.fn<(metric: EmfMetric) => void>();

        await expect(
            runImportPurge({ pool: poolWith({ purgeFails: true, ageSeconds: 3_000_000 }), stage: STAGE, emit }),
        ).rejects.toThrow('purge failed');

        expect(emit.mock.calls.map(([metric]) => metric.name)).toStrictEqual([OLDEST_IMPORT_AGE_METRIC_NAME]);
    });

    it('swallows its own age-read failure, so observation never fails a purge that worked', async () => {
        const emit = vi.fn<(metric: EmfMetric) => void>();

        await runImportPurge({ pool: poolWith({ purged: 1, ageFails: true }), stage: STAGE, emit });

        expect(emit.mock.calls.map(([metric]) => metric.name)).toStrictEqual([IMPORTS_PURGED_METRIC_NAME]);
    });
});

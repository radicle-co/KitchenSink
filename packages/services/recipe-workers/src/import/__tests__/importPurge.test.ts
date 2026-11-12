/**
 * `purgeFinishedImports` — the 30-day retention bound on a bulk import's working data (ADR-0072 §9).
 *
 * The SQL itself is a claim about the database and is proved by the LOCAL e2e (`tests/e2e/import/importPurge.e2e.test.ts`).
 * What this tier proves is the LOOP: it deletes in bounded batches, stops at the first short batch, never runs past its
 * per-tick cap, and passes the horizon and the batch size as parameters (never spliced into the text). Since the review of
 * #191 it also proves each batch's TRANSACTION: its own, with a transaction-local `lock_timeout`, so a lock the delete waits
 * on (a cook's lock on an ingredient whose link it sets to NULL) costs the tick a few seconds, not the host's whole minute.
 */
import { describe, expect, it, vi } from 'vitest';

import type { EmfMetric } from '../../common/metrics.js';

import {
    IMPORT_PURGE_AFTER_DAYS,
    IMPORT_PURGE_BATCH_SIZE,
    IMPORT_PURGE_LOCK_TIMEOUT_MS,
    IMPORT_PURGE_MAX_BATCHES_PER_TICK,
    IMPORT_PURGE_TIME_BUDGET_MS,
    IMPORT_METRIC_NAMESPACE,
    IMPORTS_PURGED_METRIC_NAME,
    OLDEST_IMPORT_AGE_METRIC_NAME,
    purgeFinishedImports,
    runImportPurge,
} from '../importPurge.js';

const DELETE = /DELETE FROM recipe_imports/u;

/** A Postgres error as `pg` raises it: a message and a SQLSTATE `code`. */
function pgError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code });
}

/**
 * A pool whose successive DELETE batches answer the given counts (or throw `deleteFails`), through ONE client that records
 * every statement it is sent; `query` on the pool itself answers the age read with `ageSeconds` (or throws `ageFails`).
 */
function purgePool(
    counts: readonly number[],
    options: { deleteFails?: Error; ageSeconds?: number; ageFails?: boolean } = {},
) {
    const sent: { text: string; params: unknown[] }[] = [];
    const order: string[] = [];
    const release = vi.fn<(destroy?: Error | boolean) => void>();
    let deletes = 0;

    const client = {
        query: vi.fn(async (text: string, params: unknown[] = []) => {
            sent.push({ text, params });
            order.push(DELETE.test(text) ? 'delete' : (text.trim().split(/\s+/u)[0] ?? ''));

            if (DELETE.test(text)) {
                deletes += 1;

                if (options.deleteFails !== undefined) {
                    throw options.deleteFails;
                }

                return { rows: [{ n: counts[deletes - 1] ?? 0 }] };
            }

            return { rows: [] };
        }),
        release,
    };

    const pool = {
        query: vi.fn(async (_text: string, _params: unknown[]) => {
            order.push('age');

            if (options.ageFails === true) {
                throw new Error('age read failed');
            }

            return { rows: [{ age: options.ageSeconds ?? 0 }] };
        }),
        connect: vi.fn(async () => client),
    };

    return { pool, client, sent, order, release, deletesSent: () => deletes };
}

/** A pool whose successive batches delete the given counts. */
function poolDeleting(...counts: number[]) {
    return purgePool(counts);
}

describe('purgeFinishedImports', () => {
    it('keeps an import for 30 days after its last write', () => {
        expect(IMPORT_PURGE_AFTER_DAYS).toBe(30);
    });

    it('does one batch and stops when there is nothing to delete', async () => {
        const { pool, deletesSent } = poolDeleting(0);

        expect(await purgeFinishedImports(pool)).toBe(0);
        expect(deletesSent()).toBe(1);
    });

    it('stops at the first batch that is shorter than the batch size', async () => {
        const short = IMPORT_PURGE_BATCH_SIZE - 1;
        const { pool, deletesSent } = poolDeleting(IMPORT_PURGE_BATCH_SIZE, short);

        expect(await purgeFinishedImports(pool)).toBe(IMPORT_PURGE_BATCH_SIZE + short);
        expect(deletesSent()).toBe(2);
    });

    it('stops at the per-tick cap even when every batch is full, and leaves the rest for the next tick', async () => {
        const { pool, deletesSent } = poolDeleting(
            ...Array.from({ length: IMPORT_PURGE_MAX_BATCHES_PER_TICK + 20 }, () => IMPORT_PURGE_BATCH_SIZE),
        );

        expect(await purgeFinishedImports(pool)).toBe(IMPORT_PURGE_BATCH_SIZE * IMPORT_PURGE_MAX_BATCHES_PER_TICK);
        expect(deletesSent()).toBe(IMPORT_PURGE_MAX_BATCHES_PER_TICK);
    });

    it('⛔ stops when the time budget is spent, even with full batches left: the host Lambda has 60 seconds for three sweeps', async () => {
        const { pool, deletesSent } = poolDeleting(...Array.from({ length: 50 }, () => IMPORT_PURGE_BATCH_SIZE));
        let now = 0;

        const clock = () => {
            now += IMPORT_PURGE_TIME_BUDGET_MS / 4;

            return now;
        };

        const deleted = await purgeFinishedImports(pool, clock);

        // The clock is read once at the start and once after each full batch, and moves a quarter of the budget per read:
        // after the fourth batch a whole budget has passed.
        expect(deletesSent()).toBe(4);
        expect(deleted).toBe(IMPORT_PURGE_BATCH_SIZE * 4);
    });

    it('passes the horizon and the batch size as parameters, and reads the last WRITE (updated_at), not the creation', async () => {
        const { pool, sent } = poolDeleting(0);

        await purgeFinishedImports(pool);

        const { text, params } = sent.find((statement) => DELETE.test(statement.text)) ?? { text: '', params: [] };

        expect(params).toStrictEqual([String(IMPORT_PURGE_AFTER_DAYS), IMPORT_PURGE_BATCH_SIZE]);
        expect(text).toMatch(/DELETE FROM recipe_imports/);
        expect(text).toMatch(/updated_at\s*</);
        expect(text).not.toMatch(/created_at/);
        expect(text).not.toContain(String(IMPORT_PURGE_AFTER_DAYS) + ' days');
    });

    it('lets a database failure through, so the tick fails loudly rather than keeping data past its bound in silence', async () => {
        const { pool } = purgePool([], { deleteFails: new Error('connection reset') });

        await expect(purgeFinishedImports(pool)).rejects.toThrow('connection reset');
    });

    it('⛔ runs each batch in its own transaction, with a transaction-local lock timeout set before the delete', async () => {
        const { pool, order, sent } = poolDeleting(IMPORT_PURGE_BATCH_SIZE, 0);

        await purgeFinishedImports(pool);

        expect(order).toStrictEqual(['BEGIN', 'SELECT', 'delete', 'COMMIT', 'BEGIN', 'SELECT', 'delete', 'COMMIT']);

        const setting = sent[1];

        // `set_config(…, true)` is `SET LOCAL`: it ends with the transaction, so the pooled connection keeps no setting.
        expect(setting?.text).toMatch(/set_config\('lock_timeout',\s*\$1,\s*true\)/u);
        expect(setting?.params).toStrictEqual([`${IMPORT_PURGE_LOCK_TIMEOUT_MS}ms`]);
    });

    it('waits for a lock far less than the time budget, so one stuck batch cannot take the host’s minute', () => {
        expect(IMPORT_PURGE_LOCK_TIMEOUT_MS).toBeGreaterThan(0);
        expect(IMPORT_PURGE_LOCK_TIMEOUT_MS).toBeLessThanOrEqual(IMPORT_PURGE_TIME_BUDGET_MS / 4);
    });

    it('⛔ stops the tick quietly on a lock timeout: it rolls the batch back, keeps what earlier batches deleted, and waits for the next tick', async () => {
        const { pool, order, release } = purgePool([], {
            deleteFails: pgError('canceling statement due to lock timeout', '55P03'),
        });

        expect(await purgeFinishedImports(pool)).toBe(0);
        expect(order).toStrictEqual(['BEGIN', 'SELECT', 'delete', 'ROLLBACK']);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('rolls back and throws any other failure, and destroys the connection rather than pool it', async () => {
        const failure = pgError('deadlock detected', '40P01');
        const { pool, order, release } = purgePool([], { deleteFails: failure });

        await expect(purgeFinishedImports(pool)).rejects.toBe(failure);
        expect(order).toStrictEqual(['BEGIN', 'SELECT', 'delete', 'ROLLBACK']);
        expect(release).toHaveBeenCalledWith(failure);
    });

    it('returns its connection to the pool after a clean run', async () => {
        const { pool, release } = poolDeleting(0);

        await purgeFinishedImports(pool);

        expect(pool.connect).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledWith(undefined);
    });
});

/**
 * `runImportPurge` — the purge plus what an operator sees of it (review finding 6 on #185-#188): a purged count and the
 * age of the oldest import still held, both with `Stage` (ADR-0062). Before this the purge logged only when it deleted
 * something, so a purge that had stopped, or fallen behind, looked exactly like one with nothing to do.
 */
describe('runImportPurge', () => {
    const STAGE = 'pr-7';

    it('⛔ publishes the purged count EVERY tick, zero included, so a stopped purge is not mistaken for an idle one', async () => {
        const emit = vi.fn<(metric: EmfMetric) => void>();

        await runImportPurge({ pool: purgePool([0]).pool, stage: STAGE, emit });

        expect(emit).toHaveBeenCalledWith({
            namespace: IMPORT_METRIC_NAMESPACE,
            name: IMPORTS_PURGED_METRIC_NAME,
            unit: 'Count',
            stage: STAGE,
            value: 0,
        });
    });

    /**
     * Review of #191: the age was published in a `finally` AFTER the delete, so a delete that hung to the host's timeout
     * never published it, and the alarm (`NOT_BREACHING`) stayed OK. The age now goes FIRST, before any delete can hang.
     */
    it('⛔ publishes the age of the oldest import BEFORE it deletes anything, then how many it deleted', async () => {
        const emit = vi.fn<(metric: EmfMetric) => void>();
        const { pool, order } = purgePool([2], { ageSeconds: 86_400 });

        await runImportPurge({ pool, stage: STAGE, emit });

        expect(emit.mock.calls.map(([metric]) => metric)).toStrictEqual([
            {
                namespace: IMPORT_METRIC_NAMESPACE,
                name: OLDEST_IMPORT_AGE_METRIC_NAME,
                unit: 'Seconds',
                stage: STAGE,
                value: 86_400,
            },
            {
                namespace: IMPORT_METRIC_NAMESPACE,
                name: IMPORTS_PURGED_METRIC_NAME,
                unit: 'Count',
                stage: STAGE,
                value: 2,
            },
        ]);
        expect(order.indexOf('age')).toBeLessThan(order.indexOf('delete'));
    });

    it('⛔ fails the tick when the purge fails, with the age already published: the age is how a broken purge shows', async () => {
        const emit = vi.fn<(metric: EmfMetric) => void>();
        const { pool } = purgePool([], { deleteFails: new Error('purge failed'), ageSeconds: 3_000_000 });

        await expect(runImportPurge({ pool, stage: STAGE, emit })).rejects.toThrow('purge failed');

        expect(emit.mock.calls.map(([metric]) => metric.name)).toStrictEqual([OLDEST_IMPORT_AGE_METRIC_NAME]);
    });

    it('swallows its own age-read failure and still purges, so observation never stops the purge', async () => {
        const emit = vi.fn<(metric: EmfMetric) => void>();

        await runImportPurge({ pool: purgePool([1], { ageFails: true }).pool, stage: STAGE, emit });

        expect(emit.mock.calls.map(([metric]) => metric.name)).toStrictEqual([IMPORTS_PURGED_METRIC_NAME]);
    });
});

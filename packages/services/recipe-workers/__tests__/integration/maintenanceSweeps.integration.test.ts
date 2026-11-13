/**
 * The band drain's MAINTENANCE TICK: after the drain, the parse-job TTL sweep, the stall gauge and the bulk import purge
 * run in that order on one pool (ADR-0072 §9), with their real SQL against a pool double that records it.
 *
 * What it pins: the purge runs LAST (so its failure costs the other sweeps nothing), and a purge failure FAILS the tick
 * (the data is user content past its retention bound), while the gauge's own read failure does not. Since review finding 6
 * on #185-#188 the purge also publishes its count and the age of the oldest import left (ADR-0062: both with `Stage`), and
 * that age is published even when the purge fails, because it is how a broken purge shows. Since the review of #191 that
 * age is read BEFORE the purge deletes anything (a delete that hangs can no longer keep it unpublished), the purge runs in
 * its own transactions on a client of its own, and every sweep runs even when an earlier one fails.
 */
import { describe, expect, it, vi } from 'vitest';

import { logger } from '../../src/common/logger.js';
import type { EmfMetric } from '../../src/common/metrics.js';
import { runMaintenanceSweeps } from '../../src/handlers/bandDrain.js';

type Step = 'expire' | 'gauge' | 'purge' | 'importAge' | 'other';

/** Which sweep a statement belongs to, read from its SQL. */
function stepOf(sql: string): Step {
    if (/DELETE FROM recipe_imports/u.test(sql)) {
        return 'purge';
    }

    if (/FROM recipe_imports/u.test(sql)) {
        return 'importAge';
    }

    if (/recipe_parse_jobs/u.test(sql) && /UPDATE|DELETE/u.test(sql)) {
        return 'expire';
    }

    if (/recipe_parse_jobs/u.test(sql)) {
        return 'gauge';
    }

    return 'other';
}

/**
 * A pool that records the sweep each statement belongs to (on the pool, or on a client it hands out), answers every read
 * with one zero row, and throws on the steps named in `failing`. `steps` leaves out the transaction control ('other').
 */
function recordingPool(failing: readonly Step[] = []) {
    const steps: Step[] = [];

    async function query(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
        const step = stepOf(sql);

        if (step !== 'other') {
            steps.push(step);
        }

        if (failing.includes(step)) {
            throw new Error(`${step} failed`);
        }

        return { rows: [{ n: 0, age: 0, count: 0 }], rowCount: 0 };
    }

    return {
        steps,
        pool: { query, connect: async () => ({ query, release: () => undefined }) },
    };
}

describe('the maintenance sweeps after the band drain (integration)', () => {
    it('runs the TTL sweep, then the stall gauge, then the import age read, then the bulk import purge, last', async () => {
        const { steps, pool } = recordingPool();
        const emitted: EmfMetric[] = [];

        await runMaintenanceSweeps({ pool, stage: 'pr-1', emit: (metric) => emitted.push(metric) });

        const firsts = steps.filter((step, index) => step !== steps[index - 1]);

        expect(firsts.slice(-2)).toStrictEqual(['importAge', 'purge']);
        expect(firsts.indexOf('expire')).toBeLessThan(firsts.indexOf('gauge'));
        expect(firsts.indexOf('gauge')).toBeLessThan(firsts.indexOf('purge'));
        expect(emitted.map((metric) => [metric.name, metric.stage])).toStrictEqual([
            ['OldestRunningParseJobAgeSeconds', 'pr-1'],
            ['OldestBulkImportAgeSeconds', 'pr-1'],
            ['BulkImportsPurged', 'pr-1'],
        ]);
    });

    it('⛔ fails the tick when the purge fails, after the other sweeps ran and with the import age still published', async () => {
        const { steps, pool } = recordingPool(['purge']);
        const emitted: EmfMetric[] = [];

        await expect(
            runMaintenanceSweeps({ pool, stage: 'pr-1', emit: (metric) => emitted.push(metric) }),
        ).rejects.toThrow('purge failed');
        expect(steps).toContain('expire');
        expect(steps).toContain('gauge');
        expect(emitted.map((metric) => metric.name)).toContain('OldestBulkImportAgeSeconds');
        expect(emitted.map((metric) => metric.name)).not.toContain('BulkImportsPurged');
    });

    it('still purges when the stall gauge cannot read (the gauge is observation, not work)', async () => {
        const { steps, pool } = recordingPool(['gauge']);

        await runMaintenanceSweeps({ pool, stage: 'pr-1', emit: () => undefined });

        expect(steps).toContain('purge');
    });

    /** Review of #191: the sweeps ran one after another, so a TTL sweep that threw also stopped the purge. */
    it('⛔ still runs the gauge and the purge when the TTL sweep fails, then fails the tick with the sweep’s error', async () => {
        const { steps, pool } = recordingPool(['expire']);

        await expect(runMaintenanceSweeps({ pool, stage: 'pr-1', emit: () => undefined })).rejects.toThrow(
            'expire failed',
        );
        expect(steps).toContain('gauge');
        expect(steps).toContain('purge');
    });

    it('⛔ reports both when the TTL sweep and the purge fail, each logged on its own', async () => {
        const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const { pool } = recordingPool(['expire', 'purge']);

        try {
            const failure: unknown = await runMaintenanceSweeps({ pool, stage: 'pr-1', emit: () => undefined }).catch(
                (error: unknown) => error,
            );

            expect(failure).toBeInstanceOf(AggregateError);
            expect((failure as AggregateError).errors.map((error: Error) => error.message)).toStrictEqual([
                'expire failed',
                'purge failed',
            ]);
            expect(errors).toHaveBeenCalledTimes(2);
        } finally {
            errors.mockRestore();
        }
    });
});

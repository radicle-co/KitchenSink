/**
 * The band drain's MAINTENANCE TICK: after the drain, the parse-job TTL sweep, the stall gauge and the bulk import purge
 * run in that order on one pool (ADR-0072 §9), with their real SQL against a pool double that records it.
 *
 * What it pins: the purge runs LAST (so its failure costs the other sweeps nothing), and a purge failure FAILS the tick
 * (the data is user content past its retention bound), while the gauge's own read failure does not.
 */
import { describe, expect, it } from 'vitest';

import type { EmfMetric } from '../../src/common/metrics.js';
import { runMaintenanceSweeps } from '../../src/handlers/bandDrain.js';

type Step = 'expire' | 'gauge' | 'purge' | 'other';

/** Which sweep a statement belongs to, read from its SQL. */
function stepOf(sql: string): Step {
    if (/DELETE FROM recipe_imports/u.test(sql)) {
        return 'purge';
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
 * A pool that records the sweep each statement belongs to, answers every read with one zero row, and throws on the
 * steps named in `failing`.
 */
function recordingPool(failing: readonly Step[] = []) {
    const steps: Step[] = [];

    return {
        steps,
        pool: {
            async query(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
                const step = stepOf(sql);

                steps.push(step);

                if (failing.includes(step)) {
                    throw new Error(`${step} failed`);
                }

                return { rows: [{ n: 0, age_seconds: 0, count: 0 }], rowCount: 0 };
            },
        },
    };
}

describe('the maintenance sweeps after the band drain (integration)', () => {
    it('runs the TTL sweep, then the stall gauge, then the bulk import purge, last', async () => {
        const { steps, pool } = recordingPool();
        const emitted: EmfMetric[] = [];

        await runMaintenanceSweeps({ pool, stage: 'pr-1', emit: (metric) => emitted.push(metric) });

        const firsts = steps.filter((step, index) => step !== steps[index - 1]);

        expect(firsts.at(-1)).toBe('purge');
        expect(firsts.indexOf('expire')).toBeLessThan(firsts.indexOf('gauge'));
        expect(firsts.indexOf('gauge')).toBeLessThan(firsts.indexOf('purge'));
        expect(emitted).toHaveLength(1);
    });

    it('⛔ fails the tick when the purge fails, after the other sweeps ran', async () => {
        const { steps, pool } = recordingPool(['purge']);

        await expect(runMaintenanceSweeps({ pool, stage: 'pr-1', emit: () => undefined })).rejects.toThrow(
            'purge failed',
        );
        expect(steps).toContain('expire');
        expect(steps).toContain('gauge');
    });

    it('still purges when the stall gauge cannot read (the gauge is observation, not work)', async () => {
        const { steps, pool } = recordingPool(['gauge']);

        await runMaintenanceSweeps({ pool, stage: 'pr-1', emit: () => undefined });

        expect(steps).toContain('purge');
    });
});

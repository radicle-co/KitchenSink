/**
 * Unit tests for the drainer's concurrency sizing (`FOOD_WORKER_CONCURRENCY` /
 * `FOOD_WORKER_CONCURRENCY_PER_CPU`).
 *
 * This sizing had NO tests and two hand-rolled reads that swallowed a malformed value: `explicit` fell
 * through `Number.isInteger(NaN) === false` and `perCpu` through an `isFinite` ternary, so
 * `FOOD_WORKER_CONCURRENCY=eight` silently kept the computed width. That is not the `NaN`-deletes-a-guard
 * class — the fallback is a sane number — but it silently DISCARDS operator intent on the knob whose whole
 * reason for existing is incident response: each in-flight food is ~2 USDA requests, and a too-wide burst
 * from one Fargate IP is what drove USDA latency past the client timeout. An operator lowering it is
 * mitigating a live incident; ignoring the typo prolongs exactly the outage they are fixing, and the API
 * fronting the same variable REFUSES TO BOOT on it (`EnvironmentSchema`). One variable, one verdict: throw.
 *
 * The vCPU count is injected so the clamp is testable off-container.
 *
 * @implements FR-022
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { containerCpus, workerConcurrency } from '../concurrency.js';

describe('workerConcurrency — explicit operator override', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('uses FOOD_WORKER_CONCURRENCY verbatim, overriding the whole computation', () => {
        vi.stubEnv('FOOD_WORKER_CONCURRENCY', '5');

        // 32 vCPUs would otherwise compute (and clamp to) 8 — the explicit value wins, and is NOT clamped.
        expect(workerConcurrency(32)).toBe(5);
        expect(workerConcurrency(1)).toBe(5);
    });

    it('honours an explicit value ABOVE the computed clamp (the operator outranks the heuristic)', () => {
        vi.stubEnv('FOOD_WORKER_CONCURRENCY', '16');

        expect(workerConcurrency(2)).toBe(16);
    });

    it.each(['eight', '', '0', '-1', '2.5', 'NaN', 'Infinity'])(
        'throws on the malformed override %o instead of silently reverting to the computed width',
        (value) => {
            vi.stubEnv('FOOD_WORKER_CONCURRENCY', value);

            expect(() => workerConcurrency(4)).toThrow(/FOOD_WORKER_CONCURRENCY/);
        },
    );
});

describe('workerConcurrency — computed from the container CPU allowance', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('oversubscribes vCPUs by FOOD_WORKER_CONCURRENCY_PER_CPU when no explicit width is set', () => {
        vi.stubEnv('FOOD_WORKER_CONCURRENCY', undefined);
        vi.stubEnv('FOOD_WORKER_CONCURRENCY_PER_CPU', '2');

        expect(workerConcurrency(2)).toBe(4);
        expect(workerConcurrency(3)).toBe(6);
    });

    it('tracks a tuned FOOD_WORKER_CONCURRENCY_PER_CPU — the same vCPUs give a different width', () => {
        vi.stubEnv('FOOD_WORKER_CONCURRENCY', undefined);

        vi.stubEnv('FOOD_WORKER_CONCURRENCY_PER_CPU', '1');
        expect(workerConcurrency(4)).toBe(4);

        // Fractional per-CPU is legal (the schema allows any positive number) and must be honoured.
        vi.stubEnv('FOOD_WORKER_CONCURRENCY_PER_CPU', '1.5');
        expect(workerConcurrency(4)).toBe(6);
    });

    it('clamps to [2, 8]: a sub-1-vCPU task still drains 2, a 32-vCPU host is capped at 8', () => {
        vi.stubEnv('FOOD_WORKER_CONCURRENCY', undefined);
        vi.stubEnv('FOOD_WORKER_CONCURRENCY_PER_CPU', '2');

        expect(workerConcurrency(0.25)).toBe(2);
        expect(workerConcurrency(32)).toBe(8);
    });

    it.each(['double', '', '0', '-1', 'NaN', 'Infinity'])(
        'throws on the malformed per-CPU factor %o instead of silently substituting the default',
        (value) => {
            vi.stubEnv('FOOD_WORKER_CONCURRENCY', undefined);
            vi.stubEnv('FOOD_WORKER_CONCURRENCY_PER_CPU', value);

            expect(() => workerConcurrency(4)).toThrow(/FOOD_WORKER_CONCURRENCY_PER_CPU/);
        },
    );
});

describe('containerCpus', () => {
    it('reports a positive CPU allowance off-container (cgroup files absent → availableParallelism)', () => {
        const cpus = containerCpus();

        expect(cpus).toBeGreaterThan(0);
        expect(Number.isFinite(cpus)).toBe(true);
    });
});

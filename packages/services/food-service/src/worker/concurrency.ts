/**
 * Drainer concurrency sizing for the Fargate fan-out worker (MOD-004) — how many foods the drain loop
 * processes in flight, and how many vCPUs the container is actually allowed.
 *
 * Extracted from `worker/main.ts` so the policy is testable: that module runs `void bootstrap()` on import,
 * so nothing could exercise the sizing without starting a worker. Both settings resolve through the ONE
 * validated reader (`settingFromEnv`), so their defaults and rules live only in `config/env.schema.ts`.
 *
 * @implements FR-022
 */
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

import { settingFromEnv } from '../config/env.schema.js';

/** Narrowest useful drain width — a sub-1-vCPU task still overlaps two mostly-idle network waits. */
const MIN_CONCURRENCY = 2;

/**
 * Widest computed drain width. Deliberately conservative: each concurrent food issues ~2 USDA requests, so
 * N in flight is ~2N simultaneous requests from ONE Fargate IP, and a wider burst drove USDA's response
 * latency past the client timeout (self-inflicted timeouts → deferred foods). An explicit
 * `FOOD_WORKER_CONCURRENCY` is NOT clamped — an operator who names a width outranks this heuristic.
 */
const MAX_CONCURRENCY = 8;

/**
 * The container's actual CPU allowance (vCPUs). `availableParallelism()`/`os.cpus()` report the HOST's
 * cores, which on Fargate/K8s is NOT the task's CPU limit (a CFS quota) — a 0.25-vCPU task on an 8-core
 * host would read 8. So prefer the cgroup quota (cgroup v2 `cpu.max`, then v1 `cpu.cfs_quota_us`), and
 * fall back to `availableParallelism()` off-container (local dev / macOS, where the files are absent).
 *
 * @returns The CPU allowance in vCPUs (may be fractional, e.g. 0.25).
 * @sideEffect Reads cgroup files under /sys/fs/cgroup.
 */
export function containerCpus(): number {
    try {
        const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/); // cgroup v2

        if (quota !== 'max' && Number(quota) > 0 && Number(period) > 0) {
            return Number(quota) / Number(period);
        }
    } catch {
        /* not cgroup v2 */
    }

    try {
        const quota = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8').trim()); // cgroup v1
        const period = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8').trim());

        if (quota > 0 && period > 0) {
            return quota / period;
        }
    } catch {
        /* not cgroup v1 */
    }

    return availableParallelism();
}

/**
 * How many foods the drainer processes concurrently. The fan-out is ~80% USDA network I/O, so a single food
 * leaves the CPU mostly idle — oversubscribe the task's vCPUs by `FOOD_WORKER_CONCURRENCY_PER_CPU`
 * (default 2), rounding to whole slots and clamping to [{@link MIN_CONCURRENCY}, {@link MAX_CONCURRENCY}].
 * `FOOD_WORKER_CONCURRENCY` overrides the whole computation. The rolling-window limiter still caps the
 * actual USDA call rate, so this only sets the burst width.
 *
 * Both settings FAIL LOUD on a malformed value rather than reverting to the computed width or the default
 * factor. Reverting looks harmless — the fallback is a sane number — but it discards operator intent on the
 * one knob whose purpose is incident response (an over-wide burst is what times out against USDA), and the
 * API validates the SAME variable at boot, so a typo must not mean "the API refuses to start while the
 * worker quietly ignores you".
 *
 * @param cpus - The container's CPU allowance; defaults to {@link containerCpus}.
 * @returns The drain concurrency.
 * @throws {Error} when `FOOD_WORKER_CONCURRENCY` or `FOOD_WORKER_CONCURRENCY_PER_CPU` is malformed.
 * @sideEffect Reads `process.env` (and cgroup files when `cpus` is omitted).
 */
export function workerConcurrency(cpus: number = containerCpus()): number {
    const explicit = settingFromEnv('FOOD_WORKER_CONCURRENCY');

    if (explicit !== undefined) {
        return explicit;
    }

    const perCpu = settingFromEnv('FOOD_WORKER_CONCURRENCY_PER_CPU');
    const slots = Math.max(1, Math.round(cpus));

    return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, Math.round(slots * perCpu)));
}

/**
 * What one e2e lane costs its host, read from `laneCosts.json`: the ONE place these numbers live. The lane planners
 * (Android, iOS, web) and a user-level hook that decides whether a suite has room both read that file, so a new
 * measurement is one edit. JSON has no comments, so each figure's measurement is recorded here.
 *
 * - `android`: a lane's PEAK, as ADR-0088 §2 states: an x86_64 API 34 emulator under `swiftshader_indirect` plus its
 *   runner and Maestro JVMs. On 2026-11-07 four lanes averaged 2.7 CPUs each, yet load peaked at 58.5 on the 20-CPU host
 *   and 9 of 70 flows ran out of their scroll budgets. One lane alone held the host at load p95 4.9, max 5.7, so a lane
 *   costs 5.5 CPUs. At that cost the host planned 3 lanes, and 69 of 70 flows passed. Memory: 4.9-5.5 GiB peak per lane.
 * - `iphone`: measured with `maestro:macUsage` on a three-lane full run (2026-11-08, 49 minutes, one 14-cpu Mac): a
 *   lane's Simulator, XCTest driver and Maestro JVM used 0.5 to 0.6 cpus on average with a one-cpu burst, and peaked at
 *   1.74 to 2.05 GiB resident. The cpu figure is the burst rounded up; the memory is the largest peak rounded up to
 *   2.1 GiB. It counts only a lane's own processes, not the shared Simulator services, which is what the planner's
 *   safety margin on free memory is for.
 * - `ipad`: an iPad lane (the 820 pt iPad Air 11-inch, M3). Measured with `maestro:macUsage ipad` on 2026-11-15 on one
 *   14-cpu Mac, one-lane runs of 332 s and 380 s and a two-lane run of 508 to 603 s: a lane used 0.4 to 0.6 cpus on
 *   average and peaked at 1.87 to 2.10 GiB resident. The cpu figure is the iPhone's burst, rounded up the same way (the
 *   mean is below one); the memory is the largest peak rounded up to 2.2 GiB. The flows ran were written for iPhone and
 *   failed on the iPad, so the figure covers a lane doing real work for minutes, not a full suite. Like the iPhone's, it
 *   counts only a lane's own processes.
 * - `macAndroid`: what a Mac Android lane costs, measured with `maestro:macUsage android` on a two-lane full run
 *   (2026-11-08, 75 minutes, the 14-cpu Mac, host GPU): a lane's emulator and Maestro JVM used 0.65 to 0.68 cpus on
 *   average, p95 1.2, with bursts to 2.5 to 2.7, and peaked at 5.47 to 5.71 GiB resident. The cpu figure is the burst
 *   rounded up and the memory the largest peak rounded up. It counts only a lane's own processes (the GPU work runs in
 *   Metal), which is what the planner's margin on free memory is for.
 * - `web`: from the full-suite run of 2026-11-08 (8 lanes on one shared server, 20 CPUs, sampled every 2 s over each
 *   lane's process tree: Playwright and its browsers). A lane's CPU averaged 0.34 cores (p95 0.67, p99 0.87) and its
 *   resident memory 1.17 GiB (p95 1.30, peak 1.88; summed RSS counts shared pages twice). The figures are rounded up
 *   from the p95 so the planner does not oversubscribe. The earlier 1.5 CPUs and 2 GiB paid for a Next server per lane.
 * - `webServer`: what the one shared `next start` costs, whatever the lane count: CPU mean 0.54 (peak 0.90), memory
 *   mean 0.57 GiB (peak 0.62).
 *
 * Read outside the repo: `~/.claude/hooks/e2eLoadGuard.py` reads this file's repo path, its key set and the `gib` unit
 * through `git show origin/main:packages/tools/e2ePlan/src/laneCosts.json`. Moving or renaming any of them needs a
 * matching hook edit. The hook reads `origin/main` while the planners read the working tree, so a branch that changes a
 * cost disagrees with the hook until it merges.
 */
import { z } from 'zod';

import raw from './laneCosts.json' with { type: 'json' };
import type { LaneCost } from './lanePlan.js';

const GIB = 1024 ** 3;

const figure = z.strictObject({ cpus: z.number().positive(), gib: z.number().positive() });

const LaneCostsFileSchema = z.strictObject({
    android: figure,
    iphone: figure,
    ipad: figure,
    macAndroid: figure,
    web: figure,
    webServer: figure,
});

export type LaneCosts = Readonly<Record<keyof z.infer<typeof LaneCostsFileSchema>, LaneCost>>;

const toLaneCost = ({ cpus, gib }: z.infer<typeof figure>): LaneCost => ({ cpus, memBytes: Math.round(gib * GIB) });

/** Parse the file's content and convert each GiB figure to bytes. Throws on a missing, unknown or non-positive figure. */
export function parseLaneCosts(raw: unknown): LaneCosts {
    const file = LaneCostsFileSchema.parse(raw);

    return {
        android: toLaneCost(file.android),
        iphone: toLaneCost(file.iphone),
        ipad: toLaneCost(file.ipad),
        macAndroid: toLaneCost(file.macAndroid),
        web: toLaneCost(file.web),
        webServer: toLaneCost(file.webServer),
    };
}

export const laneCosts: LaneCosts = parseLaneCosts(raw);

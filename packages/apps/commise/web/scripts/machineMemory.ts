/**
 * Free memory for the lane planner.
 *
 * `os.freemem()` is right on Linux (libuv reads `MemAvailable`) and on Windows. On macOS it counts only never-used pages,
 * so a Mac that has been up a day reports a few hundred MB free with gigabytes reclaimable, and the planner would plan no
 * lanes. There the reclaimable pages come from `vm_stat`.
 */
import { execFileSync } from 'node:child_process';
import { freemem } from 'node:os';

/**
 * Free plus reclaimable memory out of `vm_stat` output: the free, inactive and speculative pages. Purgeable pages are
 * left out because they may already be counted inside inactive, and an overstated figure plans too many lanes.
 *
 * @param text - What `vm_stat` printed.
 * @returns Bytes.
 * @throws When the page size or a page count is missing.
 */
export function parseVmStat(text: string): number {
    const pageSize = /page size of (\d+) bytes/u.exec(text)?.[1];

    const pages = (label: string): number => {
        const count = new RegExp(`^Pages ${label}:\\s+(\\d+)\\.`, 'mu').exec(text)?.[1];

        if (count === undefined) {
            throw new Error(`error: vm_stat output has no "Pages ${label}" line`);
        }

        return Number(count);
    };

    if (pageSize === undefined) {
        throw new Error('error: vm_stat output has no page size');
    }

    return (pages('free') + pages('inactive') + pages('speculative')) * Number(pageSize);
}

export interface MemorySources {
    readonly platform: NodeJS.Platform;
    readonly freemem: () => number;
    readonly vmStat: () => string;
}

const realSources = (): MemorySources => ({
    platform: process.platform,
    freemem,
    vmStat: () => execFileSync('vm_stat', { encoding: 'utf8' }),
});

/**
 * Memory the machine could give the lanes now.
 *
 * @sideEffect Runs `vm_stat` on macOS.
 * @param sources - Injected for tests; the real ones by default.
 * @returns Bytes; `os.freemem()` where `vm_stat` is not the better source or cannot be read.
 */
export function availableMemoryBytes(sources: MemorySources = realSources()): number {
    if (sources.platform !== 'darwin') {
        return sources.freemem();
    }

    try {
        return parseVmStat(sources.vmStat());
    } catch {
        return sources.freemem();
    }
}

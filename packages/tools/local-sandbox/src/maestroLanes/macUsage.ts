/**
 * What one iOS lane costs the Mac, from `ps` samples taken over ssh. It reuses the shared accumulator in
 * `laneUsage.ts` (mean CPUs and peak resident memory); this module only reads the Mac's `ps` format and picks a lane's
 * processes out of it: its Simulator's, its XCTest driver and its Maestro JVM.
 *
 * Collect rows with `ps -axo pid=,pgid=,time=,rss=,args=`. macOS has no `times` column, so CPU is read from `time`.
 */
import type { PsRow } from './laneUsage.js';

/**
 * CPU seconds from a macOS `ps` time: `M:SS.cc` (minutes can pass 59), `H:MM:SS` or `D-HH:MM:SS`. NaN when unreadable.
 * Pure.
 */
export function parseMacCpuTime(text: string): number {
    const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/u.exec(text.trim());

    if (match === null) {
        return Number.NaN;
    }

    // `mid` present means H:MM:SS (mid = hours, first = minutes); absent means M:SS.cc.
    const [, days, mid, first, seconds] = match;
    const minutes = mid === undefined ? Number(first) : Number(mid) * 60 + Number(first);

    return Number(days ?? 0) * 86400 + minutes * 60 + Number(seconds);
}

/** Rows of `ps -axo pid=,pgid=,time=,rss=,args=` on macOS; a line it cannot read is skipped. Pure. */
export function parseMacPs(text: string): readonly PsRow[] {
    return text.split('\n').flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/u.exec(line);
        const cpuSeconds = match?.[3] === undefined ? Number.NaN : parseMacCpuTime(match[3]);

        return match === null || Number.isNaN(cpuSeconds)
            ? []
            : [
                  {
                      pid: Number(match[1]),
                      pgid: Number(match[2]),
                      cpuSeconds,
                      rssKb: Number(match[4]),
                      args: match[5] ?? '',
                  },
              ];
    });
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * One lane's processes on the Mac: anything running from its Simulator's data folder, its XCTest driver (named by
 * `id=<udid>`), and its Maestro JVM (whose `user.home` is the lane's own home folder). Whole path segments only, so
 * lane 1 never claims lane 10. Pure.
 */
export function iosLaneProcesses(
    rows: readonly PsRow[],
    lane: { readonly udid: string; readonly laneHome: string },
): readonly PsRow[] {
    const udid = escape(lane.udid);
    const home = escape(lane.laneHome);
    const mine = new RegExp(`CoreSimulator/Devices/${udid}/|id=${udid}(\\s|$)|(^|[\\s=])${home}(/|\\s|$)`, 'u');

    return rows.filter((row) => mine.test(row.args));
}

/**
 * One Android lane's processes on the Mac: the emulator (`qemu-system-aarch64` and its `emulator` launcher, both named by
 * `-port <console port>`) and the lane's Maestro JVM (its `user.home` is the lane's own home folder). Whole tokens only.
 * Pure.
 */
export function androidLaneProcesses(
    rows: readonly PsRow[],
    lane: { readonly consolePort: string; readonly laneHome: string },
): readonly PsRow[] {
    const port = escape(lane.consolePort);
    const home = escape(lane.laneHome);
    const mine = new RegExp(`(^|\\s)-port ${port}(\\s|$)|(^|[\\s=])${home}(/|\\s|$)`, 'u');

    return rows.filter((row) => mine.test(row.args));
}

/**
 * What one lane costs the host, measured from `ps` samples: its runner's process group (the runner and every Maestro
 * JVM it starts) and its emulator's process group (found by the lane's console port). The mean is CPU seconds used
 * while the lane was watched over the watched time, and memory is the peak resident total. This is the measurement
 * behind an adapter's `laneCost`.
 */
export interface PsRow {
    readonly pid: number;
    readonly pgid: number;
    /** Cumulative CPU seconds (`ps -o times`). */
    readonly cpuSeconds: number;
    readonly rssKb: number;
    readonly args: string;
}

/** Rows of `ps -eo pid=,pgid=,times=,rss=,args=`; a line it cannot read is skipped. Pure. */
export function parsePs(text: string): readonly PsRow[] {
    return text.split('\n').flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line);

        return match === null
            ? []
            : [
                  {
                      pid: Number(match[1]),
                      pgid: Number(match[2]),
                      cpuSeconds: Number(match[3]),
                      rssKb: Number(match[4]),
                      args: match[5] ?? '',
                  },
              ];
    });
}

/** The lane's processes: its runner group, and the group of the emulator listening on its console port. Pure. */
export function laneProcesses(
    rows: readonly PsRow[],
    lane: { readonly runnerPgid: number; readonly consolePort: string },
): readonly PsRow[] {
    const emulatorGroups = new Set(
        rows
            .filter((row) => new RegExp(`(^|\\s)-port ${lane.consolePort}(\\s|$)`, 'u').test(row.args))
            .map((row) => row.pgid),
    );

    return rows.filter((row) => row.pgid === lane.runnerPgid || emulatorGroups.has(row.pgid));
}

export interface Usage {
    readonly baseline: ReadonlyMap<number, number>;
    readonly cpuSeconds: number;
    readonly peakRssKb: number;
    readonly firstAt?: number;
    readonly lastAt?: number;
}

export const emptyUsage = (): Usage => ({ baseline: new Map(), cpuSeconds: 0, peakRssKb: 0 });

/**
 * Fold one sample in. A process seen in the FIRST sample counts from its CPU then (the emulator's boot is not the run);
 * one that appears later counts in full, since it started inside the watched time. Pure.
 */
export function recordSample(usage: Usage, rows: readonly PsRow[], at: number): Usage {
    const first = usage.firstAt === undefined;
    const baseline = new Map(usage.baseline);
    let cpuSeconds = usage.cpuSeconds;

    for (const row of rows) {
        const before = baseline.get(row.pid) ?? (first ? row.cpuSeconds : 0);
        cpuSeconds += Math.max(0, row.cpuSeconds - before);
        baseline.set(row.pid, row.cpuSeconds);
    }

    return {
        baseline,
        cpuSeconds,
        peakRssKb: Math.max(
            usage.peakRssKb,
            rows.reduce((sum, row) => sum + row.rssKb, 0),
        ),
        firstAt: usage.firstAt ?? at,
        lastAt: at,
    };
}

/** Mean CPUs (one decimal) and peak resident bytes over the watched time. Pure. */
export function summarizeUsage(usage: Usage): {
    readonly seconds: number;
    readonly meanCpus: number;
    readonly peakRssBytes: number;
} {
    const seconds = ((usage.lastAt ?? 0) - (usage.firstAt ?? 0)) / 1000;

    return {
        seconds,
        meanCpus: seconds > 0 ? Math.round((usage.cpuSeconds / seconds) * 10) / 10 : 0,
        peakRssBytes: usage.peakRssKb * 1024,
    };
}

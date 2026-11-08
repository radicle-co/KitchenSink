import { describe, expect, it } from 'vitest';

import { emptyUsage, laneProcesses, parsePs, recordSample, summarizeUsage } from '../laneUsage.js';

const PS = [
    '  100   100   10  2000 bash runMaestroFlows.sh',
    '  101   100   50 400000 java -jar maestro.jar test flow.yaml',
    '  200   200    5  1000 emulator -avd ci_pixel6 -port 5558 -read-only',
    '  201   200  300 3000000 qemu-system-x86_64 -avd ci_pixel6 -port 5558',
    '  300   300  900 3000000 qemu-system-x86_64 -avd ci_pixel6 -port 5560',
    '  bad line',
].join('\n');

describe('parsePs', () => {
    it('reads pid, group, CPU seconds, resident KiB and the command, and skips what it cannot read', () => {
        expect(parsePs(PS)).toHaveLength(5);
        expect(parsePs(PS)[1]).toEqual({
            pid: 101,
            pgid: 100,
            cpuSeconds: 50,
            rssKb: 400000,
            args: 'java -jar maestro.jar test flow.yaml',
        });
    });
});

describe('laneProcesses', () => {
    it('is the runner group plus the group of the emulator on the lane console port, and nothing else', () => {
        expect(laneProcesses(parsePs(PS), { runnerPgid: 100, consolePort: '5558' }).map((row) => row.pid)).toEqual([
            100, 101, 200, 201,
        ]);
    });
});

describe('recordSample and summarizeUsage', () => {
    it('counts only CPU used after a process is first seen, adds processes that appear later, and keeps the peak memory', () => {
        let usage = emptyUsage();
        usage = recordSample(usage, [{ pid: 1, pgid: 1, cpuSeconds: 100, rssKb: 1000, args: '' }], 0);
        usage = recordSample(
            usage,
            [
                { pid: 1, pgid: 1, cpuSeconds: 130, rssKb: 3000, args: '' },
                { pid: 2, pgid: 1, cpuSeconds: 4, rssKb: 500, args: '' },
            ],
            10_000,
        );
        usage = recordSample(usage, [{ pid: 1, pgid: 1, cpuSeconds: 150, rssKb: 2000, args: '' }], 20_000);

        // 30 + 20 seconds of pid 1 over 20 s, plus pid 2's 4 s it had when first seen mid-run.
        expect(summarizeUsage(usage)).toEqual({ seconds: 20, meanCpus: 2.7, peakRssBytes: 3500 * 1024 });
    });

    it('counts a first-sample process from its baseline, not its lifetime', () => {
        const usage = recordSample(emptyUsage(), [{ pid: 1, pgid: 1, cpuSeconds: 999, rssKb: 1, args: '' }], 0);

        expect(summarizeUsage(usage).meanCpus).toBe(0);
    });
});

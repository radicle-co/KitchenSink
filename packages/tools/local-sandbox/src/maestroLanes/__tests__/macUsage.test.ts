import { describe, expect, it } from 'vitest';

import { emptyUsage, recordSample, summarizeUsage } from '../laneUsage.js';
import { iosLaneProcesses, parseMacCpuTime, parseMacPs } from '../macUsage.js';

describe('parseMacCpuTime', () => {
    it('reads minutes and seconds with centiseconds', () => {
        expect(parseMacCpuTime('1203:50.69')).toBeCloseTo(1203 * 60 + 50.69);
    });

    it('reads hours, minutes and seconds', () => {
        expect(parseMacCpuTime('2:03:04')).toBe(2 * 3600 + 3 * 60 + 4);
    });

    it('reads days', () => {
        expect(parseMacCpuTime('1-00:00:10')).toBe(86400 + 10);
    });

    it('refuses what it cannot read', () => {
        expect(Number.isNaN(parseMacCpuTime('abc'))).toBe(true);
    });
});

const PS = `    1     1 261:21.02  24736 /sbin/launchd
 5001  5001   0:12.50  52000 /Users/b/Library/Developer/CoreSimulator/Devices/AAAA-1111/data/Containers/Bundle/Application/X/Commise.app/Commise
 5002  5002   2:00.00 900000 /Users/b/ksIos/jdk17/Contents/Home/bin/java -Duser.home=/Users/b/ksIos/lanes/lane1 -jar maestro
 5003  5003   1:00.00 200000 /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test-without-building -destination id=AAAA-1111 -xctestrun x
 6001  6001   0:30.00  50000 /Users/b/Library/Developer/CoreSimulator/Devices/BBBB-2222/data/foo
 6002  6002   3:00.00 800000 /Users/b/ksIos/jdk17/Contents/Home/bin/java -Duser.home=/Users/b/ksIos/lanes/lane2 -jar maestro
`;

describe('parseMacPs', () => {
    it('reads pid, group, cpu seconds, rss and the command', () => {
        const rows = parseMacPs(PS);
        expect(rows).toHaveLength(6);
        expect(rows[1]).toMatchObject({ pid: 5001, pgid: 5001, cpuSeconds: 12.5, rssKb: 52000 });
        expect(rows[1]?.args).toContain('CoreSimulator/Devices/AAAA-1111');
    });

    it('skips a line it cannot read', () => {
        expect(parseMacPs('garbage\n')).toEqual([]);
    });
});

describe('iosLaneProcesses', () => {
    const rows = parseMacPs(PS);

    it('picks a lane Simulator processes, its test driver and its Maestro JVM, and no other lane', () => {
        const mine = iosLaneProcesses(rows, { udid: 'AAAA-1111', laneHome: '/Users/b/ksIos/lanes/lane1' });
        expect(mine.map((row) => row.pid)).toEqual([5001, 5002, 5003]);
    });

    it('does not count a lane home that only shares a prefix', () => {
        const mine = iosLaneProcesses(rows, { udid: 'ZZZZ', laneHome: '/Users/b/ksIos/lanes/lane1' });
        expect(mine.map((row) => row.pid)).toEqual([5002]);
        expect(iosLaneProcesses(rows, { udid: 'ZZZZ', laneHome: '/Users/b/ksIos/lanes/lane' })).toEqual([]);
    });

    it('feeds the shared usage summary: mean CPUs and peak memory over the watched time', () => {
        const first = iosLaneProcesses(parseMacPs(PS), { udid: 'AAAA-1111', laneHome: '/Users/b/ksIos/lanes/lane1' });
        // 10 s later the same processes have each used 5 more CPU seconds
        const later = first.map((row) => ({ ...row, cpuSeconds: row.cpuSeconds + 5 }));
        const usage = recordSample(recordSample(emptyUsage(), first, 0), later, 10_000);
        const { meanCpus, peakRssBytes } = summarizeUsage(usage);
        expect(meanCpus).toBe(1.5);
        expect(peakRssBytes).toBe((52000 + 900000 + 200000) * 1024);
    });
});

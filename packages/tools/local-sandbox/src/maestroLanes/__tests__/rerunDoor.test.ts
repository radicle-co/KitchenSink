/**
 * The door half of the rerun limit: the keys it builds, the line it prints, and what it keeps
 * on disk across runs. Runs over a temp state folder and a stub for the git facts.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRerunDoor, type RerunDoorPorts } from '../rerunDoor.js';

const HEAD = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
let dir: string;
let file: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'rerunDoor-'));
    file = path.join(dir, 'localMaestro', 'rerunHistory.json');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

interface Door {
    readonly check: (flows: readonly string[], platform?: 'android' | 'ios') => readonly string[];
    readonly record: (flow: string, failed: boolean, platform?: 'android' | 'ios') => void;
    readonly reports: string[];
}

/** One door, as one run of `maestro:lanes` makes it. */
function door(overrides: Partial<RerunDoorPorts> = {}): Door {
    const reports: string[] = [];
    const ports: RerunDoorPorts = {
        historyFile: file,
        head: HEAD,
        digestOf: (flow) => `digest-of-${flow}`,
        iosDevice: 'iphone',
        now: () => '2026-11-27T10:00:00.000Z',
        report: (line) => reports.push(line),
        ...overrides,
    };
    const made = createRerunDoor(ports);

    return {
        reports,
        check: (flows, platform = 'ios') => made.checkRerun([{ platform, flows }]),
        record: (flow, failed, platform = 'ios') => {
            made.recordRerun([{ platform, flow, failed }]);
        },
    };
}

/** A run that checked, then failed `flow`, as the door sees one. */
const failedRun = (
    flow: string,
    overrides: Partial<RerunDoorPorts> = {},
    platform: 'android' | 'ios' = 'ios',
): void => {
    const run = door(overrides);

    expect(run.check([flow], platform)).toEqual([]);
    run.record(flow, true, platform);
};

describe('the rerun door', () => {
    it('allows the first run and the one rerun, then refuses the third (mutant: limit 1 or 3)', () => {
        failedRun('recipes/detailCooking');
        failedRun('recipes/detailCooking');

        expect(door().check(['recipes/detailCooking'])).toHaveLength(1);
    });

    it('says which flow, platform, device, head and count, and how to go on', () => {
        failedRun('recipes/detailCooking');
        failedRun('recipes/detailCooking');

        expect(door().check(['recipes/detailCooking'])).toEqual([
            'refused recipes/detailCooking (ios iphone) at 1a2b3c4: 2 failed runs; file a problem report, ' +
                "then rerun with MAESTRO_PROBLEM='<reference>'",
        ]);
    });

    it('names an Android flow without a device', () => {
        failedRun('recipes/home', {}, 'android');
        failedRun('recipes/home', {}, 'android');

        expect(door().check(['recipes/home'], 'android')[0]).toContain('(android)');
    });

    it('a refusal writes nothing (mutant: the refusal counts as a run)', () => {
        failedRun('recipes/detailCooking');
        failedRun('recipes/detailCooking');
        const before = readFileSync(file, 'utf8');

        door().check(['recipes/detailCooking']);

        expect(readFileSync(file, 'utf8')).toBe(before);
    });

    it('a reference releases the flow for one run, and the reference is stored with the key', () => {
        failedRun('recipes/detailCooking');
        failedRun('recipes/detailCooking');

        const released = door({ reference: 'REPORT-0042' });

        expect(released.check(['recipes/detailCooking'])).toEqual([]);
        released.record('recipes/detailCooking', true);

        expect(readFileSync(file, 'utf8')).toContain('REPORT-0042');
        expect(door({ reference: 'REPORT-0042' }).check(['recipes/detailCooking'])).toHaveLength(1);
        expect(door().check(['recipes/detailCooking'])).toHaveLength(1);
        expect(door({ reference: 'REPORT-0043' }).check(['recipes/detailCooking'])).toEqual([]);
    });

    it('a pass clears the count, so the next two failures start from nothing', () => {
        failedRun('recipes/detailCooking');
        const passing = door();
        passing.check(['recipes/detailCooking']);
        passing.record('recipes/detailCooking', false);
        failedRun('recipes/detailCooking');

        expect(door().check(['recipes/detailCooking'])).toEqual([]);
    });

    it('a new head, a fixed flow file and the other iOS device are new attempts (mutants: key part left out)', () => {
        failedRun('recipes/detailCooking');
        failedRun('recipes/detailCooking');

        expect(door({ head: '9999999999999999999999999999999999999999' }).check(['recipes/detailCooking'])).toEqual([]);
        expect(door({ digestOf: () => 'a-fixed-flow' }).check(['recipes/detailCooking'])).toEqual([]);
        expect(door({ iosDevice: 'ipad' }).check(['recipes/detailCooking'])).toEqual([]);
        expect(door().check(['recipes/detailCooking'], 'android')).toEqual([]);
    });

    it('does not let an iPad run on Android split the Android key (the device is iOS only)', () => {
        failedRun('recipes/home', { iosDevice: 'ipad' }, 'android');
        failedRun('recipes/home', { iosDevice: 'iphone' }, 'android');

        expect(door().check(['recipes/home'], 'android')).toHaveLength(1);
    });

    it('keys a one-off by its name, not its run folder, so a rerun of the same one-off counts', () => {
        // The digest is of the file's content, which is the same in every run's folder.
        const sameFile = { digestOf: () => 'the-one-off-file' };

        failedRun('oneOff/2026-11-27T10-00-00-000Z/shots', sameFile);
        failedRun('oneOff/2026-11-27T10-05-00-000Z/shots', sameFile);

        expect(door(sameFile).check(['oneOff/2026-11-27T10-09-00-000Z/shots'])).toHaveLength(1);
        expect(door(sameFile).check(['oneOff/2026-11-27T10-09-00-000Z/other'])).toEqual([]);
    });

    it('asks about every flow of every platform and names only the one at its limit, refusing the run', () => {
        failedRun('recipes/a', {}, 'android');
        failedRun('recipes/a', {}, 'android');
        const run = createRerunDoor({
            historyFile: file,
            head: HEAD,
            digestOf: (flow) => `digest-of-${flow}`,
            iosDevice: 'iphone',
            now: () => '2026-11-27T10:00:00.000Z',
            report: () => undefined,
        });

        const lines = run.checkRerun([
            { platform: 'android', flows: ['recipes/a', 'recipes/b'] },
            { platform: 'ios', flows: ['recipes/a'] },
        ]);

        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('recipes/a (android)');
    });

    it('records a failure with no earlier check, as a door that was lost before it began would', () => {
        const run = door();

        run.record('recipes/home', true);

        expect(readFileSync(file, 'utf8')).toContain('"failures": 1');
    });

    it('a history file that cannot be read is reported and read as empty, never a crash', () => {
        failedRun('recipes/home');
        writeFileSync(file, '{ torn');
        const run = door();

        expect(run.check(['recipes/home'])).toEqual([]);
        expect(run.reports).toHaveLength(1);
    });

    it('two doors one after the other keep both counts', () => {
        failedRun('recipes/home');
        failedRun('recipes/other');
        failedRun('recipes/home');

        expect(door().check(['recipes/home'])).toHaveLength(1);
        expect(door().check(['recipes/other'])).toEqual([]);
    });
});

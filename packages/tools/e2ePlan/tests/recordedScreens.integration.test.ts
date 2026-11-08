/**
 * The screen check over the REAL registry (`maestroFlowScreens.tsv`) and the real flows: a record that stays inside a
 * flow's combined row is clean, one that leaves it is reported, and a passed flow that recorded nothing is reported.
 * The flow ids are real; a rename fails loudly, which is the point.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { checkRecordedScreens } from '../src/recordedScreens.js';

const repo = resolve(import.meta.dirname, '../../../..');
const dir = mkdtempSync(join(tmpdir(), 'recordedScreens-'));

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

const check = (text: string) => {
    const file = join(dir, 'screenRecord.tsv');
    writeFileSync(file, text);

    return checkRecordedScreens(repo, [{ platform: 'android', file }]);
};

describe('checkRecordedScreens over the real tree', () => {
    it('passes a flow that stayed inside its row (every flow passes through Home)', () => {
        const report = check('screen\thome\tHomeScreen\nresult\thome\tpassed\n');

        expect(report.failed).toBe(false);
        expect(report.flows).toBe(1);
    });

    it("reports a screen the flow's row, its sub-flows' rows and Home do not name", () => {
        const report = check('screen\thome\tCollectionsScreen\nresult\thome\tpassed\n');

        expect(report.failed).toBe(true);
        expect(report.text).toContain('android home: add CollectionsScreen');
    });

    it('reports a passed flow that recorded nothing', () => {
        const report = check('result\thome\tpassed\n');

        expect(report.failed).toBe(true);
        expect(report.text).toContain('recorded no screen');
    });

    it("counts a screen of a sub-flow's row as the flow's own (the sign-in flows)", () => {
        const report = check('screen\thome\tlogin\nresult\thome\tpassed\n');

        expect(report.text).not.toContain('add login');
    });
});

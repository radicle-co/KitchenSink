import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkScreenFiles } from '../src/recordedScreens.js';

const coverage = new Map<string, ReadonlySet<string>>([['home', new Set(['HomeScreen', 'RecipeListScreen'])]]);
let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'screenFiles-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, text: string): string => {
    const file = join(dir, name);
    writeFileSync(file, text);

    return file;
};

describe('checkScreenFiles', () => {
    it('passes when every flow stayed inside its row', () => {
        const file = write('a.tsv', 'screen\thome\tHomeScreen\nresult\thome\tpassed\n');
        const out = checkScreenFiles([{ platform: 'android', file }], coverage, new Set());

        expect(out.failed).toBe(false);
        expect(out.flows).toBe(1);
    });

    it('fails on a missing screen and prints the row to grow', () => {
        const file = write('a.tsv', 'screen\thome\tProfileScreen\nresult\thome\tpassed\n');
        const out = checkScreenFiles([{ platform: 'ios', file }], coverage, new Set());

        expect(out.failed).toBe(true);
        expect(out.text).toContain('ios home: add ProfileScreen');
    });

    it('fails on a passed flow that recorded nothing', () => {
        const file = write('a.tsv', 'result\thome\tpassed\n');

        expect(checkScreenFiles([{ platform: 'android', file }], coverage, new Set()).failed).toBe(true);
    });

    it('does not fail on a wider row, it only prints it', () => {
        const file = write('a.tsv', 'screen\thome\tHomeScreen\nresult\thome\tpassed\n');
        const out = checkScreenFiles([{ platform: 'android', file }], coverage, new Set(['home']));

        expect(out.failed).toBe(false);
        expect(out.text).toContain('wider than observed by RecipeListScreen');
        expect(out.text).toContain('when:');
    });

    it('joins the files of several lanes of one platform, because lanes run different flows', () => {
        const one = write('1.tsv', 'screen\thome\tHomeScreen\nresult\thome\tpassed\n');
        const two = write('2.tsv', 'screen\tother\tHomeScreen\nresult\tother\tpassed\n');
        const out = checkScreenFiles(
            [
                { platform: 'android', file: one },
                { platform: 'android', file: two },
            ],
            coverage,
            new Set(),
        );

        expect(out.flows).toBe(2);
        expect(out.text).toContain('android other: add HomeScreen');
    });

    it("reports each flow's last result per platform", () => {
        const file = write('a.tsv', 'result\thome\tfailed\nscreen\thome\tHomeScreen\nresult\thome\tpassed\n');
        const out = checkScreenFiles([{ platform: 'android', file }], coverage, new Set());

        expect(out.results.get('android')?.get('home')).toBe('passed');
    });

    it('treats a lane that wrote no file as having run no flow', () => {
        const out = checkScreenFiles([{ platform: 'android', file: join(dir, 'none.tsv') }], coverage, new Set());

        expect(out).toMatchObject({ failed: false, flows: 0 });
    });

    it('throws on a damaged file instead of reading it as silence', () => {
        const file = write('a.tsv', 'garbage\n');

        expect(() => checkScreenFiles([{ platform: 'android', file }], coverage, new Set())).toThrow(/a\.tsv/u);
    });
});

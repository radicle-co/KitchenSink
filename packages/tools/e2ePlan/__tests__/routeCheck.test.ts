import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkRecordsInDir } from '../src/recordedRoutes.js';
import { missingRows, parseRecords, renderMissingRows } from '../src/routeCheck.js';

const SCREENS = ['/', '/recipes', '/recipes/[id]', '/recipes/new', '/collections'];
const table = new Map<string, ReadonlySet<string>>([
    ['a.spec.ts', new Set(['/', '/recipes'])],
    ['b.spec.ts', new Set(['*'])],
]);

describe('parseRecords', () => {
    it('reads one JSON record per line and skips blank lines', () => {
        expect(
            parseRecords('{"spec":"a.spec.ts","path":"/recipes"}\n\n{"spec":"b.spec.ts","path":"/"}\n', 'x'),
        ).toEqual([
            { spec: 'a.spec.ts', path: '/recipes' },
            { spec: 'b.spec.ts', path: '/' },
        ]);
    });

    it('reads a record with the source kind, and an old one without it', () => {
        expect(parseRecords('{"spec":"a","path":"/","via":"rsc"}\n{"spec":"a","path":"/x"}\n', 'x')).toEqual([
            { spec: 'a', path: '/', via: 'rsc' },
            { spec: 'a', path: '/x' },
        ]);
    });

    it('refuses a source kind that is not one of the three', () => {
        expect(() => parseRecords('{"spec":"a","path":"/","via":"x"}\n', 'l.jsonl')).toThrow(/l\.jsonl line 1/u);
    });

    it.each(['not json', '{"spec":"a"}', '{"spec":1,"path":"/"}', '[]'])(
        'refuses %s, so damage is never read as "no navigation"',
        (line) => {
            expect(() => parseRecords(`${line}\n`, 'lane-1.jsonl')).toThrow(/lane-1\.jsonl line 1/u);
        },
    );
});

describe('missingRows', () => {
    it('is empty when every screen a spec was seen on is in its row', () => {
        expect(missingRows([{ spec: 'a.spec.ts', path: '/recipes' }], table, SCREENS)).toEqual([]);
    });

    it('names the screens a spec reached that its row leaves out, each once, sorted', () => {
        const records = [
            { spec: 'a.spec.ts', path: '/recipes/abc' },
            { spec: 'a.spec.ts', path: '/recipes/def' },
            { spec: 'a.spec.ts', path: '/collections' },
            { spec: 'a.spec.ts', path: '/recipes' },
        ];

        expect(missingRows(records, table, SCREENS)).toEqual([
            { spec: 'a.spec.ts', screens: ['/collections', '/recipes/[id]'] },
        ]);
    });

    it('prefers the static screen over the dynamic one, as the app does', () => {
        expect(missingRows([{ spec: 'a.spec.ts', path: '/recipes/new' }], table, SCREENS)).toEqual([
            { spec: 'a.spec.ts', screens: ['/recipes/new'] },
        ]);
    });

    it('never asks for anything on a row of *', () => {
        expect(missingRows([{ spec: 'b.spec.ts', path: '/collections' }], table, SCREENS)).toEqual([]);
    });

    it('ignores a path no screen serves, which can only have reached the not-found page', () => {
        expect(missingRows([{ spec: 'a.spec.ts', path: '/nope' }], table, SCREENS)).toEqual([]);
    });

    it('asks for the whole row of a spec that has none', () => {
        expect(missingRows([{ spec: 'new.spec.ts', path: '/collections' }], table, SCREENS)).toEqual([
            { spec: 'new.spec.ts', screens: ['/collections'] },
        ]);
    });

    it('only ever asks to ADD: a row is never asked to shrink', () => {
        const rows = missingRows([{ spec: 'a.spec.ts', path: '/' }], table, SCREENS);

        expect(rows).toEqual([]);
    });

    it('ignores records of files that are not specs (the sign-in setup)', () => {
        expect(missingRows([{ spec: 'auth.setup.ts', path: '/sign-in' }], table, SCREENS)).toEqual([]);
    });
});

describe('renderMissingRows', () => {
    it('prints the exact addition to make, one spec per line', () => {
        expect(renderMissingRows([{ spec: 'a.spec.ts', screens: ['/collections', '/recipes/[id]'] }])).toBe(
            'a.spec.ts: add /collections, /recipes/[id] to its row in specScreens.tsv\n',
        );
    });

    it('is empty when nothing is missing', () => {
        expect(renderMissingRows([])).toBe('');
    });
});

describe('checkRecordsInDir', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'routes-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads every lane file and reports what is missing', () => {
        writeFileSync(join(dir, 'lane-1.jsonl'), '{"spec":"a.spec.ts","path":"/recipes"}\n');
        writeFileSync(join(dir, 'lane-2.jsonl'), '{"spec":"a.spec.ts","path":"/collections"}\n');

        const result = checkRecordsInDir(dir, { table, screens: SCREENS });

        expect(result.recorded).toBe(2);
        expect(result.kinds).toEqual({ document: 0, rsc: 0, framenavigated: 0, unknown: 2 });
        expect(result.missing).toEqual([{ spec: 'a.spec.ts', screens: ['/collections'] }]);
    });

    it('records nothing, and says so, when the folder does not exist (the recorder never ran)', () => {
        expect(checkRecordsInDir(join(dir, 'absent'), { table, screens: SCREENS })).toEqual({
            recorded: 0,
            missing: [],
            kinds: { document: 0, rsc: 0, framenavigated: 0, unknown: 0 },
        });
        mkdirSync(join(dir, 'empty'));
        expect(checkRecordsInDir(join(dir, 'empty'), { table, screens: SCREENS }).recorded).toBe(0);
    });
});

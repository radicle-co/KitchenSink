import { describe, expect, it } from 'vitest';

import { parseCoverage } from '../src/coverageTable.js';
import { changedRows } from '../src/changedRows.js';

const table = (text: string) => parseCoverage(text, 'x.tsv');

describe('changedRows', () => {
    const before = table('a\t/a\nb\t/b\n');

    it('names a row that was added', () => {
        expect(changedRows(before, table('a\t/a\nb\t/b\nc\t/c\n'))).toEqual(['c']);
    });

    it('names a row whose screens changed, in either direction', () => {
        expect(changedRows(before, table('a\t/a, /x\nb\t/b\n'))).toEqual(['a']);
        expect(changedRows(table('a\t/a, /x\n'), table('a\t/a\n'))).toEqual(['a']);
    });

    it('ignores the order of the screens and a row that did not change', () => {
        expect(changedRows(table('a\t/a, /b\n'), table('a\t/b, /a\n'))).toEqual([]);
    });

    it('names nothing for a row that was removed, since there is no such test left to run', () => {
        expect(changedRows(before, table('a\t/a\n'))).toEqual([]);
    });

    it('names every row when there was no table before', () => {
        expect(changedRows(undefined, table('b\t/b\na\t/a\n'))).toEqual(['a', 'b']);
    });
});

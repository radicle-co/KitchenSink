/**
 * Unit tests for the import summary's copy (`summaryCopy.ts`): every count in its words, and every row whose count is
 * zero left out rather than drawn as "0 could not be read".
 *
 * Extended for review finding M2 (import): the coverage stat is a plural that stands on its own ("1 of 1 recipe"), and
 * every count-bearing template has its count-1 case.
 */
import { describe, expect, it } from 'vitest';

import { importMessages } from '../messages.js';
import { summaryCopyOf, type SummaryCounts } from '../summaryCopy.js';

const s = importMessages.en.summary;

const COUNTS: SummaryCounts = {
    sourceName: 'Paprika',
    finishedWhen: 'today at 11:20',
    added: 855,
    neededNothing: 546,
    reviewed: 300,
    skipped: 9,
    alreadyHere: 6,
    unreadable: ['Grandma’s apple cake', 'Thai green curry paste', 'Untitled 3'],
    asWrittenLines: 41,
    asWrittenRecipes: 27,
    countedRecipes: 828,
};

describe('summaryCopyOf', () => {
    it('says every count in the board’s words', () => {
        expect(summaryCopyOf(COUNTS, s, 'en')).toEqual({
            from: 'From Paprika, today at 11:20.',
            added: '855 added',
            breakdown: '546 needed nothing\u00A0· 300 you reviewed\u00A0· 9 you skipped',
            alreadyHere: '6 already here',
            unreadable: {
                title: '3 could not be read',
                titles: 'Grandma’s apple cake, Thai green curry paste, Untitled 3',
            },
            asWritten: '41 lines in 27 recipes are kept as written, so they don’t count toward nutrition yet.',
            coverage: '828 of 855 recipes',
        });
    });

    it('uses the singular where a count is one', () => {
        const copy = summaryCopyOf({ ...COUNTS, asWrittenLines: 1, asWrittenRecipes: 1 }, s, 'en');

        expect(copy.asWritten).toBe('1 line in 1 recipe is kept as written, so it doesn’t count toward nutrition yet.');
    });

    it('leaves out every row whose count is zero', () => {
        const copy = summaryCopyOf({ ...COUNTS, alreadyHere: 0, unreadable: [], asWrittenLines: 0 }, s, 'en');

        expect(copy.alreadyHere).toBeUndefined();
        expect(copy.unreadable).toBeUndefined();
        expect(copy.asWritten).toBeUndefined();
    });

    it('the coverage stat is a plural on the recipes added, so one recipe reads "1 recipe"', () => {
        expect(summaryCopyOf({ ...COUNTS, added: 1, countedRecipes: 1 }, s, 'en').coverage).toBe('1 of 1 recipe');
        expect(summaryCopyOf({ ...COUNTS, added: 1, countedRecipes: 0 }, s, 'en').coverage).toBe('0 of 1 recipe');
    });

    it('every other count reads in the singular at one', () => {
        const copy = summaryCopyOf(
            { ...COUNTS, added: 1, alreadyHere: 1, unreadable: ['Untitled 3'], asWrittenLines: 1, asWrittenRecipes: 1 },
            s,
            'en',
        );

        expect(copy.added).toBe('1 added');
        expect(copy.alreadyHere).toBe('1 already here');
        expect(copy.unreadable).toEqual({ title: '1 could not be read', titles: 'Untitled 3' });
    });
});

/**
 * Unit tests for the import summary's copy (`summaryCopy.ts`): every count in its words, and every row whose count is
 * zero left out rather than drawn as "0 could not be read".
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
            breakdown: '546 needed nothing · 300 you reviewed · 9 you skipped',
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
});

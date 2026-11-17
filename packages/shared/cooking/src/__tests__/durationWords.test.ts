/**
 * Times written in words. Every row is a line a cook could really read, with the exact reading it must
 * give. The word grammar is a second layer under `readDuration`: it runs only when the digit layer found no span.
 */
import { describe, expect, it } from 'vitest';

import { readDuration } from '../duration.js';
import { readWordDuration } from '../durationWords.js';

describe('readWordDuration', () => {
    it.each([
        ['Bake twenty minutes', 1_200],
        ['An hour and a half', 5_400],
        ['Bake for an hour and a half.', 5_400],
        ['Half an hour or until set', 1_800],
        ['Chill a quarter of an hour', 900],
        ['Chill three quarters of an hour', 2_700],
        ['Twenty-five minutes', 1_500],
        ['Cook forty five minutes', 2_700],
        ['An hour and twenty minutes', 4_800],
        ['Bake one hour, thirty minutes', 5_400],
        ['Bake one hour thirty minutes', 5_400],
        ['Stir for thirty seconds', 30],
        ['Stir for one second', 1],
        ['Boil a minute then add the sugar', 60],
        ['Boil for a minute.', 60],
        ['Rest an hour, then slice', 3_600],
        ['An hour or until tender', 3_600],
        ['Ten minutes or until golden', 600],
        ['Set it on to boil for about ten minutes--but stir', 600],
        ['A ten minute rest', 600],
        ['TEN MINUTES', 600],
    ])('%s gives one duration of %i s', (line, seconds) => {
        expect(readWordDuration(line)).toEqual({ kind: 'one', seconds });
    });

    it.each([
        ['Ten to fifteen minutes', 600, 900],
        ['Five or six minutes', 300, 360],
        ['Simmer for twenty to twenty-five minutes.', 1_200, 1_500],
        ['One or two hours', 3_600, 7_200],
    ])('%s gives the low end %i s and the high end %i s', (line, seconds, highSeconds) => {
        expect(readWordDuration(line)).toEqual({ kind: 'one', seconds, highSeconds });
    });

    it.each([
        ['Rest an hour', 3_600],
        ['Chill for a minute', 60],
        ['Rest a minute more', 60],
        ['Rest an hour longer', 3_600],
        ['Cook a minute until golden', 60],
        ['Rest an hour to cool', 3_600],
        ['Rest a minute and stir', 60],
    ])('reads an article amount that ends the line or is followed by an allowed word: %s', (line, seconds) => {
        expect(readWordDuration(line)).toStrictEqual({ kind: 'one', seconds });
    });

    it.each(['fifteen to ten minutes', 'ten to ten minutes'])(
        'drops the high end of a reversed or equal range, and never swaps it: %s',
        (line) => {
            expect(readWordDuration(line)).not.toHaveProperty('highSeconds');
        },
    );

    it('reads the low end of a reversed range as written', () => {
        expect(readWordDuration('fifteen to ten minutes')).toStrictEqual({ kind: 'one', seconds: 900 });
    });

    it.each(['ten to fifteen eggs', 'ten to fifteen drops'])('reads no time from a range with no unit: %s', (line) => {
        expect(readWordDuration(line)).toEqual({ kind: 'none' });
    });

    it.each(['Bake twenty minutes', 'Bake an hour and twenty minutes'])('%s carries no high end key at all', (line) => {
        expect(readWordDuration(line)).not.toHaveProperty('highSeconds');
    });

    it('carries no high end on a range joined to another amount', () => {
        expect(readWordDuration('ten to fifteen minutes and thirty seconds')).toStrictEqual({
            kind: 'one',
            seconds: 630,
        });
    });

    it.each([
        ['Simmer ten minutes, or until thick.', 600],
        ['Simmer ten minutes (or until thick).', 600],
        ['Rest ten minutes, then slice', 600],
        ['Rest an hour to cool', 3_600],
        ['Simmer ten minutes, a half cup of stock added', 600],
    ])('%s keeps its time: a bracket, a comma or "to" is not a hedge or a rate', (line, seconds) => {
        expect(readWordDuration(line)).toStrictEqual({ kind: 'one', seconds });
    });

    it('carries no high end on a span of two amounts', () => {
        expect(readWordDuration('An hour and twenty minutes')).toEqual({ kind: 'one', seconds: 4_800 });
    });

    it.each([
        'Bake ten minutes, then rest five minutes.',
        'Boil ten minutes and five minutes',
        'Rest ten minutes five minutes',
    ])('%s gives many, so no offer is made', (line) => {
        expect(readWordDuration(line)).toEqual({ kind: 'many' });
    });

    it.each([
        'two eggs',
        'a second',
        'a second time',
        'a second egg',
        'a minute quantity',
        'an hour glass',
        'an hour before serving',
        'a couple of minutes',
        'a few minutes',
        'a little while',
        'stir for a moment',
        'ten minutes each side',
        'two minutes before the end',
        'every five minutes',
        'once an hour',
        'twice an hour',
        'a minute or two',
        'an hour or two',
        'an hour or overnight',
        'an hour or longer',
        'an hour or so',
        'a minute or less',
        'eight to ten minutes or according to the fruit',
        'Bake ten minutes each side, then five minutes more',
        'one-half hour longer',
        'Boil one hour and a half.',
        'Boil two hours and a half',
        'Cook one hour and one-half.',
        'Bake an hour and a quarter.',
        'Cook a minute and a half.',
        'Leave an hour (or overnight).',
        'Bake an hour, or overnight.',
        'Rest ten minutes per pound.',
        'Roast twenty minutes to the pound',
        'Season to taste',
        '',
    ])('%j gives none: a wrong timer is worse than no timer', (line) => {
        expect(readWordDuration(line)).toEqual({ kind: 'none' });
    });

    it.each([
        ['two minutes', 120],
        ['two hours', 7_200],
        ['five mins', 300],
        ['three secs', 3],
        ['two hrs', 7_200],
        ['two hr', 7_200],
        ['five min', 300],
        ['three sec', 3],
    ])('reads the unit spelling in %s', (line, seconds) => {
        expect(readWordDuration(line)).toEqual({ kind: 'one', seconds });
    });

    it('counts a number word next to a word that is not a unit as no time', () => {
        expect(readWordDuration('add ten drops and five sprigs')).toEqual({ kind: 'none' });
        expect(readWordDuration('add ten minced onions')).toEqual({ kind: 'none' });
    });

    it('does not let "a" count as a number in a range', () => {
        expect(readWordDuration('a to ten minutes')).toEqual({ kind: 'one', seconds: 600 });
        expect(readWordDuration('ten to a minutes')).toEqual({ kind: 'none' });
    });
});

describe('readDuration layers the word grammar under the digit grammar', () => {
    it('reads a word time when the digit layer found no span', () => {
        expect(readDuration('An hour and a half')).toEqual({ kind: 'one', seconds: 5_400 });
    });

    it('gives the digit reading when a line has both: the word reader does not run on every line', () => {
        expect(readDuration('Bake 20 minutes, then ten minutes more.')).toEqual({ kind: 'one', seconds: 1_200 });
    });

    it.each([
        'Bake 1 h 15 m, then rest ten minutes',
        'Bake 1h 15m or ten minutes more',
        'Bake 0 minutes, then rest ten minutes',
        'Bake 1/0 hours, then rest ten minutes',
        'Microwave 2 m 30 seconds, then wait ten minutes',
    ])('%s stays none: an unread digit span is not a licence for the word reader', (line) => {
        expect(readDuration(line)).toEqual({ kind: 'none' });
    });

    it('still offers a digit time after "every"', () => {
        expect(readDuration('Stir every 5 minutes')).toEqual({ kind: 'one', seconds: 300 });
        expect(readDuration('Stir every five minutes')).toEqual({ kind: 'none' });
    });

    it('reads a line over the length cap as none even with a word time', () => {
        expect(readDuration(`${'x '.repeat(1_100)}ten minutes`)).toEqual({ kind: 'none' });
    });

    it('reads many for two word times', () => {
        expect(readDuration('Bake ten minutes, then rest five minutes.')).toEqual({ kind: 'many' });
    });
});

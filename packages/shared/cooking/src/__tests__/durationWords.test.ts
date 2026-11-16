/**
 * Times written in words (S8.U1, R10). Every row is a line a cook could really read, with the exact reading it must
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

describe('readDuration gives the high end of a digit range', () => {
    it.each([
        ['Simmer 20 to 25 minutes', 1_200, 1_500],
        ['Simmer 20-25 min', 1_200, 1_500],
        ['Simmer 20–25 minutes', 1_200, 1_500],
        ['Simmer for 20 or 25 minutes', 1_200, 1_500],
        ['Bake between 20 and 25 minutes', 1_200, 1_500],
        ['Bake 20‐25 minutes', 1_200, 1_500],
        ['Bake 20‑25 minutes', 1_200, 1_500],
        ['Bake 20‒25 minutes', 1_200, 1_500],
        ['Bake 20―25 minutes', 1_200, 1_500],
        ['Bake 20—25 minutes', 1_200, 1_500],
        ['Bake 1-2 hours', 3_600, 7_200],
        ['Bake 1 to 1½ hours', 3_600, 5_400],
    ])('%s gives %i s up to %i s', (line, seconds, highSeconds) => {
        expect(readDuration(line)).toEqual({ kind: 'one', seconds, highSeconds });
    });

    it.each(['Rest for 1 hour 5 minutes', 'Roast for 1 h 30', 'Bake 1½ hours', 'Stir for 30 sec'])(
        '%s carries no high end',
        (line) => {
            expect(readDuration(line)).not.toHaveProperty('highSeconds');
        },
    );

    it('carries no high end on a range joined to another amount', () => {
        expect(readDuration('Rest 1 to 2 hours 5 minutes')).not.toHaveProperty('highSeconds');
    });
});

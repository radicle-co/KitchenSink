/**
 * Times written in words. Every row is a line a cook could really read, with the exact reading it must
 * give. The word grammar is a second layer under `readDuration`: it runs only when the digit layer found no span.
 */
import { describe, expect, it } from 'vitest';

import { oneIn } from '../__fixtures__/oneIn.js';
import { readDuration } from '../duration.js';
import { readWordDuration } from '../durationWords.js';

describe('readWordDuration', () => {
    it.each([
        ['Bake twenty minutes', 'twenty minutes', 1_200],
        ['An hour and a half', 'An hour and a half', 5_400],
        ['Bake for an hour and a half.', 'an hour and a half', 5_400],
        ['Half an hour or until set', 'Half an hour', 1_800],
        ['Chill a quarter of an hour', 'a quarter of an hour', 900],
        ['Chill three quarters of an hour', 'three quarters of an hour', 2_700],
        ['Twenty-five minutes', 'Twenty-five minutes', 1_500],
        ['Cook forty five minutes', 'forty five minutes', 2_700],
        ['An hour and twenty minutes', 'An hour and twenty minutes', 4_800],
        ['Bake one hour, thirty minutes', 'one hour, thirty minutes', 5_400],
        ['Bake one hour thirty minutes', 'one hour thirty minutes', 5_400],
        ['Stir for thirty seconds', 'thirty seconds', 30],
        ['Stir for one second', 'one second', 1],
        ['Boil a minute then add the sugar', 'a minute', 60],
        ['Boil for a minute.', 'a minute', 60],
        ['Rest an hour, then slice', 'an hour', 3_600],
        ['An hour or until tender', 'An hour', 3_600],
        ['Ten minutes or until golden', 'Ten minutes', 600],
        ['Set it on to boil for about ten minutes--but stir', 'ten minutes', 600],
        ['A ten minute rest', 'ten minute', 600],
        ['TEN MINUTES', 'TEN MINUTES', 600],
    ])('%s gives one duration of %i s', (line, text, seconds) => {
        expect(readWordDuration(line)).toEqual(oneIn(line, text, seconds));
    });

    it.each([
        ['Ten to fifteen minutes', 'Ten to fifteen minutes', 600, 900],
        ['Five or six minutes', 'Five or six minutes', 300, 360],
        ['Simmer for twenty to twenty-five minutes.', 'twenty to twenty-five minutes', 1_200, 1_500],
        ['One or two hours', 'One or two hours', 3_600, 7_200],
    ])('%s gives the low end %i s and the high end %i s', (line, text, seconds, highSeconds) => {
        expect(readWordDuration(line)).toEqual(oneIn(line, text, seconds, highSeconds));
    });

    it.each([
        ['Rest an hour', 'an hour', 3_600],
        ['Chill for a minute', 'a minute', 60],
        ['Rest a minute more', 'a minute', 60],
        ['Rest an hour longer', 'an hour', 3_600],
        ['Cook a minute until golden', 'a minute', 60],
        ['Rest an hour to cool', 'an hour', 3_600],
        ['Rest a minute and stir', 'a minute', 60],
    ])('reads an article amount that ends the line or is followed by an allowed word: %s', (line, text, seconds) => {
        expect(readWordDuration(line)).toStrictEqual(oneIn(line, text, seconds));
    });

    it.each(['fifteen to ten minutes', 'ten to ten minutes'])(
        'drops the high end of a reversed or equal range, and never swaps it: %s',
        (line) => {
            expect(readWordDuration(line)).not.toHaveProperty('highSeconds');
        },
    );

    it('reads the low end of a reversed range as written', () => {
        expect(readWordDuration('fifteen to ten minutes')).toStrictEqual(
            oneIn('fifteen to ten minutes', 'fifteen to ten minutes', 900),
        );
    });

    it.each(['ten to fifteen eggs', 'ten to fifteen drops'])('reads no time from a range with no unit: %s', (line) => {
        expect(readWordDuration(line)).toEqual({ kind: 'none' });
    });

    it.each(['Bake twenty minutes', 'Bake an hour and twenty minutes'])('%s carries no high end key at all', (line) => {
        expect(readWordDuration(line)).not.toHaveProperty('highSeconds');
    });

    it('carries no high end on a range joined to another amount', () => {
        expect(readWordDuration('ten to fifteen minutes and thirty seconds')).toStrictEqual(
            oneIn('ten to fifteen minutes and thirty seconds', 'ten to fifteen minutes and thirty seconds', 630),
        );
    });

    it.each([
        ['Simmer ten minutes, or until thick.', 'ten minutes', 600],
        ['Simmer ten minutes (or until thick).', 'ten minutes', 600],
        ['Rest ten minutes, then slice', 'ten minutes', 600],
        ['Rest an hour to cool', 'an hour', 3_600],
        ['Simmer ten minutes, a half cup of stock added', 'ten minutes', 600],
    ])('%s keeps its time: a bracket, a comma or "to" is not a hedge or a rate', (line, text, seconds) => {
        expect(readWordDuration(line)).toStrictEqual(oneIn(line, text, seconds));
    });

    it('carries no high end on a span of two amounts', () => {
        expect(readWordDuration('An hour and twenty minutes')).toEqual(
            oneIn('An hour and twenty minutes', 'An hour and twenty minutes', 4_800),
        );
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
        ['two minutes', 'two minutes', 120],
        ['two hours', 'two hours', 7_200],
        ['five mins', 'five mins', 300],
        ['three secs', 'three secs', 3],
        ['two hrs', 'two hrs', 7_200],
        ['two hr', 'two hr', 7_200],
        ['five min', 'five min', 300],
        ['three sec', 'three sec', 3],
    ])('reads the unit spelling in %s', (line, text, seconds) => {
        expect(readWordDuration(line)).toEqual(oneIn(line, text, seconds));
    });

    it('counts a number word next to a word that is not a unit as no time', () => {
        expect(readWordDuration('add ten drops and five sprigs')).toEqual({ kind: 'none' });
        expect(readWordDuration('add ten minced onions')).toEqual({ kind: 'none' });
    });

    it('does not let "a" count as a number in a range', () => {
        expect(readWordDuration('a to ten minutes')).toEqual(oneIn('a to ten minutes', 'ten minutes', 600));
        expect(readWordDuration('ten to a minutes')).toEqual({ kind: 'none' });
    });
});

describe('readWordDuration: a repeat rate offers the time (P56)', () => {
    it.each([
        ['Fry three minutes per side', 'three minutes', 180],
        ['Fry three minutes per side.', 'three minutes', 180],
        ['Fry three minutes each side', 'three minutes', 180],
        ['Bake twelve minutes per batch', 'twelve minutes', 720],
        ['Bake twelve minutes each batch.', 'twelve minutes', 720],
        ['Fry THREE MINUTES PER SIDE', 'THREE MINUTES', 180],
        ['Fry a minute each side', 'a minute', 60],
        ['Fry an hour per batch', 'an hour', 3_600],
        ['Fry a minute per side', 'a minute', 60],
        ['Fry three minutes per-side', 'three minutes', 180],
        ['Fry three minutes each-side.', 'three minutes', 180],
        ['Bake twelve minutes per-batch', 'twelve minutes', 720],
        ['Bake twelve minutes each-batch', 'twelve minutes', 720],
        ['Fry a minute per-side', 'a minute', 60],
    ])('%s gives %i s, marked as a time that repeats', (line, text, seconds) => {
        expect(readWordDuration(line)).toStrictEqual({ ...oneIn(line, text, seconds), perRepeat: true });
    });

    it('keeps the high end of a range and marks it too', () => {
        expect(readWordDuration('Fry three to four minutes per side')).toStrictEqual({
            ...oneIn('Fry three to four minutes per side', 'three to four minutes', 180, 240),
            perRepeat: true,
        });
    });

    it('marks no other reading: a plain time and a time before the repeat words carry no mark', () => {
        expect(readWordDuration('Bake twenty minutes, then fry per side')).toStrictEqual(
            oneIn('Bake twenty minutes, then fry per side', 'twenty minutes', 1_200),
        );
        expect(readWordDuration('Fry per side three minutes')).toStrictEqual(
            oneIn('Fry per side three minutes', 'three minutes', 180),
        );
    });

    it.each([
        'Microwave one minute per potato',
        'Rest ten minutes per pound',
        'Roast twenty minutes to the pound',
        'Bake twenty minutes to the boil',
        'Fry three minutes per sidecar',
        'Bake twelve minutes per batches',
        'Fry a minute per potato',
        'Fry a minute each sides',
        'Fry three minutes per other side',
        'Rest the steak ten minutes to the side',
        'Fry three minutes per-sidecar',
        'Microwave one minute per-potato',
        'Roast twenty minutes to-the-pound',
        'Roast twenty minutes per pound per side',
        'Fry three minutes per',
    ])('%s gives none: only the listed repeat words offer the time', (line) => {
        expect(readWordDuration(line)).toEqual({ kind: 'none' });
    });

    it('reads many when a repeat rate sits beside another time', () => {
        expect(readWordDuration('Bake ten minutes each side, then five minutes more')).toEqual({ kind: 'many' });
    });
});

describe('readDuration layers the word grammar under the digit grammar', () => {
    it('reads a word time when the digit layer found no span', () => {
        expect(readDuration('An hour and a half')).toEqual(oneIn('An hour and a half', 'An hour and a half', 5_400));
    });

    it('gives the digit reading when a line has both: the word reader does not run on every line', () => {
        const line = 'Bake 20 minutes, then ten minutes more.';

        expect(readDuration(line)).toEqual(oneIn(line, '20 minutes', 1_200));
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
        expect(readDuration('Stir every 5 minutes')).toEqual(oneIn('Stir every 5 minutes', '5 minutes', 300));
        expect(readDuration('Stir every five minutes')).toEqual({ kind: 'none' });
    });

    it('reads a line over the length cap as none even with a word time', () => {
        expect(readDuration(`${'x '.repeat(1_100)}ten minutes`)).toEqual({ kind: 'none' });
    });

    it('reads many for two word times', () => {
        expect(readDuration('Bake ten minutes, then rest five minutes.')).toEqual({ kind: 'many' });
    });
});

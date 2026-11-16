import { describe, expect, it } from 'vitest';

import { collapseBracketGroups } from '../collapseBracketGroups.js';

describe('collapseBracketGroups', () => {
    it.each([
        ['1 cup butter ((softened))', '1 cup butter (softened)'],
        ['1 cup butter (((softened)))', '1 cup butter (softened)'],
        ['a [[b]] c', 'a [b] c'],
        ['a ((b) (c)) d ((e))', 'a ((b) (c)) d (e)'],
        ['x ((a (b)))', 'x (a (b))'],
    ])('%s', (input, expected) => {
        expect(collapseBracketGroups(input)).toBe(expected);
    });

    it.each(['1 cup (x)', 'a (b) (c)', '(a)(b)', 'no brackets', '', '((a)(b))', '(unclosed', 'closed)', '((a)'])(
        'leaves %j unchanged',
        (input) => {
            expect(collapseBracketGroups(input)).toBe(input);
        },
    );

    it.each([
        ['butter (, softened (or salted butter))', 'butter, softened (or salted butter)'],
        ['1 cup cream (, full fat)', '1 cup cream, full fat'],
        ['2 tbsp butter ((, softened))', '2 tbsp butter, softened'],
        ['thyme ((or a combination), plus a few sprigs)', 'thyme (or a combination), plus a few sprigs'],
        ['x (((a), b))', 'x (a), b'],
        ['x (((a), b), c)', 'x (a), b, c'],
    ])('cleans a comma opening a group, and a group opened by a group and a comma: %s', (input, expected) => {
        expect(collapseBracketGroups(input)).toBe(expected);
    });

    it.each(['1 cup (, x', 'a (,b)', 'a ((b)c)', 'a [, b]', 'a ([x], y)'])('leaves %j unchanged', (input) => {
        expect(collapseBracketGroups(input)).toBe(input);
    });

    it('is idempotent, over every string of up to 6 characters from ( ) [ ] a , and a space', () => {
        const alphabet = ['(', ')', '[', ']', 'a', ',', ' '];
        let strings = [''];
        const notIdempotent: string[] = [];

        // One assertion over the whole space, not one per string: about 137,000 `expect` calls took over 5 s on a busy CI
        // runner, and the list of every failing string is the more useful failure.
        for (let length = 0; length < 6; length += 1) {
            strings = strings.flatMap((text) => alphabet.map((char) => text + char));

            for (const text of strings) {
                const once = collapseBracketGroups(text);

                if (collapseBracketGroups(once) !== once) {
                    notIdempotent.push(text);
                }
            }
        }

        expect(notIdempotent).toEqual([]);
    });
});

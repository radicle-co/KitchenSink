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

    it('is idempotent, over every string of up to 8 characters from ( ) [ ] a', () => {
        const alphabet = ['(', ')', '[', ']', 'a'];
        let strings = [''];

        for (let length = 0; length < 8; length += 1) {
            strings = strings.flatMap((text) => alphabet.map((char) => text + char));
            strings.forEach((text) => {
                const once = collapseBracketGroups(text);

                expect(collapseBracketGroups(once)).toBe(once);
            });
        }
    });
});

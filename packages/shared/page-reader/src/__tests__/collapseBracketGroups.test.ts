import { describe, expect, it } from 'vitest';

import { collapseBracketGroups, collapseBracketGroupsCounted } from '../collapseBracketGroups.js';

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

    describe('hostile input: linear work and no recursion, whatever the nesting', () => {
        /** The longest line the reader hands it, and far past it: the function must be safe on its own. */
        const DEPTH = 100_000;
        /**
         * The steps per character a linear pass may take: each bracket pass reads every character once to pair the
         * brackets and once to walk the groups, and peels each doubled bracket once. A quadratic walk takes thousands.
         */
        const STEPS_PER_CHAR = 6;
        // ⛔ Work is COUNTED, never timed: a time budget fails on a busy CI runner and passes a quadratic walk on a fast one.
        const isLinear = (text: string): boolean =>
            collapseBracketGroupsCounted(text).steps <= STEPS_PER_CHAR * text.length;

        it.each([
            ['nested brackets with a word in each level', `${'(a'.repeat(DEPTH)}${')'.repeat(DEPTH)}`],
            ['one word under a doubled group 100,000 deep', `${'('.repeat(DEPTH)}x${')'.repeat(DEPTH)}`],
            ['square brackets nested', `${'[a'.repeat(DEPTH)}${']'.repeat(DEPTH)}`],
            // GATE's probe: each group after a comma trims the text before it, which must not re-read that text.
            ['a run of comma groups', `a${'(, b)'.repeat(DEPTH / 5)}`],
        ])('does not overflow the stack or stall on %s', (_name, text) => {
            expect(collapseBracketGroups(text).length).toBeGreaterThan(0);
            expect(isLinear(text)).toBe(true);
        });

        it('counts the steps it takes, the same text as the plain call', () => {
            const text = '((softened)) butter [[x]]';

            expect(collapseBracketGroupsCounted(text)).toEqual({
                text: collapseBracketGroups(text),
                steps: expect.any(Number),
            });
            expect(collapseBracketGroupsCounted(text).steps).toBeGreaterThanOrEqual(2 * text.length);
        });

        it('collapses a doubled group however deep it is', () => {
            expect(collapseBracketGroups(`${'('.repeat(DEPTH)}x${')'.repeat(DEPTH)}`)).toBe('(x)');
        });

        it.each([
            ['round', '('],
            ['square', '['],
        ])('does not stall on 100,000 unclosed %s brackets', (_name, open) => {
            const text = `${open.repeat(DEPTH)}x`;

            expect(collapseBracketGroups(text)).toBe(text);
            expect(isLinear(text)).toBe(true);
        });

        it('does not stall on 50,000 unclosed brackets in front of closed ones', () => {
            const text = `${'('.repeat(50_000)}${'(a)'.repeat(10_000)}`;

            expect(collapseBracketGroups(text).length).toBe(text.length);
            expect(isLinear(text)).toBe(true);
        });
    });
});

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

    describe('hostile input: linear time and no recursion, whatever the nesting', () => {
        /** The longest line the reader hands it, and far past it: the function must be safe on its own. */
        const DEPTH = 100_000;

        it.each([
            ['nested brackets with a word in each level', `${'(a'.repeat(DEPTH)}${')'.repeat(DEPTH)}`],
            ['one word under a doubled group 100,000 deep', `${'('.repeat(DEPTH)}x${')'.repeat(DEPTH)}`],
            ['square brackets nested', `${'[a'.repeat(DEPTH)}${']'.repeat(DEPTH)}`],
        ])('does not overflow the stack or stall on %s', (_name, text) => {
            const started = performance.now();
            const out = collapseBracketGroups(text);

            expect(out.length).toBeGreaterThan(0);
            expect(performance.now() - started).toBeLessThan(1_000);
        });

        it('collapses a doubled group however deep it is', () => {
            expect(collapseBracketGroups(`${'('.repeat(DEPTH)}x${')'.repeat(DEPTH)}`)).toBe('(x)');
        });

        it.each([
            ['round', '('],
            ['square', '['],
        ])('does not stall on 100,000 unclosed %s brackets', (_name, open) => {
            const text = `${open.repeat(DEPTH)}x`;
            const started = performance.now();

            expect(collapseBracketGroups(text)).toBe(text);
            expect(performance.now() - started).toBeLessThan(1_000);
        });

        it('does not stall on 50,000 unclosed brackets in front of closed ones', () => {
            const text = `${'('.repeat(50_000)}${'(a)'.repeat(10_000)}`;
            const started = performance.now();

            expect(collapseBracketGroups(text).length).toBe(text.length);
            expect(performance.now() - started).toBeLessThan(1_000);
        });
    });
});

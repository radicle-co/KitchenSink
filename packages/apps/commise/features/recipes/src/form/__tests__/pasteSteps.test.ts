/**
 * Unit tests for `splitPastedSteps` (`docs/design/uiOverhaul/buildSpec.md` §7.6): pasted text splits at blank lines and
 * at leading step numbers, and nothing that merely STARTS with a number (an amount, a temperature) is read as one.
 */
import { describe, expect, it } from 'vitest';

import { splitPastedSteps } from '../pasteSteps.js';

describe('splitPastedSteps', () => {
    it.each<[string, string, readonly string[]]>([
        ['empty text', '', []],
        ['only whitespace and blank lines', '  \n\n \t\n', []],
        ['one line', 'Boil the water.', ['Boil the water.']],
        [
            'blank lines between steps',
            'Boil the water.\n\nAdd the pasta.\n\n\nDrain it.',
            ['Boil the water.', 'Add the pasta.', 'Drain it.'],
        ],
        [
            'a single line break stays inside its step',
            'Boil the water.\nSalt it well.\n\nAdd the pasta.',
            ['Boil the water.\nSalt it well.', 'Add the pasta.'],
        ],
        [
            '"1." markers with no blank lines',
            '1. Boil the water.\n2. Add the pasta.',
            ['Boil the water.', 'Add the pasta.'],
        ],
        ['"2)" markers', '1) Boil.\n2) Drain.', ['Boil.', 'Drain.']],
        ['"3 -" markers', '1 - Boil.\n2 - Drain.', ['Boil.', 'Drain.']],
        ['a marker with leading spaces', '  1. Boil.\n  2. Drain.', ['Boil.', 'Drain.']],
        [
            'a numbered step that wraps onto a second line',
            '1. Boil the water\nuntil it rolls.\n2. Drain.',
            ['Boil the water\nuntil it rolls.', 'Drain.'],
        ],
        ['an amount is not a marker ("1.5 cups")', '1.5 cups flour, sifted.', ['1.5 cups flour, sifted.']],
        ['a count is not a marker ("2 eggs")', 'Beat\n2 eggs into it.', ['Beat\n2 eggs into it.']],
        ['a temperature is not a marker', '350°F oven for an hour.', ['350°F oven for an hour.']],
        ['Windows line endings', '1. Boil.\r\n2. Drain.\r\n\r\nServe.', ['Boil.', 'Drain.', 'Serve.']],
        ['a marker with no text drops out', '1.\n2. Drain.', ['Drain.']],
        ['each step is trimmed', '   Boil.   \n\n\tDrain.\t', ['Boil.', 'Drain.']],
    ])('%s', (_case, text, expected) => {
        expect(splitPastedSteps(text)).toEqual(expected);
    });
});

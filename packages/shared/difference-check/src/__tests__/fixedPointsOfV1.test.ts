/**
 * The synthetic words the boundary cases count with must be their own normal form, or an exact-count assertion
 * would be off by the fold and not by the measure.
 */
import { describe, expect, it } from 'vitest';

import { normaliseV1 } from '../normalise/normaliseV1.js';
import { synthWord, synthWords, textOf } from '../__fixtures__/synthetic.js';

describe('synthetic words', () => {
    it('are distinct', () => {
        expect(new Set(synthWords(4096)).size).toBe(4096);
    });

    it('keep their own spelling through every stage, so a case can count tokens exactly', () => {
        const words = synthWords(4096);

        expect(normaliseV1(textOf(words))).toEqual(words);
    });

    it('start at the first word and carry', () => {
        expect(synthWord(0)).toBe('bbbb');
        expect(synthWord(1)).toBe('bbbd');
        expect(synthWord(8)).toBe('bbdb');
    });
});

import { describe, expect, it } from 'vitest';

import { monogramOf } from '../coverTint.js';

describe('monogramOf', () => {
    it('is the title’s first letter, upper-cased', () => {
        expect(monogramOf('lemon tart')).toBe('L');
    });

    it('skips leading space and punctuation to the first letter or digit', () => {
        expect(monogramOf('  “Grandma’s” stew')).toBe('G');
        expect(monogramOf('7-layer dip')).toBe('7');
    });

    it('keeps a character outside the BMP whole', () => {
        expect(monogramOf('𝒜pple pie')).toBe('𝒜');
    });

    it('is empty for a title with no letter or digit', () => {
        expect(monogramOf('…')).toBe('');
    });
});

describe('monogramOf — scripts without case', () => {
    it('shows the first character of a caseless title as it is', () => {
        expect(monogramOf('麻婆豆腐')).toBe('麻');
    });
});

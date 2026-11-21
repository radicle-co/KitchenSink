/**
 * The frozen lists of v1 (qse Q-L2): the unit words and the stopwords. A list that changes moves an answer v1 gave, so a
 * change fails here and needs a qse TEST-CHANGE record. The hash is over the serialised list in its written order.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { V1_STOPWORDS } from '../v1Stopwords.js';
import { V1_UNITS } from '../v1Units.js';

/** sha256 of a list's JSON. */
function hashOf(words: ReadonlySet<string>): string {
    return createHash('sha256')
        .update(JSON.stringify([...words]))
        .digest('hex');
}

describe('the frozen lists', () => {
    it('V1_UNITS is the list v1 was frozen with', () => {
        expect(hashOf(V1_UNITS)).toBe('cf598311af5fdc0c39054f23f10990b112f74efc782c16c3218ac1e52cd4b45f');
    });

    it('V1_STOPWORDS is the list v1 was frozen with', () => {
        expect(hashOf(V1_STOPWORDS)).toBe('c0586dbf74b2e0dfbc18cbbb0e3cbdf2e7021da2c227a7bcc359e43f0b4d38a0');
    });

    it('V1_STOPWORDS holds only lower case words made of letters', () => {
        for (const word of V1_STOPWORDS) {
            expect(word).toMatch(/^\p{L}+$/u);
            expect(word).toBe(word.toLowerCase());
        }
    });

    it('V1_STOPWORDS names no cooking word, so no step is dropped from the compare', () => {
        for (const word of ['oven', 'bake', 'stir', 'onion', 'salt', 'heat', 'oil', 'minutes']) {
            expect(V1_STOPWORDS.has(word)).toBe(false);
        }
    });
});

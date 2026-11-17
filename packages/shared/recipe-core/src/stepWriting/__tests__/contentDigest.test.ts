/** The canonical string a recipe's saved content is hashed from. The hash itself is injected by callers. */
import { describe, expect, it } from 'vitest';

import { contentDigestInput } from '../contentDigest.js';

const base = {
    steps: ['Boil the water.', 'Add the pasta.'],
    ingredientLines: ['200 g pasta', '1 tsp salt'],
    language: 'en',
};

describe('contentDigestInput', () => {
    it('is the same for the same content', () => {
        expect(contentDigestInput(base)).toBe(contentDigestInput({ ...base }));
    });

    it('does not depend on the order the input fields are written in', () => {
        const reordered = { language: 'en', ingredientLines: base.ingredientLines, steps: base.steps };
        expect(contentDigestInput(reordered)).toBe(contentDigestInput(base));
    });

    it('ignores edge whitespace, repeated whitespace and empty lines', () => {
        const noisy = {
            steps: ['  Boil   the water. ', '', '\nAdd the\tpasta.  ', '   '],
            ingredientLines: [' 200  g pasta', '1 tsp salt  ', ''],
            language: 'en',
        };
        expect(contentDigestInput(noisy)).toBe(contentDigestInput(base));
    });

    it('reads composed and decomposed accents as the same text', () => {
        const composed = { steps: ['Fl\u00e4mbier'], ingredientLines: ['cr\u00e8me'], language: 'fr' };
        const decomposed = {
            steps: ['Fl\u00e4mbier'.normalize('NFD')],
            ingredientLines: ['cr\u00e8me'.normalize('NFD')],
            language: 'fr',
        };
        expect(contentDigestInput(decomposed)).toBe(contentDigestInput(composed));
    });

    it('changes when the order of steps changes', () => {
        expect(contentDigestInput({ ...base, steps: [...base.steps].reverse() })).not.toBe(contentDigestInput(base));
    });

    it('changes when an ingredient line is renamed, because steps name ingredients', () => {
        expect(contentDigestInput({ ...base, ingredientLines: ['200 g penne', '1 tsp salt'] })).not.toBe(
            contentDigestInput(base),
        );
    });

    it('changes with the language', () => {
        expect(contentDigestInput({ ...base, language: 'fr' })).not.toBe(contentDigestInput(base));
    });

    it('keeps steps and ingredients apart, so moving a line across lists changes the input', () => {
        const a = contentDigestInput({ steps: ['x'], ingredientLines: ['y'], language: 'en' });
        const b = contentDigestInput({ steps: ['y'], ingredientLines: ['x'], language: 'en' });
        expect(a).not.toBe(b);
    });

    it('carries a version so a later format cannot collide with this one', () => {
        expect(JSON.parse(contentDigestInput(base))).toMatchObject({ v: 1, lang: 'en' });
    });
});

/**
 * Unit tests for the Paste ingredients deep link (build spec §7.5.4): the address Home's and My recipes' first-run
 * Paste ingredients open, and the flag the editor container reads back from it.
 */
import { describe, expect, it } from 'vitest';

import { opensPasteSheet, pasteIngredientsHref } from '../pasteIngredientsHref';

describe('pasteIngredientsHref', () => {
    it('opens a new recipe at its Ingredients section with the paste sheet asked for', () => {
        expect(pasteIngredientsHref('en')).toBe('/en/recipes/new?paste=1#ingredients');
    });

    it('is read back by the editor: the flag it sets, and nothing else', () => {
        expect(opensPasteSheet(new URLSearchParams('paste=1'))).toBe(true);
        expect(opensPasteSheet(new URLSearchParams('draft=local%3Arecipe%3Ax'))).toBe(false);
        expect(opensPasteSheet(new URLSearchParams('paste=0'))).toBe(false);
    });
});

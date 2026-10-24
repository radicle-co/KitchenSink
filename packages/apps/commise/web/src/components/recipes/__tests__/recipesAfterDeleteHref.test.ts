/**
 * Unit tests for the address a delete lands on (owner decision 2026-10-13, 4): My recipes, carrying the one-shot flag that
 * makes the list say "Recipe deleted", and the reading of that flag back.
 */
import { describe, expect, it } from 'vitest';

import { arrivedAfterDelete, recipesAfterDeleteHref } from '../recipesAfterDeleteHref';

describe('recipesAfterDeleteHref', () => {
    it('lands on My recipes with the deleted flag', () => {
        expect(recipesAfterDeleteHref('en')).toBe('/en/recipes?deleted=1');
    });

    it('is read back by the list: the flag it sets, and nothing else', () => {
        expect(arrivedAfterDelete('1')).toBe(true);
        expect(arrivedAfterDelete('0')).toBe(false);
        expect(arrivedAfterDelete('')).toBe(false);
        expect(arrivedAfterDelete('true')).toBe(false);
    });
});

/**
 * Unit tests for the New recipe press token: the address the sidebar's New recipe opens, and the token the editor
 * container keys its new-recipe subtree on.
 */
import { describe, expect, it } from 'vitest';

import { freshRecipeHref, freshTokenOf, withDraftRef } from '../freshRecipeHref';

describe('freshRecipeHref', () => {
    it('opens the new recipe route with the press token', () => {
        expect(freshRecipeHref('en', 'tok-1')).toBe('/en/recipes/new?fresh=tok-1');
    });

    it('encodes a token that is not URL-safe', () => {
        expect(freshRecipeHref('en', 'a b&c')).toBe('/en/recipes/new?fresh=a+b%26c');
    });
});

describe('freshTokenOf', () => {
    it('reads the token back, and nothing else', () => {
        expect(freshTokenOf(new URLSearchParams('fresh=tok-1'))).toBe('tok-1');
        expect(freshTokenOf(new URLSearchParams('draft=local%3Arecipe%3Ax'))).toBeUndefined();
        expect(freshTokenOf(new URLSearchParams('fresh='))).toBeUndefined();
    });
});

describe('withDraftRef', () => {
    it('keeps the token while the URL moves to a draft, so the keyed subtree does not remount', () => {
        expect(withDraftRef('?fresh=tok-1', 'local:recipe:x')).toBe('?fresh=tok-1&draft=local%3Arecipe%3Ax');
    });

    it('replaces an earlier draft ref, and drops the paste flag, which asks for the sheet once', () => {
        expect(withDraftRef('?draft=old&fresh=tok-1&paste=1', 'new')).toBe('?fresh=tok-1&draft=new');
    });

    it('works with no query at all', () => {
        expect(withDraftRef('', 'x')).toBe('?draft=x');
    });
});

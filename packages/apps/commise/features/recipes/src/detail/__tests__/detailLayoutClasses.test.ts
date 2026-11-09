/**
 * The detail page's Tailwind class strings. Tailwind generates only the class names it finds whole, so a stray quote or `+`
 * left inside a string (a concatenation pasted into a template literal) becomes a token that matches nothing, and the
 * class after it can be lost with it. A browser sees the result; jsdom does not, so the strings are checked as text.
 */
import { describe, expect, it } from 'vitest';

import * as layoutClasses from '../detailLayoutClasses.js';

describe('detailLayoutClasses', () => {
    // Every export of the module is a class string; a non-string export would fail the token check below.
    const constants: [string, string][] = Object.entries(layoutClasses);

    it('exports class strings to check', () => {
        expect(constants.length).toBeGreaterThan(5);
    });

    it.each(constants)('%s holds only whole class tokens, with no quote, plus or backtick', (_name, value) => {
        for (const token of value.split(/\s+/u).filter((part) => part !== '')) {
            expect(token).toMatch(/^[^'"+`]+$/u);
        }
    });

    it('lets any user-authored word break at the article, so one long word cannot widen the page past its gutter', () => {
        expect(layoutClasses.DETAIL_ARTICLE.split(/\s+/u)).toContain('[overflow-wrap:anywhere]');
    });

    it('keeps the ingredients column’s max height, so a sticky column scrolls inside itself', () => {
        expect(layoutClasses.INGREDIENTS_COLUMN.split(/\s+/u)).toContain(
            '@min-[45rem]/detail:max-h-[calc(100dvh-6rem)]',
        );
    });
});

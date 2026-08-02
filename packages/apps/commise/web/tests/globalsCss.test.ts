import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Shape guard for the app's global stylesheet.
 *
 * CSS requires every `@import` to precede all other rules (bar `@charset` and `@layer` statements). An
 * `@import` placed after any other rule is INVALID and is silently discarded by the CSS optimizer — the
 * `next build` log mentions it, but nothing fails. That is exactly how the Google Fonts import came to sit
 * below the Tailwind `@source` rules and get dropped, shipping a production bundle with zero webfonts:
 * every heading fell back from Playfair Display to Georgia and every body string from Inter to system-ui,
 * gracefully enough that no test and no reviewer noticed.
 */
const globalsCss = readFileSync(resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8')
    // Comments can contain anything, including the literal '@import' in prose like this file's own header.
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** The offset of the earliest at-rule that makes any later `@import` invalid, or `Infinity` if none. */
function firstNonPreambleRuleOffset(css: string): number {
    const offsets = ['@source', '@theme', '@keyframes', '@media', '@supports', '@font-face']
        .map((rule) => css.indexOf(rule))
        .filter((offset) => offset !== -1);
    // `@layer base {` (block form) also closes the preamble; the bare `@layer a, b;` statement form does not.
    const layerBlock = css.search(/@layer\s+[^;{]*\{/);

    if (layerBlock !== -1) offsets.push(layerBlock);

    return offsets.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...offsets);
}

describe('globals.css', () => {
    it('declares every @import before any rule that would invalidate it', () => {
        const cutoff = firstNonPreambleRuleOffset(globalsCss);
        const strays = [...globalsCss.matchAll(/@import[^;]*;/g)]
            .filter((match) => match.index !== undefined && match.index > cutoff)
            .map((match) => match[0]);

        expect(strays, 'these @import rules sit after another rule and will be DROPPED from the bundle') //
            .toEqual([]);
    });

    it('still imports the brand webfont families', () => {
        // Guards against "fixing" the ordering by deleting the import outright. If these ever move to
        // `next/font`, delete this test in the same commit that adds the replacement.
        expect(globalsCss).toContain('fonts.googleapis.com');

        for (const family of ['Inter', 'JetBrains+Mono', 'Playfair+Display']) {
            expect(globalsCss, `${family} must stay in the font import`).toContain(family);
        }
    });
});

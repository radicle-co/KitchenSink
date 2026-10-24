import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { withoutCssComments } from '@kitchensink/repo-guards/sourceComments';

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
// Comments can contain anything, including the literal '@import' in prose like this file's own header.
const globalsCss = withoutCssComments(readFileSync(resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8'));

/** The offset of the earliest at-rule that makes any later `@import` invalid, or `Infinity` if none. */
function firstNonPreambleRuleOffset(css: string): number {
    const offsets = ['@source', '@theme', '@keyframes', '@media', '@supports', '@font-face']
        .map((rule) => css.indexOf(rule))
        .filter((offset) => offset !== -1);
    // `@layer base {` (block form) also closes the preamble; the bare `@layer a, b;` statement form does not.
    const layerBlock = css.search(/@layer\s+[^;{]*\{/);

    if (layerBlock !== -1) {
        offsets.push(layerBlock);
    }

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

    /**
     * Clerk's own styles are unlayered emotion CSS, which out-ranks a Tailwind utility whatever its specificity. The
     * appearance puts them in the `clerk` layer (`CLERK_CSS_LAYER`); this statement is what ranks that layer BELOW
     * `utilities`, so the role classes on Clerk's elements win. Declared before the theme import, because the FIRST
     * ordering statement of a layer name fixes its place and Tailwind's own `@layer theme, base, components, utilities`
     * (inside the import) would otherwise leave `clerk` last, above everything.
     */
    it('orders the clerk layer between base and components, before Tailwind declares its own order', () => {
        const statement = /@layer\s+([^;{]+);/.exec(globalsCss);
        const themeImport = globalsCss.indexOf("@import '@commise/ui/theme.css'");
        const layers = (statement?.[1] ?? '').split(',').map((name) => name.trim());

        expect(statement, 'a bare @layer ordering statement').not.toBeNull();
        expect(statement?.index ?? Number.POSITIVE_INFINITY).toBeLessThan(themeImport);
        expect(layers.indexOf('clerk')).toBeGreaterThan(layers.indexOf('base'));
        expect(layers.indexOf('clerk')).toBeLessThan(layers.indexOf('utilities'));
        expect(layers.indexOf('clerk')).toBeLessThan(layers.indexOf('components'));
    });

    /**
     * A pushed page pins a Back bar over the top of the document below 840 (`PushedPageFrame`,
     * `docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6). The bar's rendered height is ONE property,
     * `--pinned-bar-block` (`@commise/ui`'s theme: `--pinned-bar-height` plus the notch's inset), and this stylesheet reads
     * it twice, keyed on the frame being in the page and ONLY below 840, where the bar is shown:
     *   - `scroll-padding-top`, so a focused control scrolled into view is never left under the bar (WCAG 2.2 SC 2.4.11);
     *   - `--main-top`, the top padding of `<main>`, so what the shell draws above the page (the connectivity notice) sits
     *     under the bar and the H1 lands at the bar's height instead of 24 px below it.
     * The default `--main-top` (1.5rem, the old `pt-6`) is declared ONCE: the reservation is a max-width rule, so there is no
     * reset from 840 to restate it. A text check: the browser behaviour is asserted by the pushed-page Playwright specs.
     */
    it('reserves the pinned back bar’s rendered height below 840 only, keyed on the frame, from the one property', () => {
        const compact = globalsCss.replace(/\s+/g, ' ');
        const reserve =
            /@media \(width < 52\.5rem\) \{[^@]*html:has\(\[data-pushed-page\]\) \{ scroll-padding-top: var\(--pinned-bar-block\); --main-top: var\(--pinned-bar-block\); \}/.exec(
                compact,
            );

        expect(reserve, 'the reservation under the pinned bar, below 840 only').not.toBeNull();
        expect(globalsCss, 'no height literal of its own: the property is the one source').not.toContain('3.5rem');
    });

    it('declares the main top padding default once', () => {
        const declarations = globalsCss.match(/--main-top:\s*1\.5rem/g) ?? [];

        expect(declarations, 'the 1.5rem default, restated nowhere else').toHaveLength(1);
    });

    it('still imports the brand webfont families', () => {
        // Guards against "fixing" the ordering by deleting the import outright. If these ever move to
        // `next/font`, delete this test in the same commit that adds the replacement.
        expect(globalsCss).toContain('fonts.googleapis.com');

        for (const family of ['Inter', 'JetBrains+Mono', 'Playfair+Display']) {
            expect(globalsCss, `${family} must stay in the font import`).toContain(family);
        }
    });

    /**
     * Tailwind v4 scans THIS app's files and nothing it imports from a workspace package, so a utility class used
     * only inside a shared package is simply never generated — the element renders unstyled and no test notices.
     * Every `@commise/*` dependency whose web source writes a `className` must therefore be an `@source`.
     */
    it('scans every @commise workspace package whose web components carry utility classes', () => {
        const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
        };
        const cssDirectory = resolve(import.meta.dirname, '../src/app');
        // Read from the RAW file, anchored to a line start: a glob's `/**/` looks like a comment to the stripper
        // above, and an `@source` inside a real comment never starts a line of this file.
        const rawCss = readFileSync(resolve(cssDirectory, 'globals.css'), 'utf8');
        const sourced = [...rawCss.matchAll(/^@source\s+["']([^"']+)["']/gm)].map((match) =>
            resolve(cssDirectory, (match[1] ?? '').split('/**')[0] ?? ''),
        );

        const unsourced = Object.keys(manifest.dependencies ?? {})
            .filter((name) => name.startsWith('@commise/'))
            .map((name) => ({
                name,
                src: join(packageDirectory(name), 'src'),
            }))
            .filter(({ src }) => writesClassNames(src))
            .filter(({ src }) => !sourced.some((root) => !relative(root, src).startsWith('..')))
            .map(({ name }) => name);

        expect(unsourced, 'these packages style web components but are not scanned by Tailwind').toEqual([]);
    });
});

/** Whether any web (non-`.native`) TSX file under `directory` writes a `className`. */
function writesClassNames(directory: string): boolean {
    let entries: string[];

    try {
        entries = readdirSync(directory, { recursive: true, encoding: 'utf8' });
    } catch {
        return false;
    }

    return entries
        .filter((entry) => entry.endsWith('.tsx') && !entry.endsWith('.native.tsx') && !entry.includes('__tests__'))
        .some((entry) => readFileSync(join(directory, entry), 'utf8').includes('className='));
}

/** A dependency's real directory, found the way Node resolves it: the nearest `node_modules` walking up. */
function packageDirectory(name: string): string {
    for (let directory = resolve(import.meta.dirname, '..'); ; directory = dirname(directory)) {
        const candidate = join(directory, 'node_modules', name);

        try {
            return realpathSync(candidate);
        } catch {
            if (dirname(directory) === directory) {
                throw new Error(`cannot resolve ${name} from the web app`);
            }
        }
    }
}

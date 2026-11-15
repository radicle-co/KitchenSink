import { describe, expect, it } from 'vitest';

import { MAX_PASTE_BYTES, readPastedContent } from '@kitchensink/recipe-core/page-reader';

import { makeLinkHead, makePage, makeRecipeNode } from '../src/pageReader/__fixtures__/pageFixtures.js';

/**
 * The page reader as a package consumer sees it: through the `page-reader` export, over the real htmlparser2 and
 * tinyduration, on a page the size of the largest one measured (about 4 times over). Nothing is mocked.
 */

/** One 32,000-character line, the length of the longest line measured on real pages (31,800). */
const LONG_LINE_CHARS = 32_000;
/** The budget for reading a 2 MB paste on Node. The measured cost is a fraction of it; the headroom is for a busy CI runner. */
const TIME_BUDGET_MS = 1_500;

/** A synthetic page of about `bytes` bytes: long lines of markup and script around one JSON-LD recipe. */
function makeHugePage(bytes: number): string {
    const filler = `<p>${'word '.repeat(LONG_LINE_CHARS / 5)}</p>\n`;
    const minifiedScript = `<script>var a=${JSON.stringify('x'.repeat(LONG_LINE_CHARS))};</script>\n`;
    const head = makeLinkHead({ canonical: 'https://www.example.com/recipe/1/pancakes/' });
    const shell = makePage({
        jsonLd: [{ '@context': 'https://schema.org', '@graph': [makeRecipeNode()] }],
        head,
        body: '',
    });
    const lines: string[] = [];
    let size = shell.length;

    for (let index = 0; size < bytes - filler.length; index += 1) {
        const line = index % 3 === 0 ? minifiedScript : filler;

        lines.push(line);
        size += line.length;
    }

    return shell.replace('</body>', `${lines.join('')}</body>`);
}

describe('readPastedContent over a whole synthetic page', () => {
    it('reads a 2 MB page with 32,000-character lines inside the time budget', () => {
        const page = makeHugePage(1_900_000);

        expect(page.length).toBeGreaterThan(1_800_000);
        expect(page.split('\n').some((line) => line.length >= LONG_LINE_CHARS)).toBe(true);

        const started = performance.now();
        const result = readPastedContent(page);
        const elapsed = performance.now() - started;

        expect(result).toMatchObject({
            kind: 'found',
            recipe: {
                title: 'Test Pancakes',
                servings: 4,
                prepTimeMinutes: 10,
                cookTimeMinutes: 15,
                totalTimeMinutes: 25,
                ingredientLines: ['1 cup flour', '2 eggs'],
                steps: [{ instruction: 'Mix.' }, { instruction: 'Cook.' }],
            },
            source: { kind: 'found', citation: { site: 'example.com' } },
        });
        expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
    });

    it('refuses the same page once it passes the byte cap', () => {
        // Literal numbers on purpose: the cap is a published limit (blueprint §4), so a test that derived the page from
        // the constant would pass for any value of it.
        const page = makeHugePage(2_050_000);

        expect(MAX_PASTE_BYTES).toBe(2_000_000);
        expect(readPastedContent(page)).toEqual({ kind: 'tooLarge', maxBytes: MAX_PASTE_BYTES });
    });

    it('leaves Object.prototype alone when the page carries hostile keys', () => {
        const hostile =
            '{"__proto__":{"polluted":1},"@graph":[{"@type":"Recipe","name":"Safe","recipeIngredient":["1 egg"],"__proto__":{"name":"Evil"}}]}';

        expect(readPastedContent(makePage({ jsonLd: [hostile] }))).toMatchObject({
            kind: 'found',
            recipe: { title: 'Safe' },
        });
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('reads a 2 MB page with no recipe in its JSON-LD inside the time budget, so every strategy runs', () => {
        const page = makeHugePage(1_900_000).replace(/"@type":"Recipe"/u, '"@type":"Article"');

        expect(page).not.toContain('"@type":"Recipe"');

        const started = performance.now();
        const result = readPastedContent(page);

        expect(result).toMatchObject({ kind: 'none', source: { kind: 'found', citation: { site: 'example.com' } } });
        expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    });

    it('reads hostile microdata inside the time budget: Recipe items nested to the cap, each wrapping the rest in a property', () => {
        const levels = 120;
        const open = '<div itemscope itemtype="https://schema.org/Recipe"><span itemprop="note">';
        const close = '</span></div>';
        const tail = '<i itemprop="x">t</i>'.repeat(60_000);
        const page = makePage({ body: `${open.repeat(levels)}${tail}${close.repeat(levels)}` });

        expect(page.length).toBeGreaterThan(1_000_000);

        const started = performance.now();
        const result = readPastedContent(page);

        expect(result.kind).toBe('none');
        expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    });

    it('reads a flat 2 MB microdata page of many Recipe items inside the time budget', () => {
        const items = '<div itemscope itemtype="https://schema.org/Recipe"><i itemprop="name">r</i></div>'.repeat(
            20_000,
        );
        const started = performance.now();
        const result = readPastedContent(makePage({ body: items }));

        expect(result.kind).toBe('none');
        expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    });
});

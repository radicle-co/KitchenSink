import { describe, expect, it } from 'vitest';

import { MAX_PASTE_BYTES, readPastedContent } from '@kitchensink/recipe-core/page-reader';

import { MAX_JSON_LD_BLOCK_BYTES, MAX_RECIPES_PER_PAGE } from '../src/pageReader/pageCaps.js';
import { makeLinkHead, makePage, makeRecipeCard, makeRecipeNode } from '../src/pageReader/__fixtures__/pageFixtures.js';

/**
 * The page reader as a package consumer sees it: through the `page-reader` export, over the real htmlparser2 and
 * tinyduration, on a page the size of the largest one measured (about 4 times over). Nothing is mocked.
 */

/** One 32,000-character line, the length of the longest line measured on real pages (31,800). */
const LONG_LINE_CHARS = 32_000;
/** The budget for reading a 2 MB paste on Node. The measured cost is a fraction of it; the headroom is for a busy CI runner. */
const TIME_BUDGET_MS = 1_500;
/** Empty elements around the recipes on the several-recipes page: every tag lookup walks all of them (28.9 s measured at 250,000 before the page was indexed once). */
const EMPTY_ELEMENTS = 200_000;

/**
 * A synthetic page of about `bytes` bytes: long lines of markup, comment and script around one JSON-LD recipe that the page
 * shows as a card. The filler is a comment, not visible text: a page of 1.9 MB of visible words is `pageTooComplex` (its own
 * test below), and this one is about the cost of the size.
 */
function makeHugePage(bytes: number): string {
    const filler = `<!--${'word '.repeat(LONG_LINE_CHARS / 5)}-->\n`;
    const minifiedScript = `<script>var a=${JSON.stringify('x'.repeat(LONG_LINE_CHARS))};</script>\n`;
    const head = makeLinkHead({ canonical: 'https://www.example.com/recipe/1/pancakes/' });
    const shell = makePage({
        jsonLd: [{ '@context': 'https://schema.org', '@graph': [makeRecipeNode()] }],
        head,
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
            kind: 'extracted',
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

    it('keeps hostile __proto__ keys out of the recipe it reads', () => {
        const hostile =
            '{"__proto__":{"polluted":1},"@graph":[{"@type":"Recipe","name":"Safe","recipeIngredient":["1 egg"],"recipeInstructions":"Cook it well.","__proto__":{"name":"Evil"}}]}';
        const card = makeRecipeCard({
            name: 'Safe',
            recipeIngredient: ['1 egg'],
            recipeInstructions: ['Cook it well.'],
        });

        expect(readPastedContent(makePage({ jsonLd: [hostile], body: card }))).toMatchObject({
            kind: 'extracted',
            recipe: { title: 'Safe' },
        });
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('reads a 2 MB page with no recipe in its JSON-LD inside the time budget, so every strategy runs', () => {
        const page = makeHugePage(1_900_000).replace(/"@type":"Recipe"/u, '"@type":"Article"');

        expect(page).not.toContain('"@type":"Recipe"');

        const started = performance.now();
        const result = readPastedContent(page);

        expect(result).toMatchObject({
            kind: 'notExtractable',
            reason: 'noRecipe',
            source: { kind: 'found', citation: { site: 'example.com' } },
        });
        expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    });

    /** Rewritten: the property text that wraps the rest is cut at the node cap, so the page is `pageTooComplex`, not `noRecipe`. */
    it('reads hostile microdata inside the time budget: Recipe items nested to the cap, each wrapping the rest in a property', () => {
        const levels = 120;
        const open = '<div itemscope itemtype="https://schema.org/Recipe"><span itemprop="note">';
        const close = '</span></div>';
        const tail = '<i itemprop="x">t</i>'.repeat(60_000);
        const page = makePage({ body: `${open.repeat(levels)}${tail}${close.repeat(levels)}` });

        expect(page.length).toBeGreaterThan(1_000_000);

        const started = performance.now();
        const result = readPastedContent(page);

        expect(result).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
        expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    });

    /** A microdata Recipe item that passes the gate: a name, an ingredient and a step. */
    const microdataRecipe = (name: string, extra = '') =>
        `<div itemscope itemtype="https://schema.org/Recipe"><i itemprop="name">${name}</i><i itemprop="recipeIngredient">1 egg</i><i itemprop="recipeInstructions">Cook it well.</i>${extra}</div>`;

    /**
     * Rewritten for the 2026-11-15 ruling: this page used to come back as `several`. It is now `severalRecipes`, a plain no,
     * and it must still cost the same: one selection over 64 candidates, the addresses read once.
     */
    it('reads a 1.4 MB microdata page of many different Recipe items, among 200,000 empty elements, to severalRecipes inside the time budget', () => {
        const items = Array.from({ length: 100 }, (_, index) => microdataRecipe(`r${index}`)).join('');
        const started = performance.now();
        const result = readPastedContent(makePage({ body: items + '<u></u>'.repeat(EMPTY_ELEMENTS) }));

        expect(result).toMatchObject({ kind: 'notExtractable', reason: 'severalRecipes' });
        expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    });

    it('collapses 64 near-duplicate microdata Recipe items, among 200,000 empty elements, to the one recipe inside the time budget', () => {
        // Each differs from the first only in the case and spacing of its name, so none shares a key and all reach selection.
        const items = Array.from({ length: MAX_RECIPES_PER_PAGE }, (_, index) =>
            microdataRecipe(index % 2 === 0 ? 'Pancakes' : ` PANCAKES${' '.repeat(index)}`),
        ).join('');
        const started = performance.now();
        const result = readPastedContent(makePage({ body: items + '<u></u>'.repeat(EMPTY_ELEMENTS) }));

        expect(result).toMatchObject({ kind: 'extracted', tier: 'microdata', recipe: { title: 'Pancakes' } });
        expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    });

    it('selects among 64 microdata items that each name an address, one of them the page, inside the time budget', () => {
        const page = 'https://www.example.com/recipe/32/';
        const items = Array.from({ length: MAX_RECIPES_PER_PAGE }, (_, index) =>
            microdataRecipe(`r${index}`, `<link itemprop="url" href="https://www.example.com/recipe/${index}/">`),
        ).join('');
        const started = performance.now();
        const result = readPastedContent(
            makePage({ head: makeLinkHead({ canonical: page }), body: items + '<u></u>'.repeat(EMPTY_ELEMENTS) }),
        );

        expect(result).toMatchObject({ kind: 'extracted', recipe: { title: 'r32' } });
        expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    });

    it('reads a page whose JSON-LD holds over a thousand Recipe nodes to severalRecipes inside the time budget', () => {
        // Small nodes, so the one block stays under the byte limit and only the per-page recipe cap bounds the work.
        const nodes = Array.from({ length: 1_500 }, (_, index) => ({
            '@type': 'Recipe',
            '@id': `r${index}`,
            name: `r${index}`,
            recipeIngredient: ['1 egg'],
            recipeInstructions: 'Cook it well.',
        }));
        const started = performance.now();
        const result = readPastedContent(makePage({ jsonLd: [{ '@graph': nodes }] }));

        expect(result).toMatchObject({ kind: 'notExtractable', reason: 'severalRecipes' });
        expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    });

    describe('G-CORR over hostile pages (round 5), each inside the time budget', () => {
        it('says pageTooComplex for a 1.9 MB page of visible words, without reading it all twice', () => {
            const node = makeRecipeNode();
            const page = makePage({
                jsonLd: [node],
                body: makeRecipeCard(node) + `<p>${'word '.repeat(380_000)}</p>`,
            });

            expect(page.length).toBeGreaterThan(1_800_000);

            const started = performance.now();
            const result = readPastedContent(page);

            expect(result).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex', tier: 'jsonLd' });
            expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
        });

        it('stops a page whose every token is common, against steps that each end up found at the very end', () => {
            // The worst case for the index: the rarest token of "b a" still occurs 100,000 times, and only the last place is the run.
            const node = makeRecipeNode({
                recipeIngredient: ['1 a'],
                recipeInstructions: Array.from({ length: 200 }, () => 'b a'),
            });
            const page = makePage({
                jsonLd: [node],
                body: `<ul><li>1 a</li></ul><p>${'a '.repeat(100_000)}${'b '.repeat(100_000)}a</p>`,
            });
            const started = performance.now();
            const result = readPastedContent(page);

            expect(result).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
            expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
        });

        it('reads a recipe of 4,000 steps that the page shows, and refuses the page that shows all but one', () => {
            const steps = Array.from({ length: 4_000 }, (_, index) => `Stir pot ${index}.`);
            const node = makeRecipeNode({ recipeInstructions: steps.map((text) => ({ '@type': 'HowToStep', text })) });
            const page = makePage({ jsonLd: [node] });
            const missing = page.replace('<li>Stir pot 3999.</li>', '');

            expect(missing).not.toBe(page);

            const started = performance.now();
            const read = readPastedContent(page);
            const refused = readPastedContent(missing);

            expect(read).toMatchObject({ kind: 'extracted', recipe: { steps: { length: 4_000 } } });
            expect(refused).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
            expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS * 2);
        });
    });

    describe('a block nested 100,000 deep, under the byte cap', () => {
        const DEPTH = 100_000;
        const nested = `${'['.repeat(DEPTH)}"x"${']'.repeat(DEPTH)}`;

        it.each(['name', 'recipeIngredient', 'author'])('does not throw when %s holds it', (property) => {
            const block = `{"@type":"Recipe","name":"Soup","recipeIngredient":["1 egg"],"${property}":${nested}}`;

            expect(block.length).toBeLessThan(MAX_JSON_LD_BLOCK_BYTES);
            expect(() => readPastedContent(makePage({ jsonLd: [block] }))).not.toThrow();
        });
    });
});

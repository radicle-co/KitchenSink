import { describe, expect, it, vi } from 'vitest';

import { MAX_PASTE_BYTES, readPastedContent } from '@kitchensink/page-reader';

import { MAX_JSON_LD_BLOCK_BYTES, MAX_RECIPES_PER_PAGE } from '../src/pageCaps.js';
import { parsePage, type PageDocument } from '../src/pageDocument.js';
import type * as PageDocumentModule from '../src/pageDocument.js';
import type * as SchemaNodeModule from '../src/schemaNode.js';
import { makeLinkHead, makePage, makeRecipeCard, makeRecipeNode } from '../src/__fixtures__/pageFixtures.js';

/**
 * The page reader as a package consumer sees it: through its package name, `@kitchensink/page-reader`, over the real htmlparser2 and
 * tinyduration, on a page the size of the largest one measured (about 4 times over). Nothing is replaced: the parser is
 * only watched, so a test can read how much of the page the reader walked.
 *
 * ⛔ Work is COUNTED, never timed: a time budget fails on a busy CI runner and passes a slow reader on a fast one. The
 * walks that element reads make are bounded by the page's own node count (`PageDocument.work`). The count sees only
 * walks that report to it: that a tag lookup is a map read, not a walk, holds by how `parsePage` builds its index, not
 * by this count. Token comparisons, bracket collapse and the JSON-LD walk are counted in their own unit tests.
 */
vi.mock('../src/pageDocument.js', async (importOriginal) => {
    const actual = await importOriginal<typeof PageDocumentModule>();

    return { ...actual, parsePage: vi.fn(actual.parsePage) };
});

/** Every field read of a schema node is counted too: the JSON-LD a recipe names is read by `field`, not by a page walk. */
const fieldReads = vi.hoisted(() => ({ count: 0 }));

vi.mock('../src/schemaNode.js', async (importOriginal) => {
    const actual = await importOriginal<typeof SchemaNodeModule>();

    return {
        ...actual,
        field: (node: SchemaNodeModule.SchemaNode, key: string): unknown => {
            fieldReads.count += 1;

            return actual.field(node, key);
        },
    };
});

/**
 * The most node visits the reads of a page may make per node of it: one walk to index it, and a few bounded reads of parts
 * of it. Measured: every case here stays under 3. A reader that walked the page's body once per recipe makes dozens.
 */
const VISITS_PER_NODE = 4;

type PageWork = ReturnType<PageDocument['work']>;

/** Read a paste, and the work of each page it parsed. */
function readCounted(text: string): {
    readonly result: ReturnType<typeof readPastedContent>;
    readonly works: readonly PageWork[];
} {
    vi.mocked(parsePage).mockClear();

    const result = readPastedContent(text);
    const works = vi
        .mocked(parsePage)
        .mock.results.flatMap((call) => (call.type === 'return' ? [call.value.work()] : []));

    return { result, works };
}

/** Each parsed page's reads stayed within {@link VISITS_PER_NODE} of its size, and at least one page was parsed. */
function expectBoundedWalks(works: readonly PageWork[]): void {
    // Non-vacuous: a read that never parsed a page proves nothing about its walks.
    expect(works.length).toBeGreaterThan(0);

    for (const { nodes, visits } of works) {
        expect(visits).toBeLessThanOrEqual(VISITS_PER_NODE * nodes);
    }
}

/** One 32,000-character line, the length of the longest line measured on real pages (31,800). */
const LONG_LINE_CHARS = 32_000;
/** Empty elements around the recipes on the several-recipes pages: a page whose node count the recipes are a small part of. */
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
    it('reads a 2 MB page with 32,000-character lines within a bounded walk', () => {
        const page = makeHugePage(1_900_000);

        expect(page.length).toBeGreaterThan(1_800_000);
        expect(page.split('\n').some((line) => line.length >= LONG_LINE_CHARS)).toBe(true);

        const { result, works } = readCounted(page);

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
        expectBoundedWalks(works);
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

    it('reads a 2 MB page with no recipe in its JSON-LD within a bounded walk, so every strategy runs', () => {
        const page = makeHugePage(1_900_000).replace(/"@type":"Recipe"/u, '"@type":"Article"');

        expect(page).not.toContain('"@type":"Recipe"');

        const { result, works } = readCounted(page);

        expect(result).toMatchObject({
            kind: 'notExtractable',
            reason: 'noRecipe',
            source: { kind: 'found', citation: { site: 'example.com' } },
        });
        expectBoundedWalks(works);
    });

    /** Rewritten: the property text that wraps the rest is cut at the node cap, so the page is `pageTooComplex`, not `noRecipe`. */
    it('reads hostile microdata within a bounded walk: Recipe items nested to the cap, each wrapping the rest in a property', () => {
        const levels = 120;
        const open = '<div itemscope itemtype="https://schema.org/Recipe"><span itemprop="note">';
        const close = '</span></div>';
        const tail = '<i itemprop="x">t</i>'.repeat(60_000);
        const page = makePage({ body: `${open.repeat(levels)}${tail}${close.repeat(levels)}` });

        expect(page.length).toBeGreaterThan(1_000_000);

        const { result, works } = readCounted(page);

        expect(result).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
        expectBoundedWalks(works);
    });

    /**
     * A microdata Recipe item that passes the gate and the page check: a name, an ingredient and a step, each a line of the
     * card as a site writes it (microdata is held to the visible text too).
     */
    const microdataRecipe = (name: string, extra = '') =>
        `<div itemscope itemtype="https://schema.org/Recipe"><h2 itemprop="name">${name}</h2><ul><li itemprop="recipeIngredient">1 egg</li></ul><p itemprop="recipeInstructions">Cook it well.</p>${extra}</div>`;

    /**
     * Rewritten for the 2026-11-15 ruling: this page used to come back as `several`. It is now `severalRecipes`, a plain no,
     * and it must still cost the same: one selection over 64 candidates, the addresses read once.
     */
    it('reads a 1.4 MB microdata page of many different Recipe items, among 200,000 empty elements, to severalRecipes within a bounded walk', () => {
        const items = Array.from({ length: MAX_RECIPES_PER_PAGE }, (_, index) => microdataRecipe(`r${index}`)).join('');
        const { result, works } = readCounted(makePage({ body: items + '<u></u>'.repeat(EMPTY_ELEMENTS) }));

        expect(result).toMatchObject({ kind: 'notExtractable', reason: 'severalRecipes' });
        expectBoundedWalks(works);
    });

    it('collapses 64 near-duplicate microdata Recipe items, among 200,000 empty elements, to the one recipe within a bounded walk', () => {
        // Each differs from the first only in the case and spacing of its name, so none shares a key and all reach selection.
        const items = Array.from({ length: MAX_RECIPES_PER_PAGE }, (_, index) =>
            microdataRecipe(index % 2 === 0 ? 'Pancakes' : ` PANCAKES${' '.repeat(index)}`),
        ).join('');
        const { result, works } = readCounted(makePage({ body: items + '<u></u>'.repeat(EMPTY_ELEMENTS) }));

        expect(result).toMatchObject({ kind: 'extracted', tier: 'microdata', recipe: { title: 'Pancakes' } });
        expectBoundedWalks(works);
    });

    it('selects among 64 microdata items that each name an address, one of them the page, within a bounded walk', () => {
        const page = 'https://www.example.com/recipe/32/';
        const items = Array.from({ length: MAX_RECIPES_PER_PAGE }, (_, index) =>
            microdataRecipe(`r${index}`, `<link itemprop="url" href="https://www.example.com/recipe/${index}/">`),
        ).join('');
        const { result, works } = readCounted(
            makePage({ head: makeLinkHead({ canonical: page }), body: items + '<u></u>'.repeat(EMPTY_ELEMENTS) }),
        );

        expect(result).toMatchObject({ kind: 'extracted', recipe: { title: 'r32' } });
        expectBoundedWalks(works);
    });

    it('refuses a page whose JSON-LD holds over a thousand Recipe nodes as pageTooComplex within a bounded walk', () => {
        // Small nodes, so the one block stays under the byte limit and only the per-page recipe cap bounds the work.
        const nodes = Array.from({ length: 1_500 }, (_, index) => ({
            '@type': 'Recipe',
            '@id': `r${index}`,
            name: `r${index}`,
            recipeIngredient: ['1 egg'],
            recipeInstructions: 'Cook it well.',
        }));
        const { result, works } = readCounted(makePage({ jsonLd: [{ '@graph': nodes }] }));

        expect(result).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
        expectBoundedWalks(works);
    });

    describe('G-CORR over hostile pages (round 5), each within a bounded walk', () => {
        it('says pageTooComplex for a 1.9 MB page of visible words, without reading it all twice', () => {
            const node = makeRecipeNode();
            const page = makePage({
                jsonLd: [node],
                body: makeRecipeCard(node) + `<p>${'word '.repeat(380_000)}</p>`,
            });

            expect(page.length).toBeGreaterThan(1_800_000);

            const { result, works } = readCounted(page);

            expect(result).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex', tier: 'jsonLd' });
            expectBoundedWalks(works);
        });

        it('stops a page whose every token is common, against steps that each end up found at the very end', () => {
            // The worst case for the index: the rarest token of "b a" still occurs 100,000 times, and only the last place is the run.
            // The steps are read in order, so the first takes that place and the second has none after it: no is the answer.
            const node = makeRecipeNode({
                recipeIngredient: ['1 a'],
                recipeInstructions: Array.from({ length: 200 }, () => 'b a'),
            });
            const page = makePage({
                jsonLd: [node],
                body: `<ul><li>1 a</li></ul><p>${'a '.repeat(100_000)}${'b '.repeat(100_000)}a</p>`,
            });
            const { result, works } = readCounted(page);

            expect(result).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
            expectBoundedWalks(works);
        });

        it('reads a recipe of 4,000 steps that the page shows, and refuses the page that shows all but one', () => {
            const steps = Array.from({ length: 4_000 }, (_, index) => `Stir pot ${index}.`);
            const node = makeRecipeNode({ recipeInstructions: steps.map((text) => ({ '@type': 'HowToStep', text })) });
            const page = makePage({ jsonLd: [node] });
            const missing = page.replace('<li>Stir pot 3999.</li>', '');

            expect(missing).not.toBe(page);

            const read = readCounted(page);
            const refused = readCounted(missing);

            expect(read.result).toMatchObject({ kind: 'extracted', recipe: { steps: { length: 4_000 } } });
            expect(refused.result).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
            expectBoundedWalks(read.works);
            expectBoundedWalks(refused.works);
        });
    });

    // Round-5 review, High 1: an ingredient-name check over every jump link cost jump tokens × ingredient tokens, outside
    // the comparison budget (5 s on this 679 KB page). A jump link is now matched only by its short text on a closed list.
    it('refuses 340 long jump links before 200 long lines within a bounded walk', () => {
        const filler = (count: number) => Array.from({ length: count }, () => 'q').join(' ');
        const lines = Array.from({ length: 200 }, (_, index) => `${filler(450)} u${String(index)}`);
        const steps = ['Mix it all.', 'Bake until golden.'];
        const jumps = `<li><a href="#ing">${filler(448)} z</a></li>`.repeat(340);
        const page = makePage({
            jsonLd: [makeRecipeNode({ recipeIngredient: lines, recipeInstructions: steps })],
            body: `<article><div class="jump"><div><ul>${jumps}</ul></div></div><div id="ing"><ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul></div><ol>${steps.map((step) => `<li>${step}</li>`).join('')}</ol></article>`,
        });

        expect(page.length).toBeGreaterThan(600_000);

        const { result, works } = readCounted(page);

        expect(result).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
        expectBoundedWalks(works);
    });

    // GATE on fb9ccfa23: each @id a recipe names was looked up by a scan of every page node, ids × nodes reads outside any
    // budget (11 s on a 1.85 MB page). An index makes it one read per node and one lookup per id.
    it('looks up the @ids a recipe names once each, against thousands of page nodes', () => {
        const blocks = 5;
        const pagesPerBlock = 2_000;
        const ids = 5_000;
        const pageBlocks = Array.from({ length: blocks }, (_, block) => ({
            '@graph': Array.from({ length: pagesPerBlock }, (_, index) => ({
                '@type': 'WebPage',
                '@id': `b${String(block)}n${String(index)}`,
            })),
        }));
        const recipe = makeRecipeNode({
            mainEntityOfPage: Array.from({ length: ids }, (_, index) => ({ '@id': `x${String(index)}` })),
        });

        fieldReads.count = 0;

        expect(readPastedContent(makePage({ jsonLd: [recipe, ...pageBlocks] }))).toMatchObject({ kind: 'extracted' });
        expect(fieldReads.count).toBeLessThan(20 * (blocks * pagesPerBlock + ids));
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

/** The date a consumer reads beside the recipe (spec 003B), read through the package name. */
describe('readPastedContent evidence over a whole synthetic page', () => {
    it('keeps the datePublished the page states, with an offset written without seconds', () => {
        const page = makePage({ jsonLd: [makeRecipeNode({ datePublished: '2024-02-01T10:00+02:00' })] });

        expect(readPastedContent(page)).toMatchObject({
            kind: 'extracted',
            evidence: { datePublished: '2024-02-01T10:00+02:00' },
        });
    });
});

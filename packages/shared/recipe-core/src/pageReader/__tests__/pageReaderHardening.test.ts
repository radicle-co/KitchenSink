import { describe, expect, it } from 'vitest';

import { MAX_RECIPES_PER_PAGE } from '../pageCaps.js';
import { readPastedContent } from '../readPastedContent.js';
import { makePage, makeRecipeCard, makeRecipeNode } from '../__fixtures__/pageFixtures.js';

/**
 * Round 7: the page reader against hostile pages and against a schema that is not the whole of the card. Every case is a
 * verdict on a WHOLE page through `readPastedContent`, because a refusal that a stage returns and a caller drops is no
 * refusal.
 */

const INGREDIENTS = ['1 cup flour', '2 eggs', '1 tsp salt'];
const STEPS = ['Mix the flour and eggs.', 'Add the salt.', 'Bake until golden.'];
const NODE = makeRecipeNode({ recipeIngredient: INGREDIENTS, recipeInstructions: STEPS });

const items = (lines: readonly string[]): string => lines.map((line) => `<li>${line}</li>`).join('');

/** A page whose JSON-LD says `node` and whose card is written by hand from the two lists. */
function cardPage(
    node: Record<string, unknown>,
    shown: { readonly ingredients?: readonly string[]; readonly steps?: readonly string[]; readonly extra?: string },
): string {
    return makePage({
        jsonLd: [node],
        body: `<article><h1>Test</h1><ul>${items(shown.ingredients ?? INGREDIENTS)}</ul><ol>${items(shown.steps ?? STEPS)}</ol>${shown.extra ?? ''}</article>`,
    });
}

// The collapse's own work is counted in `collapseBracketGroups.test.ts`. Here, a line past the cap is refused for its
// length, which the reader checks before it collapses anything.
describe('a line the reader would collapse: bounded before it is read, linear when it is', () => {
    it.each([
        ['32,000 characters of nested brackets', `${'('.repeat(16_000)}salt${')'.repeat(16_000)}`],
        ['32,000 characters of nested brackets around words', `${'(a'.repeat(16_000)}${')'.repeat(16_000)} salt`],
        ['32,000 unclosed brackets', `${'['.repeat(32_000)} salt`],
    ])('refuses an ingredient line of %s as ingredientLineTooLong', (_name, line) => {
        const node = makeRecipeNode({ recipeIngredient: [line], recipeInstructions: STEPS });

        expect(readPastedContent(makePage({ jsonLd: [node], body: makeRecipeCard(node) }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'ingredientLineTooLong',
        });
    });

    it('refuses a line past the cap even when cleaning would bring it under', () => {
        // 1,050 characters of doubled groups that collapse to 750: the cap is on the line as the page writes it.
        const line = '((ab)) '.repeat(150).trim();
        const node = makeRecipeNode({ recipeIngredient: [line], recipeInstructions: STEPS });

        expect(line.length).toBeGreaterThan(1_000);
        expect(readPastedContent(makePage({ jsonLd: [node], body: makeRecipeCard(node) }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'ingredientLineTooLong',
        });
    });

    it('still reads a line at the length cap that nests 500 deep', () => {
        const line = `${'('.repeat(496)}salt${')'.repeat(496)}`;
        const node = makeRecipeNode({ recipeIngredient: [line], recipeInstructions: STEPS });

        expect(readPastedContent(makePage({ jsonLd: [node], body: makeRecipeCard(node) }))).toMatchObject({
            kind: 'extracted',
            recipe: { ingredientLines: ['(salt)'] },
        });
    });
});

describe('a value cut short inside the decode passes is never read half', () => {
    it('refuses a step written as entities that decode into more markup than the cap reads', () => {
        const step = `Boil the water. ${'&lt;b&gt;x&lt;/b&gt; '.repeat(12_000)} Then add the salt.`;
        const markup = step.replaceAll('&lt;', '<').replaceAll('&gt;', '>');
        const node = makeRecipeNode({ recipeIngredient: INGREDIENTS, recipeInstructions: [step] });
        const page = makePage({
            jsonLd: [node],
            body: `<article><ul>${items(INGREDIENTS)}</ul><ol><li>${markup}</li></ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
    });
});

describe('more recipes than the page cap is never read as the first of them', () => {
    const recipe = (index: number) => makeRecipeNode({ '@id': `r${String(index)}`, name: `Recipe ${String(index)}` });

    it('refuses a page with 65 JSON-LD recipes, the last of them different', () => {
        const same = Array.from({ length: MAX_RECIPES_PER_PAGE }, () => recipe(0));
        const page = makePage({ jsonLd: [{ '@graph': [...same, recipe(1)] }], body: makeRecipeCard(recipe(0)) });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
    });

    it('refuses a page with 65 microdata recipes', () => {
        const one = (index: number) =>
            `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">R${String(index)}</h1><ul><li itemprop="recipeIngredient">1 egg</li></ul><ol><li itemprop="recipeInstructions">Boil it.</li></ol></div>`;
        const body = Array.from({ length: MAX_RECIPES_PER_PAGE + 1 }, (_, index) => one(index)).join('');

        expect(readPastedContent(makePage({ body }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageTooComplex',
        });
    });
});

describe('G-CORR both ways: the card is the schema, no more and no less', () => {
    it('reads a page whose card is its schema', () => {
        expect(readPastedContent(cardPage(NODE, {}))).toMatchObject({ kind: 'extracted' });
    });

    it.each([
        ['one more ingredient than the schema', { ingredients: [...INGREDIENTS, '1 cup sugar'] }],
        ['one more ingredient, first', { ingredients: ['1 cup sugar', ...INGREDIENTS] }],
        ['one more step than the schema', { steps: [...STEPS, 'Serve warm.'] }],
        ['one more step, first', { steps: ['Heat the oven.', ...STEPS] }],
    ])('refuses a page whose visible card has %s', (_name, shown) => {
        expect(readPastedContent(cardPage(NODE, shown))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('refuses a schema that is only the end of a longer visible ingredient line', () => {
        const node = makeRecipeNode({ recipeIngredient: ['flour', 'eggs', 'salt'], recipeInstructions: STEPS });

        expect(
            readPastedContent(cardPage(node, { ingredients: ['2 cups flour', '2 large eggs', '1 tsp salt'] })),
        ).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('refuses a schema that is only the start of a longer visible ingredient line', () => {
        const node = makeRecipeNode({ recipeIngredient: ['1 cup flour'], recipeInstructions: STEPS });

        expect(readPastedContent(cardPage(node, { ingredients: ['1 cup flour, sifted twice'] }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('refuses steps that are only fragments of the visible method', () => {
        const node = makeRecipeNode({ recipeIngredient: INGREDIENTS, recipeInstructions: ['flour and', 'for 20'] });

        expect(
            readPastedContent(cardPage(node, { steps: ['Mix the flour and eggs well.', 'Bake for 20 minutes.'] })),
        ).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('refuses a schema that leaves a step out of a method written in one paragraph', () => {
        const page = makePage({
            jsonLd: [makeRecipeNode({ recipeIngredient: INGREDIENTS, recipeInstructions: [STEPS[0], STEPS[2]] })],
            body: `<article><ul>${items(INGREDIENTS)}</ul><p>${STEPS.join(' ')}</p></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('reads steps written as sentences of one paragraph, and a heading above each list', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><h2>Ingredients</h2><ul>${items(INGREDIENTS)}</ul><h2>Method</h2><p>${STEPS.join(' ')}</p></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });

    it('reads ingredient groups, each under its own heading, as the one flat list the schema holds', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><h3>Dough</h3><ul>${items(INGREDIENTS.slice(0, 2))}</ul><h3>Topping</h3><ul>${items(INGREDIENTS.slice(2))}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });
});

describe('G-CORR per recipe card: every list in the card is the schema’s', () => {
    // The verification review's probes: a list the schema leaves out entirely, which the per-list check could not see
    // because no schema line sat in it. The card is the smallest element holding every line and step the schema has.
    it.each([
        [
            'an ingredient group the schema leaves out',
            '<h3>Frosting</h3><ul><li>1 cup icing sugar</li><li>2 tbsp milk</li></ul>',
        ],
        ['a second method list', '<ol><li>Let it cool for an hour.</li></ol>'],
        ['a stray list', '<ul><li>Serves four</li></ul>'],
    ])('refuses a card with %s after the method', (_name, extra) => {
        expect(readPastedContent(cardPage(NODE, { extra }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('refuses an ingredient group the schema leaves out, between the ingredients and the method', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><ul>${items(INGREDIENTS)}</ul><h3>Frosting</h3><ul><li>1 cup icing sugar</li></ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('refuses a list the schema leaves out in a microdata card', () => {
        const page = makePage({
            body: [
                '<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Test</h1><ul>',
                INGREDIENTS.map((line) => `<li itemprop="recipeIngredient">${line}</li>`).join(''),
                '</ul><ul><li>1 cup icing sugar</li></ul><ol>',
                STEPS.map((step) => `<li itemprop="recipeInstructions">${step}</li>`).join(''),
                '</ol></div>',
            ].join(''),
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('reads a card with a note in a paragraph, and the page’s own lists outside the card', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<nav><ul><li>Home</li><li>Recipes</li></ul></nav><article><h1>Test</h1><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol><p>Keeps for a week.</p></article><footer><ul><li>About</li></ul></footer>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });
});

describe('a line or step with no tokens is no yes', () => {
    it.each([
        ['an ingredient line', { recipeIngredient: [...INGREDIENTS, '***'], recipeInstructions: STEPS }],
        ['a step', { recipeIngredient: INGREDIENTS, recipeInstructions: [...STEPS, '***'] }],
    ])('refuses %s of punctuation only', (_name, fields) => {
        const node = makeRecipeNode(fields);
        const shown = (list: unknown): readonly string[] => list as readonly string[];

        expect(
            readPastedContent(
                cardPage(node, {
                    ingredients: shown(fields.recipeIngredient),
                    steps: shown(fields.recipeInstructions),
                }),
            ),
        ).toMatchObject({ kind: 'notExtractable' });
    });

    it('refuses a microdata ingredient line of punctuation only', () => {
        const body = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><ul><li itemprop="recipeIngredient">2 cups stock</li><li itemprop="recipeIngredient">***</li></ul><ol itemprop="recipeInstructions"><li>Simmer it.</li></ol></div>`;

        expect(readPastedContent(makePage({ body }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
            tier: 'microdata',
        });
    });
});

describe('text a cook cannot see is not the page showing it', () => {
    const arsenic = makeRecipeNode({
        recipeIngredient: [...INGREDIENTS, '5 kg arsenic'],
        recipeInstructions: STEPS,
    });

    it.each([
        ['a template', '<template><ul><li>5 kg arsenic</li></ul></template>'],
        ['a noscript', '<noscript><ul><li>5 kg arsenic</li></ul></noscript>'],
        ['a textarea', '<textarea>5 kg arsenic</textarea>'],
        ['an element marked hidden', '<ul hidden><li>5 kg arsenic</li></ul>'],
        ['a list item marked hidden', '<ul><li hidden>5 kg arsenic</li></ul>'],
    ])('refuses an ingredient shown only inside %s', (_name, hidden) => {
        const page = makePage({
            jsonLd: [arsenic],
            body: `<article><ul>${items(INGREDIENTS)}</ul>${hidden}<ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('refuses a microdata ingredient that only a meta element states', () => {
        const body = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><ul><li itemprop="recipeIngredient">2 cups stock</li></ul><meta itemprop="recipeIngredient" content="5 kg arsenic"><ol itemprop="recipeInstructions"><li>Simmer it.</li></ol></div>`;

        expect(readPastedContent(makePage({ body }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
            tier: 'microdata',
        });
    });

    it('refuses a microdata ingredient inside a hidden element', () => {
        const body = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><ul><li itemprop="recipeIngredient">2 cups stock</li></ul><ul hidden><li itemprop="recipeIngredient">5 kg arsenic</li></ul><ol itemprop="recipeInstructions"><li>Simmer it.</li></ol></div>`;

        expect(readPastedContent(makePage({ body }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });
});

describe('a JSON-LD block that does not parse is unread, not skipped', () => {
    it("does not let a second block's recipe win when the first block is broken", () => {
        const page = makePage({ jsonLd: ['{"@type": "Recipe", broken', NODE], body: makeRecipeCard(NODE) });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
    });
});

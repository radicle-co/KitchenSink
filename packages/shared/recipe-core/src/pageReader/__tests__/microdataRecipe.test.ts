import { describe, expect, it } from 'vitest';

import { MAX_RECIPES_PER_PAGE, MAX_WALK_NODES } from '../pageCaps.js';
import { parsePage } from '../pageDocument.js';
import { microdataRecipe } from '../microdataRecipe.js';
import { makeMicrodataBody, makePage } from '../__fixtures__/pageFixtures.js';

const read = (body: string) => microdataRecipe(parsePage(makePage({ body })));

const recipeScope = (inner: string, itemtype = 'https://schema.org/Recipe') =>
    `<div itemscope itemtype="${itemtype}">${inner}</div>`;

describe('microdataRecipe', () => {
    it('reads a recipe, taking values from meta, time, link, list and plain elements', () => {
        expect(read(makeMicrodataBody())).toMatchObject({
            kind: 'candidates',
            tier: 'microdata',
            candidates: [
                {
                    links: ['https://example.com/soup'],
                    credit: { authors: [] },
                    imageRefs: [],
                    recipe: {
                        title: 'Micro Soup',
                        description: 'A warm soup.',
                        servings: 4,
                        prepTimeMinutes: 5,
                        cookTimeMinutes: 30,
                        ingredientLines: ['2 cups stock', '1 onion, diced'],
                        steps: [{ instruction: 'Simmer.' }, { instruction: 'Serve.' }],
                    },
                },
            ],
        });
    });

    it('takes a value from the attribute its element type names', () => {
        const extraction = read(
            recipeScope(
                [
                    '<span itemprop="name">Pie</span>',
                    '<data itemprop="recipeYield" value="6">six</data>',
                    '<a itemprop="url" href="https://example.com/pie">link</a>',
                    '<span itemprop="recipeIngredient">1 apple</span>',
                    '<meta itemprop="prepTime" content="PT20M">',
                ].join(''),
            ),
        );

        expect(extraction).toMatchObject({
            kind: 'candidates',
            candidates: [
                { links: ['https://example.com/pie'], recipe: { title: 'Pie', servings: 6, prepTimeMinutes: 20 } },
            ],
        });
    });

    it('reads a time element without a datetime from its text', () => {
        const extraction = read(
            recipeScope(
                '<span itemprop="name">A</span><span itemprop="recipeIngredient">1 egg</span><time itemprop="cookTime">PT7M</time>',
            ),
        );

        expect(extraction).toMatchObject({ candidates: [{ recipe: { cookTimeMinutes: 7 } }] });
    });

    it.each([
        'http://schema.org/Recipe',
        'https://schema.org/Recipe/',
        'https://schema.org/Thing https://schema.org/Recipe',
    ])('finds a Recipe by itemtype %j', (itemtype) => {
        const body = recipeScope('<h1 itemprop="name">A</h1><i itemprop="recipeIngredient">1 egg</i>', itemtype);

        expect(read(body).kind).toBe('candidates');
    });

    it('reads steps written as nested HowToStep and HowToSection items', () => {
        const body = recipeScope(
            [
                '<h1 itemprop="name">Layered</h1><i itemprop="recipeIngredient">1 egg</i>',
                '<div itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToSection">',
                '<span itemprop="name">Glaze</span>',
                '<div itemprop="itemListElement" itemscope itemtype="https://schema.org/HowToStep"><span itemprop="text">Whisk.</span></div>',
                '<div itemprop="itemListElement" itemscope itemtype="https://schema.org/HowToStep"><span itemprop="text">Pour.</span></div>',
                '</div>',
            ].join(''),
        );

        expect(read(body)).toMatchObject({
            candidates: [{ recipe: { steps: [{ instruction: 'Glaze: Whisk.' }, { instruction: 'Pour.' }] } }],
        });
    });

    it("does not take a property of a nested item for the recipe's own", () => {
        const body = recipeScope(
            '<h1 itemprop="name">Real</h1><i itemprop="recipeIngredient">1 egg</i><div itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Someone Else</span></div>',
        );

        expect(read(body)).toMatchObject({ candidates: [{ recipe: { title: 'Real' } }] });
    });

    it('reads every recipe of a page in order and counts a repeated one once (rewritten: a strategy no longer reports "several", selection does)', () => {
        const one = (name: string) =>
            recipeScope(`<h1 itemprop="name">${name}</h1><i itemprop="recipeIngredient">1 egg</i>`);

        const titles = (body: string) => {
            const extraction = read(body);

            return extraction.kind === 'candidates' ? extraction.candidates.map((candidate) => candidate.title) : [];
        };

        expect(titles(one('A') + one('B'))).toEqual(['A', 'B']);
        expect(titles(one('A') + one('A'))).toEqual(['A']);
    });

    it('reads at most the first 64 recipe items of a page', () => {
        const one = (index: number) =>
            recipeScope(`<h1 itemprop="name">R${String(index)}</h1><i itemprop="recipeIngredient">1 egg</i>`);
        const extraction = read(Array.from({ length: MAX_RECIPES_PER_PAGE + 36 }, (_, index) => one(index)).join(''));

        expect(MAX_RECIPES_PER_PAGE).toBe(64);
        expect(extraction.kind === 'candidates' ? extraction.candidates : []).toHaveLength(MAX_RECIPES_PER_PAGE);
        expect(extraction.kind === 'candidates' ? extraction.candidates[0]?.title : undefined).toBe('R0');
    });

    it('applies one itemprop with several names to each', () => {
        const body = recipeScope('<h1 itemprop="name headline">Two names</h1><i itemprop="recipeIngredient">1 egg</i>');

        expect(read(body)).toMatchObject({ candidates: [{ recipe: { title: 'Two names' } }] });
    });

    it('ignores an item that is not a recipe, and a page with no microdata', () => {
        expect(
            read('<div itemscope itemtype="https://schema.org/Person"><span itemprop="name">Ann</span></div>').kind,
        ).toBe('none');
        expect(read('<p>just text</p>').kind).toBe('none');
    });

    it('reads a property named __proto__ as data and pollutes nothing', () => {
        const body = recipeScope(
            '<h1 itemprop="name">Safe</h1><i itemprop="recipeIngredient">1 egg</i><span itemprop="__proto__">x</span><span itemprop="constructor">y</span>',
        );

        expect(read(body)).toMatchObject({ kind: 'candidates', candidates: [{ recipe: { title: 'Safe' } }] });
        expect(({} as Record<string, unknown>)['x']).toBeUndefined();
        expect(Object.keys(Object.prototype)).toEqual([]);
    });

    it('stops at the node budget', () => {
        const props = '<i itemprop="note">n</i>'.repeat(MAX_WALK_NODES + 5_000);
        const body = recipeScope(`${props}<h1 itemprop="name">Late</h1><i itemprop="recipeIngredient">1 egg</i>`);
        const started = performance.now();

        expect(read(body).kind).toBe('none');
        expect(performance.now() - started).toBeLessThan(2_000);
    });

    it('survives items nested 300 deep', () => {
        const nested = `${'<div itemscope itemprop="a" itemtype="https://schema.org/Thing">'.repeat(300)}${'</div>'.repeat(300)}`;

        expect(
            read(recipeScope(`<h1 itemprop="name">Deep</h1><i itemprop="recipeIngredient">1 egg</i>${nested}`)).kind,
        ).toBe('candidates');
    });
});

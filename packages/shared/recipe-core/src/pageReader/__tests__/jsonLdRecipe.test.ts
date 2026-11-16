import { describe, expect, it } from 'vitest';

import { MAX_JSON_LD_BLOCK_BYTES, MAX_JSON_LD_BLOCKS, MAX_WALK_NODES } from '../pageCaps.js';
import { parsePage } from '../pageDocument.js';
import { jsonLdRecipe } from '../jsonLdRecipe.js';
import { makeJsonLdScript, makePage, makeRecipeNode } from '../__fixtures__/pageFixtures.js';

const read = (...jsonLd: unknown[]) => jsonLdRecipe(parsePage(makePage({ jsonLd })));

/** The one recipe a page of one candidate read. */
function foundRecipe(...jsonLd: unknown[]) {
    const extraction = read(...jsonLd);

    if (extraction.kind !== 'candidates' || extraction.candidates.length !== 1) {
        throw new Error(`expected one candidate, got ${JSON.stringify(extraction)}`);
    }

    return extraction.candidates[0]?.recipe ?? { title: '', ingredientLines: [], steps: [] };
}

describe('jsonLdRecipe: reading a Recipe node', () => {
    it('reads every field of a complete recipe', () => {
        expect(foundRecipe(makeRecipeNode())).toEqual({
            title: 'Test Pancakes',
            description: 'Fluffy pancakes.',
            cuisine: 'American',
            servings: 4,
            prepTimeMinutes: 10,
            cookTimeMinutes: 15,
            totalTimeMinutes: 25,
            ingredientLines: ['1 cup flour', '2 eggs'],
            steps: [{ instruction: 'Mix.' }, { instruction: 'Cook.' }],
        });
    });

    it('freezes the recipe, its lists and its steps', () => {
        const recipe = foundRecipe(makeRecipeNode());

        expect(Object.isFrozen(recipe)).toBe(true);
        expect(Object.isFrozen(recipe.ingredientLines)).toBe(true);
        expect(Object.isFrozen(recipe.steps)).toBe(true);
        expect(Object.isFrozen(recipe.steps[0])).toBe(true);
    });

    it('leaves out a value the page does not state, and never makes one up', () => {
        const recipe = foundRecipe(
            makeRecipeNode({
                description: undefined,
                recipeYield: undefined,
                prepTime: undefined,
                cookTime: undefined,
                totalTime: undefined,
                recipeCuisine: undefined,
            }),
        );

        expect(Object.keys(recipe).sort()).toEqual(['ingredientLines', 'steps', 'title']);
    });

    it('reads the older `ingredients` key when there is no `recipeIngredient`', () => {
        expect(
            foundRecipe(makeRecipeNode({ recipeIngredient: undefined, ingredients: ['1 pear'] })).ingredientLines,
        ).toEqual(['1 pear']);
    });

    it('drops blank ingredient lines and collapses whitespace in the rest', () => {
        expect(
            foundRecipe(makeRecipeNode({ recipeIngredient: ['  1   cup\n flour ', '', '   '] })).ingredientLines,
        ).toEqual(['1 cup flour']);
    });

    it('removes tags and decodes entities, including text encoded twice', () => {
        const recipe = foundRecipe(
            makeRecipeNode({
                name: 'Mac &amp;amp; Cheese',
                description: 'Rich &amp; <i>creamy</i>.',
                recipeIngredient: [
                    '1 cup <b>milk</b>',
                    '&frac12; tsp salt',
                    '2 tbsp &lt;a href="x"&gt;butter&lt;/a&gt;',
                ],
            }),
        );

        expect(recipe.title).toBe('Mac & Cheese');
        expect(recipe.description).toBe('Rich & creamy.');
        expect(recipe.ingredientLines).toEqual(['1 cup milk', '½ tsp salt', '2 tbsp butter']);
    });

    it('reads the first non-blank cuisine of a list, in the one canonical spelling', () => {
        expect(foundRecipe(makeRecipeNode({ recipeCuisine: ['', '  ', 'nyonya', 'Thai'] })).cuisine).toBe('Nyonya');
    });

    it('omits a description that does not fit the description limit', () => {
        expect(foundRecipe(makeRecipeNode({ description: 'x'.repeat(5_001) })).description).toBeUndefined();
        expect(foundRecipe(makeRecipeNode({ description: 'x'.repeat(5_000) })).description).toHaveLength(5_000);
    });

    it.each([
        [4, 4],
        ['6', 6],
        [['12', '24 cookies'], 12],
        ['Makes 24 cookies', undefined],
        ['4-6', undefined],
    ])('reads recipeYield %j as servings %j', (recipeYield, servings) => {
        expect(foundRecipe(makeRecipeNode({ recipeYield })).servings).toBe(servings);
    });

    it('reads durations: PT1H30M, P1D, a stated PT0M as zero, and P1M as absent', () => {
        const recipe = foundRecipe(makeRecipeNode({ prepTime: 'PT1H30M', cookTime: 'P1D', totalTime: 'PT0M' }));

        expect([recipe.prepTimeMinutes, recipe.cookTimeMinutes, recipe.totalTimeMinutes]).toEqual([90, 1_440, 0]);
        expect(foundRecipe(makeRecipeNode({ prepTime: 'P1M' })).prepTimeMinutes).toBeUndefined();
    });

    it('reads sections into steps, with the section name in front of its first step', () => {
        const recipe = foundRecipe(
            makeRecipeNode({
                recipeInstructions: [
                    {
                        '@type': 'HowToSection',
                        name: 'Dough',
                        itemListElement: [{ '@type': 'HowToStep', text: 'Knead.' }],
                    },
                ],
            }),
        );

        expect(recipe.steps).toEqual([{ instruction: 'Dough: Knead.' }]);
    });

    it('does not take a node with a name but no ingredients and no steps for a recipe', () => {
        expect(read(makeRecipeNode({ recipeIngredient: [], recipeInstructions: [] })).kind).toBe('none');
    });

    it.each([[undefined], [''], ['   '], [{}], [null]])(
        'does not take a node whose name is %j for a recipe',
        (name) => {
            expect(read(makeRecipeNode({ name })).kind).toBe('none');
        },
    );
});

describe('jsonLdRecipe: doubled brackets in ingredient lines', () => {
    it('collapses a doubled group, leaves a plain one, and does so on every occurrence', () => {
        expect(
            foundRecipe(
                makeRecipeNode({
                    recipeIngredient: ['1 cup butter ((softened))', '2 eggs (large) (cold)', 'a ((b)) c ((d))'],
                }),
            ).ingredientLines,
        ).toEqual(['1 cup butter (softened)', '2 eggs (large) (cold)', 'a (b) c (d)']);
    });
});

describe('jsonLdRecipe: finding the node', () => {
    it('finds a Recipe inside @graph', () => {
        const graph = {
            '@context': 'https://schema.org',
            '@graph': [{ '@type': 'WebSite', name: 'Site' }, makeRecipeNode()],
        };

        expect(foundRecipe(graph).title).toBe('Test Pancakes');
    });

    it.each([
        [['Recipe', 'NewsArticle']],
        ['https://schema.org/Recipe'],
        ['schema:Recipe'],
        ['http://schema.org/Recipe'],
    ])('accepts @type %j', (type) => {
        expect(foundRecipe(makeRecipeNode({ '@type': type })).title).toBe('Test Pancakes');
    });

    it('finds a Recipe in a top-level array and one nested in another node', () => {
        expect(foundRecipe([{ '@type': 'Thing' }, makeRecipeNode()]).title).toBe('Test Pancakes');
        expect(foundRecipe({ '@type': 'WebPage', mainEntity: makeRecipeNode() }).title).toBe('Test Pancakes');
    });

    it('is not fooled by a type that only ends in Recipe', () => {
        expect(read(makeRecipeNode({ '@type': 'NotARecipe' })).kind).toBe('none');
        expect(read(makeRecipeNode({ '@type': 'Recipes' })).kind).toBe('none');
    });

    it('offers the node links for source detection', () => {
        const extraction = read(
            makeRecipeNode({
                url: 'https://example.com/pancakes',
                mainEntityOfPage: { '@id': 'https://example.com/p' },
            }),
        );

        expect(extraction).toMatchObject({
            kind: 'candidates',
            tier: 'jsonLd',
            candidates: [{ links: ['https://example.com/pancakes', 'https://example.com/p'] }],
        });
    });

    it('returns none when there is no JSON-LD, or none of it is a recipe', () => {
        expect(jsonLdRecipe(parsePage(makePage())).kind).toBe('none');
        expect(read({ '@type': 'Article', name: 'News' }).kind).toBe('none');
    });
});

/**
 * Rewritten for the 2026-11-15 ruling (a black-and-white verdict). These tests used to prove that a page of several
 * recipes read as `several`, with a pick-one choice per recipe, and that a recipe over a limit read as `unusable`. A
 * strategy now only READS every candidate: which one the page is about is `selectCandidate`'s (recipeSelection.test.ts) and
 * whether it can be sent is `acceptRecipe`'s (recipeAcceptance.test.ts), so they prove what a strategy still owns.
 */
describe('jsonLdRecipe: reading every candidate', () => {
    it('reads every recipe a page holds, in page order, with the links of each', () => {
        const a = makeRecipeNode({ name: 'A', url: 'https://e.com/a' });
        const b = makeRecipeNode({ name: 'B', recipeIngredient: ['1 pear'] });

        expect(read(a, b)).toMatchObject({
            kind: 'candidates',
            candidates: [
                { title: 'A', links: ['https://e.com/a'], recipe: { ingredientLines: ['1 cup flour', '2 eggs'] } },
                { title: 'B', links: [], recipe: { ingredientLines: ['1 pear'] } },
            ],
        });
    });

    it('reads a recipe that breaks a limit as a candidate and judges nothing: the gate refuses it', () => {
        const extraction = read(makeRecipeNode({ name: 'x'.repeat(201), recipeIngredient: ['x'.repeat(1_001)] }));

        expect(extraction).toMatchObject({ kind: 'candidates', candidates: [{ title: 'x'.repeat(201) }] });
    });

    it('counts the same recipe once: by @id, then by url, then by name', () => {
        const count = (...nodes: Record<string, unknown>[]) => {
            const extraction = read(...nodes);

            return extraction.kind === 'candidates' ? extraction.candidates.length : 0;
        };

        expect(
            count(makeRecipeNode({ '@id': '#r', name: 'A' }), makeRecipeNode({ '@id': '#r', name: 'A (copy)' })),
        ).toBe(1);
        expect(
            count(
                makeRecipeNode({ url: 'https://e.com/a', name: 'A' }),
                makeRecipeNode({ url: 'https://e.com/a', name: 'A2' }),
            ),
        ).toBe(1);
        expect(count(makeRecipeNode({ name: 'A' }), makeRecipeNode({ name: 'A' }))).toBe(1);
        expect(count(makeRecipeNode({ '@id': '#1', name: 'A' }), makeRecipeNode({ '@id': '#2', name: 'A' }))).toBe(2);
    });

    it('treats an @id of __proto__ as plain data', () => {
        const extraction = read(
            JSON.parse(
                `{"@graph":[${JSON.stringify(makeRecipeNode({ '@id': '__proto__', name: 'A' }))},${JSON.stringify(makeRecipeNode({ '@id': 'constructor', name: 'B' }))}]}`,
            ),
        );

        expect(extraction).toMatchObject({ kind: 'candidates', candidates: [{ title: 'A' }, { title: 'B' }] });
    });
});

describe('jsonLdRecipe: blocks', () => {
    it('skips a block that is not JSON and reads the next', () => {
        const page = makePage({ jsonLd: ['{"@type": "Recipe", broken', makeRecipeNode()] });

        expect(jsonLdRecipe(parsePage(page))).toMatchObject({ kind: 'candidates' });
    });

    it('only reads scripts of type application/ld+json, with any case or parameters', () => {
        const html = `<html><head>${makeJsonLdScript(makeRecipeNode({ name: 'Other' }), 'type="application/json"')}${makeJsonLdScript(
            makeRecipeNode(),
            'type=" Application/LD+JSON ; charset=utf-8"',
        )}</head></html>`;

        expect(jsonLdRecipe(parsePage(html))).toMatchObject({
            kind: 'candidates',
            candidates: [{ recipe: { title: 'Test Pancakes' } }],
        });
    });

    it('skips a block over the byte limit without parsing it', () => {
        const big = makeRecipeNode({ recipeIngredient: ['x'.repeat(MAX_JSON_LD_BLOCK_BYTES)] });

        expect(read(big).kind).toBe('none');
        expect(read(big, makeRecipeNode({ name: 'Small' }))).toMatchObject({
            kind: 'candidates',
            candidates: [{ recipe: { title: 'Small' } }],
        });
    });

    it('counts the limit in bytes, not characters', () => {
        const fits = JSON.stringify(makeRecipeNode({ name: 'é'.repeat(140_000) }));

        expect(fits.length).toBeLessThan(MAX_JSON_LD_BLOCK_BYTES);
        expect(new TextEncoder().encode(fits).length).toBeGreaterThan(MAX_JSON_LD_BLOCK_BYTES);
        expect(read(fits).kind).toBe('none');
    });

    it('reads at most 16 blocks', () => {
        const filler = Array.from({ length: MAX_JSON_LD_BLOCKS }, () => ({ '@type': 'Thing' }));

        expect(read(...filler, makeRecipeNode()).kind).toBe('none');
        expect(read(...filler.slice(1), makeRecipeNode()).kind).toBe('candidates');
    });
});

describe('jsonLdRecipe: hostile input', () => {
    /**
     * Rewritten: a block too deep to read was skipped and the page read as "no recipe". It is `tooComplex` now, because a
     * page is never judged against half of itself (`pageCaps.ts`).
     */
    it('reads a 100,000-deep array without overflowing the stack, and says the page is too complex', () => {
        const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
        const started = performance.now();

        expect(read(deep).kind).toBe('tooComplex');
        expect(performance.now() - started).toBeLessThan(2_000);
    });

    it('says tooComplex, not none, for a recipe nested deeper than the depth cap', () => {
        let nested: unknown = makeRecipeNode();

        for (let level = 0; level < 40; level += 1) {
            nested = { wrapper: nested };
        }

        expect(read(nested).kind).toBe('tooComplex');
        expect(read({ wrapper: { wrapper: makeRecipeNode() } }).kind).toBe('candidates');
    });

    /** Rewritten: a recipe past the budget read as `none`; the walk was cut short, so the page is `tooComplex`. */
    it('stops walking after the node budget and says tooComplex: a recipe past 10,000 nodes is never half-read', () => {
        // Small values, so the block stays under the byte limit and only the node budget stops the walk.
        const filler = Array.from({ length: MAX_WALK_NODES * 5 }, () => 0);

        expect(read([...filler, makeRecipeNode()]).kind).toBe('tooComplex');
        expect(read([makeRecipeNode(), ...filler]).kind).toBe('tooComplex');
        expect(read([makeRecipeNode(), ...filler.slice(0, 100)]).kind).toBe('candidates');
    });

    it('does not pollute Object.prototype from a __proto__ key, and keeps the value as data', () => {
        const hostile = `{"__proto__":{"polluted":1},"@type":"Recipe","name":"Real","recipeIngredient":["1 egg"],"recipeInstructions":"Cook."}`;

        expect(read(hostile)).toMatchObject({ kind: 'candidates', candidates: [{ recipe: { title: 'Real' } }] });
        expect(read('{"__proto__":{"polluted":1}}').kind).toBe('none');
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
        expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('takes the name from the node itself, never from a __proto__ it carries', () => {
        const hostile = `{"@type":"Recipe","name":"Own","__proto__":{"name":"Inherited"},"recipeIngredient":["1 egg"]}`;

        expect(read(hostile)).toMatchObject({ kind: 'candidates', candidates: [{ recipe: { title: 'Own' } }] });
    });
});

describe('jsonLdRecipe: cleaning what a page writes (round 5)', () => {
    const titleOf = (name: string) => foundRecipe(makeRecipeNode({ name })).title;
    const linesOf = (recipeIngredient: unknown) => foundRecipe(makeRecipeNode({ recipeIngredient })).ingredientLines;

    it.each([
        ['Best Chili Recipe', 'Best Chili'],
        ['Best Chili recipe', 'Best Chili'],
        ['BEST CHILI RECIPE', 'BEST CHILI'],
    ])('R1 drops a trailing " Recipe" from %j', (name, title) => {
        expect(titleOf(name)).toBe(title);
    });

    it.each(['Recipe', 'Chili Recipes', 'Recipe Chili', 'Chilirecipe', 'Receta de chili'])(
        'R1 leaves the title %j alone',
        (name) => {
            expect(titleOf(name)).toBe(name);
        },
    );

    it('R2 drops a heading line: it ends in a colon and states no amount', () => {
        expect(linesOf(['FILLING:', '1 cup flour', 'SHORTBREAD CRUST：', '2 eggs', 'Dodatkowo:'])).toEqual([
            '1 cup flour',
            '2 eggs',
        ]);
    });

    it('R2 keeps a line that ends in a colon but states an amount, and a vague line with no colon', () => {
        expect(linesOf(['2 cups flour:', 'Salt', 'Toppings of choice, see notes'])).toEqual([
            '2 cups flour:',
            'Salt',
            'Toppings of choice, see notes',
        ]);
    });

    it('R5 cleans a doubled-up note and trims one trailing comma from an ingredient line', () => {
        expect(linesOf(['1 cup butter (, softened (or salted butter))', '12 grams salt,', '3 eggs,,'])).toEqual([
            '1 cup butter, softened (or salted butter)',
            '12 grams salt',
            '3 eggs,',
        ]);
    });
});

describe('jsonLdRecipe: what the corroboration stage reads (round 5)', () => {
    it('keeps each step raw, with its section heading and its offered name, beside the built steps', () => {
        const extraction = read(
            makeRecipeNode({
                recipeInstructions: [
                    { '@type': 'HowToStep', name: 'Scramble the egg', text: 'Whisk the eggs.' },
                    {
                        '@type': 'HowToSection',
                        name: 'Glaze',
                        itemListElement: [{ '@type': 'HowToStep', text: 'Stir.' }],
                    },
                ],
            }),
        );

        expect(extraction).toMatchObject({
            candidates: [
                {
                    recipe: { steps: [{ instruction: 'Whisk the eggs.' }, { instruction: 'Glaze: Stir.' }] },
                    schemaSteps: [
                        { text: 'Whisk the eggs.', name: 'Scramble the egg' },
                        { text: 'Stir.', heading: 'Glaze' },
                    ],
                    emptyDeclaredSteps: false,
                },
            ],
        });
    });
});

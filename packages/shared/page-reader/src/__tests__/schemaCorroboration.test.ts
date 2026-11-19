import { describe, expect, it } from 'vitest';

import { jsonLdRecipe } from '../jsonLdRecipe.js';
import { microdataRecipe } from '../microdataRecipe.js';
import { parsePage } from '../pageDocument.js';
import type { PageCandidate } from '../pageRecipeCandidate.js';
import { corroborate, withShownStepNames } from '../schemaCorroboration.js';
import { DEFAULT_VISIBLE_CAPS, memoizedVisibleText, visibleTextOf } from '../visiblePageText.js';
import { makeMicrodataBody, makePage, makeRecipeCard, makeRecipeNode } from '../__fixtures__/pageFixtures.js';

/** The one candidate a JSON-LD page holds, and the page. */
function jsonLdCase(node: Record<string, unknown>, body?: string) {
    const page = parsePage(makePage({ jsonLd: [node], ...(body === undefined ? {} : { body }) }));
    const extraction = jsonLdRecipe(page);

    if (extraction.kind !== 'candidates') {
        throw new Error('no candidate');
    }

    return { page, candidate: extraction.candidates[0] as PageCandidate };
}

const NODE = makeRecipeNode({
    recipeIngredient: ['1 cup flour', '2 eggs (beaten)'],
    recipeInstructions: ['Mix the flour and eggs.', 'Cook it.'],
});

describe('corroborate: G-CORR, the page shows what the JSON-LD says', () => {
    it('agrees when the page shows every ingredient to the end of its line and every step', () => {
        const { page, candidate } = jsonLdCase(NODE);

        expect(corroborate(candidate, 'jsonLd', memoizedVisibleText(page))).toEqual({ ok: true });
    });

    it('agrees through case, brackets, commas, a times sign and a vulgar fraction', () => {
        const { page, candidate } = jsonLdCase(
            {
                ...NODE,
                recipeIngredient: ['1 1/2 cups Flour, sifted (fine)', 'a 9x13 pan'],
                recipeInstructions: ['Mix.'],
            },
            '<ul><li>1½ cups flour sifted fine</li><li>A 9×13 pan</li></ul><p>mix</p>',
        );

        expect(corroborate(candidate, 'jsonLd', memoizedVisibleText(page))).toEqual({ ok: true });
    });

    it.each([
        [
            'the page shows more at the end of an ingredient line',
            '<ul><li>1 cup flour, sifted</li><li>2 eggs beaten</li></ul><p>Mix the flour and eggs. Cook it.</p>',
        ],
        [
            'the amount differs',
            '<ul><li>2 cup flour</li><li>2 eggs beaten</li></ul><p>Mix the flour and eggs. Cook it.</p>',
        ],
        [
            'a step is not on the page',
            '<ul><li>1 cup flour</li><li>2 eggs beaten</li></ul><p>Mix the flour and eggs.</p>',
        ],
        ['an ingredient is not on the page', '<ul><li>1 cup flour</li></ul><p>Mix the flour and eggs. Cook it.</p>'],
        [
            'a step has a word the page lacks',
            '<ul><li>1 cup flour</li><li>2 eggs beaten</li></ul><p>Mix the flour and eggs. Cook.</p>',
        ],
    ])('refuses as pageDisagreesWithSchema when %s', (_name, body) => {
        const { page, candidate } = jsonLdCase(NODE, body);

        expect(corroborate(candidate, 'jsonLd', memoizedVisibleText(page))).toEqual({
            ok: false,
            reason: 'pageDisagreesWithSchema',
        });
    });

    // Rewritten for round 8: a section's name no longer goes into the built step, so the step is the page's text.
    it('reads a step inside a section as its own text, which the page shows', () => {
        const { page, candidate } = jsonLdCase(
            {
                ...NODE,
                recipeInstructions: [
                    {
                        '@type': 'HowToSection',
                        name: 'For the glaze',
                        itemListElement: [{ '@type': 'HowToStep', text: 'Whisk it.' }],
                    },
                ],
            },
            '<ul><li>1 cup flour</li><li>2 eggs beaten</li></ul><p>Whisk it.</p>',
        );

        expect(candidate.recipe.steps[0]?.instruction).toBe('Whisk it.');
        expect(corroborate(candidate, 'jsonLd', memoizedVisibleText(page))).toEqual({ ok: true });
    });

    it('refuses a paste with no body', () => {
        const { candidate } = jsonLdCase(NODE);
        const noBody = parsePage(
            `<html><head><script type="application/ld+json">{}</script></head><ul><li>1 cup flour</li></ul></html>`,
        );

        expect(corroborate(candidate, 'jsonLd', memoizedVisibleText(noBody))).toEqual({
            ok: false,
            reason: 'pageHasNoBody',
        });
    });

    it('answers pageTooComplex when the page is too big to check against', () => {
        const { candidate } = jsonLdCase(NODE);
        // The token cap is injected small: the production cap is reached in visiblePageText.test.ts by the same rule.
        const huge = parsePage(`<body><p>${'word '.repeat(11)}</p></body>`);
        const visible = () => visibleTextOf(huge, { ...DEFAULT_VISIBLE_CAPS, maxTokens: 10 });

        expect(corroborate(candidate, 'jsonLd', visible)).toEqual({
            ok: false,
            reason: 'pageTooComplex',
        });
    });

    /** Rewritten: microdata was never checked against the page, so a `<meta>` or a hidden element could state a line the page never showed. It is held to the visible text now. */
    it('holds a microdata recipe to the page too: a line only a meta element states is not shown', () => {
        const page = parsePage(
            makePage({
                body: `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><ul><li itemprop="recipeIngredient">1 apple</li></ul><meta itemprop="recipeIngredient" content="5 kg arsenic"><p itemprop="recipeInstructions">Bake.</p></div>`,
            }),
        );
        const extraction = microdataRecipe(page);

        if (extraction.kind !== 'candidates') {
            throw new Error('no candidate');
        }

        expect(corroborate(extraction.candidates[0] as PageCandidate, 'microdata', memoizedVisibleText(page))).toEqual({
            ok: false,
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('agrees for a microdata recipe the page shows', () => {
        const page = parsePage(makePage({ body: makeMicrodataBody() }));
        const extraction = microdataRecipe(page);

        if (extraction.kind !== 'candidates') {
            throw new Error('no candidate');
        }

        expect(corroborate(extraction.candidates[0] as PageCandidate, 'microdata', memoizedVisibleText(page))).toEqual({
            ok: true,
        });
    });

    it('refuses a line or a step with no letter or digit, even where the page shows it', () => {
        const nothing = makeRecipeNode({ recipeIngredient: ['1 cup flour', '***'], recipeInstructions: ['Mix.'] });
        const { page, candidate } = jsonLdCase(nothing);

        expect(corroborate(candidate, 'jsonLd', memoizedVisibleText(page))).toEqual({
            ok: false,
            reason: 'pageDisagreesWithSchema',
        });
    });
});

describe('corroborate: G-EMPTY, a declared recipeInstructions property holds no text', () => {
    const microdata = (inner: string) => {
        // A card a cook can read: the ingredient is a line of its own, as a site's markup writes it.
        const page = parsePage(
            makePage({
                body: `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Pie</h1><ul><li itemprop="recipeIngredient">1 apple</li></ul>${inner}</div>`,
            }),
        );
        const extraction = microdataRecipe(page);

        if (extraction.kind !== 'candidates') {
            throw new Error('no candidate');
        }

        return { page, candidate: extraction.candidates[0] as PageCandidate };
    };

    it('refuses a microdata recipe with an empty declared step as declaredStepsEmpty', () => {
        const { page, candidate } = microdata('<p itemprop="recipeInstructions"><p>Bake.</p>');

        expect(corroborate(candidate, 'microdata', memoizedVisibleText(page))).toEqual({
            ok: false,
            reason: 'declaredStepsEmpty',
        });
    });

    it('agrees when every declared step holds text', () => {
        const { page, candidate } = microdata('<p itemprop="recipeInstructions">Bake.</p>');

        expect(corroborate(candidate, 'microdata', memoizedVisibleText(page))).toEqual({ ok: true });
    });

    it('is a microdata rule: a JSON-LD candidate with the fact set is judged by the page alone', () => {
        const { page, candidate } = jsonLdCase(NODE);

        expect(corroborate({ ...candidate, emptyDeclaredSteps: true }, 'jsonLd', memoizedVisibleText(page))).toEqual({
            ok: true,
        });
    });
});

describe('withShownStepNames (R3 under D5)', () => {
    const named = (name: string, text: string) => ({ '@type': 'HowToStep', name, text });
    const NAMED = makeRecipeNode({
        recipeIngredient: ['1 cup flour'],
        recipeInstructions: [named('Scramble the egg', 'Whisk the eggs.'), named('Top', 'Remove the pan.')],
    });

    it('writes a step name in front of its text only when the page shows the name', () => {
        const { page, candidate } = jsonLdCase(NAMED, `${makeRecipeCard(NAMED)}<h3>Scramble the egg</h3>`);
        const recipe = withShownStepNames(candidate, memoizedVisibleText(page));

        expect(recipe.steps.map((step) => step.instruction)).toEqual([
            'Scramble the egg: Whisk the eggs.',
            'Remove the pan.',
        ]);
    });

    it('leaves the recipe itself when no name is shown', () => {
        const { page, candidate } = jsonLdCase(NAMED);

        expect(withShownStepNames(candidate, memoizedVisibleText(page))).toBe(candidate.recipe);
    });

    it('drops every name on a page it cannot read', () => {
        const { candidate } = jsonLdCase(NAMED);
        const noBody = parsePage('<html><head></head></html>');

        expect(withShownStepNames(candidate, memoizedVisibleText(noBody))).toBe(candidate.recipe);
    });
});

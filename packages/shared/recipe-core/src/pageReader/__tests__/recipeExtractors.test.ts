import { describe, expect, it } from 'vitest';

import { parsePage } from '../pageDocument.js';
import { extractRecipe, RECIPE_EXTRACTORS } from '../recipeExtractors.js';
import { jsonLdRecipe } from '../jsonLdRecipe.js';
import { microdataRecipe } from '../microdataRecipe.js';
import { makeMicrodataBody, makePage, makeRecipeNode } from '../__fixtures__/pageFixtures.js';

describe('recipe extractors', () => {
    it('are tried in one order: JSON-LD, then microdata', () => {
        expect(RECIPE_EXTRACTORS).toEqual([jsonLdRecipe, microdataRecipe]);
    });

    it('take the JSON-LD recipe when a page has both', () => {
        const page = parsePage(
            makePage({ jsonLd: [makeRecipeNode({ name: 'From JSON-LD' })], body: makeMicrodataBody() }),
        );

        expect(extractRecipe(page)).toMatchObject({ kind: 'found', recipe: { title: 'From JSON-LD' } });
    });

    it('fall back to microdata when the JSON-LD holds no recipe', () => {
        const page = parsePage(makePage({ jsonLd: [{ '@type': 'Article' }], body: makeMicrodataBody() }));

        expect(extractRecipe(page)).toMatchObject({ kind: 'found', recipe: { title: 'Micro Soup' } });
    });

    it('stop at the first extractor that finds a recipe, even one that cannot be used', () => {
        const page = parsePage(
            makePage({ jsonLd: [makeRecipeNode({ name: 'x'.repeat(201) })], body: makeMicrodataBody() }),
        );

        expect(extractRecipe(page)).toEqual({ kind: 'unusable', reason: 'titleTooLong' });
    });

    it('report several recipes from the first extractor that finds any', () => {
        const page = parsePage(makePage({ jsonLd: [makeRecipeNode({ name: 'A' }), makeRecipeNode({ name: 'B' })] }));

        expect(extractRecipe(page)).toMatchObject({ kind: 'several', titles: ['A', 'B'] });
    });

    it('find nothing on a page with no structured recipe', () => {
        expect(extractRecipe(parsePage(makePage()))).toEqual({ kind: 'none' });
    });
});

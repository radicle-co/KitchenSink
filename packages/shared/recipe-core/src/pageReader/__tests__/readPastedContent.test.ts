import { describe, expect, it } from 'vitest';

import { MAX_PASTE_BYTES } from '../pageCaps.js';
import { readPastedContent } from '../readPastedContent.js';
import { makeLinkHead, makeMicrodataBody, makePage, makeRecipeNode } from '../__fixtures__/pageFixtures.js';

const SOURCE = { kind: 'found', citation: { url: 'https://www.example.com/recipe/1/pancakes/', site: 'example.com' } };

describe('readPastedContent', () => {
    it('reads a JSON-LD page into a recipe and a suggested source', () => {
        const page = makePage({ jsonLd: [makeRecipeNode()], head: makeLinkHead({ canonical: SOURCE.citation.url }) });

        expect(readPastedContent(page)).toMatchObject({
            kind: 'found',
            recipe: { title: 'Test Pancakes', servings: 4, ingredientLines: ['1 cup flour', '2 eggs'] },
            source: SOURCE,
        });
    });

    it("falls back to the recipe node's own url when the page states no address", () => {
        const page = makePage({ jsonLd: [makeRecipeNode({ url: SOURCE.citation.url })] });

        expect(readPastedContent(page)).toMatchObject({ kind: 'found', source: SOURCE });
    });

    it('finds the recipe but no source when the page names no address', () => {
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode()] }))).toMatchObject({
            kind: 'found',
            source: { kind: 'none' },
        });
    });

    it('reads a microdata page', () => {
        expect(readPastedContent(makePage({ body: makeMicrodataBody() }))).toMatchObject({
            kind: 'found',
            recipe: { title: 'Micro Soup' },
            source: { kind: 'found', citation: { site: 'example.com' } },
        });
    });

    it('lists the titles when the page has several recipes, each choice with its own recipe and source', () => {
        const page = makePage({
            jsonLd: [
                makeRecipeNode({ name: 'A', url: SOURCE.citation.url }),
                makeRecipeNode({ name: 'B', recipeIngredient: ['1 pear'] }),
                makeRecipeNode({ name: 'C', recipeIngredient: ['x'.repeat(1_001)] }),
            ],
        });
        const result = readPastedContent(page);

        expect(result).toMatchObject({ kind: 'several', titles: ['A', 'B', 'C'] });
        expect(result.kind === 'several' ? result.choices : []).toMatchObject([
            { kind: 'found', recipe: { title: 'A' }, source: SOURCE },
            { kind: 'found', recipe: { title: 'B', ingredientLines: ['1 pear'] }, source: { kind: 'none' } },
            { kind: 'unusable', reason: 'ingredientLineTooLong' },
        ]);
    });

    it('keeps the detected source on a page with no recipe, so the cook can be asked about it', () => {
        expect(readPastedContent(makePage({ head: makeLinkHead({ canonical: SOURCE.citation.url }) }))).toEqual({
            kind: 'none',
            source: SOURCE,
        });
    });

    it('says a recipe that breaks a limit is unusable, and why', () => {
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode({ name: 'x'.repeat(201) })] }))).toEqual({
            kind: 'unusable',
            reason: 'titleTooLong',
        });
    });

    it('says a page nested past the depth cap is unusable when no recipe was found before the cut', () => {
        const deep = `${'<div>'.repeat(5_000)}x${'</div>'.repeat(5_000)}`;

        expect(readPastedContent(makePage({ body: deep }))).toEqual({ kind: 'unusable', reason: 'pageTooDeep' });
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode()], body: deep }))).toMatchObject({
            kind: 'found',
        });
    });

    describe('plain text with no markup', () => {
        it('has no structured recipe and no source when there is no link', () => {
            expect(readPastedContent('Pancakes\n1 cup flour\n2 eggs\nMix and cook.')).toEqual({
                kind: 'none',
                source: { kind: 'none' },
            });
        });

        it('takes the source from a line that is only a link', () => {
            expect(
                readPastedContent('Source: https://www.example.com/recipe/1/pancakes/\nPancakes\n1 cup flour'),
            ).toEqual({
                kind: 'none',
                source: SOURCE,
            });
        });

        it('does not take a link inside a sentence, a link to our own site, or one to an IP address', () => {
            expect(readPastedContent('See https://www.example.com/a for more')).toEqual({
                kind: 'none',
                source: { kind: 'none' },
            });
            expect(readPastedContent('https://commise.app/recipes/1')).toEqual({
                kind: 'none',
                source: { kind: 'none' },
            });
            expect(readPastedContent('http://10.0.0.1/recipe')).toEqual({ kind: 'none', source: { kind: 'none' } });
        });

        it('is none for an empty paste', () => {
            expect(readPastedContent('')).toEqual({ kind: 'none', source: { kind: 'none' } });
        });
    });

    describe('size', () => {
        it('refuses a paste of 2,000,001 bytes as tooLarge, and never cuts it short', () => {
            expect(readPastedContent('a'.repeat(MAX_PASTE_BYTES + 1))).toEqual({
                kind: 'tooLarge',
                maxBytes: MAX_PASTE_BYTES,
            });
        });

        it('pins the cap at 2,000,000 bytes', () => {
            expect(MAX_PASTE_BYTES).toBe(2_000_000);
        });

        it('counts bytes, not characters: 666,667 three-byte characters are too large', () => {
            const text = '€'.repeat(666_667);

            expect(text.length).toBeLessThan(MAX_PASTE_BYTES);
            expect(readPastedContent(text)).toEqual({ kind: 'tooLarge', maxBytes: MAX_PASTE_BYTES });
        });

        it('accepts a paste of exactly 2,000,000 bytes', () => {
            expect(readPastedContent('a'.repeat(MAX_PASTE_BYTES)).kind).toBe('none');
            expect(readPastedContent('€'.repeat(666_666)).kind).toBe('none');
        });

        it('checks the size before parsing anything', () => {
            const started = performance.now();

            const result = readPastedContent(`<div>${'<p>'.repeat(MAX_PASTE_BYTES)}`);

            expect(result.kind).toBe('tooLarge');
            expect(performance.now() - started).toBeLessThan(250);
        });
    });
});

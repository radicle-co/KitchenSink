import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
        expect(readPastedContent(makePage({ head: makeLinkHead({ canonical: SOURCE.citation.url }) }))).toMatchObject({
            kind: 'none',
            source: SOURCE,
        });
    });

    it('says a recipe that breaks a limit is unusable, and why', () => {
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode({ name: 'x'.repeat(201) })] }))).toMatchObject({
            kind: 'unusable',
            reason: 'titleTooLong',
        });
    });

    it('says a page nested past the depth cap is unusable when no recipe was found before the cut', () => {
        const deep = `${'<div>'.repeat(5_000)}x${'</div>'.repeat(5_000)}`;

        expect(readPastedContent(makePage({ body: deep }))).toMatchObject({ kind: 'unusable', reason: 'pageTooDeep' });
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode()], body: deep }))).toMatchObject({
            kind: 'found',
        });
    });

    describe('plain text with no markup', () => {
        it('has no structured recipe and no source when there is no link', () => {
            expect(readPastedContent('Pancakes\n1 cup flour\n2 eggs\nMix and cook.')).toMatchObject({
                kind: 'none',
                source: { kind: 'none' },
            });
        });

        it('takes the source from a line that is only a link', () => {
            expect(
                readPastedContent('Source: https://www.example.com/recipe/1/pancakes/\nPancakes\n1 cup flour'),
            ).toMatchObject({
                kind: 'none',
                source: SOURCE,
            });
        });

        it('does not take a link inside a sentence, a link to our own site, or one to an IP address', () => {
            expect(readPastedContent('See https://www.example.com/a for more')).toMatchObject({
                kind: 'none',
                source: { kind: 'none' },
            });
            expect(readPastedContent('https://commise.app/recipes/1')).toMatchObject({
                kind: 'none',
                source: { kind: 'none' },
            });
            expect(readPastedContent('http://10.0.0.1/recipe')).toMatchObject({
                kind: 'none',
                source: { kind: 'none' },
            });
        });

        it('is none for an empty paste', () => {
            expect(readPastedContent('')).toMatchObject({ kind: 'none', source: { kind: 'none' } });
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

    describe('evidence beside the recipe', () => {
        const credited = (overrides: Record<string, unknown> = {}) =>
            makeRecipeNode({
                author: [{ '@type': 'Person', name: 'Jane Cook' }],
                publisher: { '@type': 'Organization', name: 'Pie Site' },
                image: ['/img/pie.jpg'],
                ...overrides,
            });

        it('carries the credit and the image address, the image made absolute against the canonical address', () => {
            const page = makePage({ jsonLd: [credited()], head: makeLinkHead({ canonical: SOURCE.citation.url }) });
            const result = readPastedContent(page);

            expect(result).toMatchObject({
                kind: 'found',
                evidence: {
                    credit: { authors: ['Jane Cook'], publisher: 'Pie Site' },
                    imageUrl: 'https://www.example.com/img/pie.jpg',
                },
            });
        });

        it('keeps the recipe exactly the fields that become the import: no credit or image in it', () => {
            const result = readPastedContent(makePage({ jsonLd: [credited()] }));

            expect(result.kind === 'found' ? Object.keys(result.recipe).sort() : []).toEqual([
                'cookTimeMinutes',
                'cuisine',
                'description',
                'ingredientLines',
                'prepTimeMinutes',
                'servings',
                'steps',
                'title',
                'totalTimeMinutes',
            ]);
        });

        it('has an empty credit and no image when the markup states none, and never a licence', () => {
            const result = readPastedContent(makePage({ jsonLd: [makeRecipeNode()] }));

            expect(result).toMatchObject({ kind: 'found', evidence: { credit: { authors: [] } } });
            expect(result.kind === 'found' ? Object.keys(result.evidence) : []).toEqual(['credit']);
            expect(result.kind === 'found' ? Object.keys(result.evidence.credit) : []).toEqual(['authors']);
        });

        it('drops a relative image when the page names no canonical address, and keeps an absolute one', () => {
            const relative = readPastedContent(makePage({ jsonLd: [credited()] }));
            const absolute = readPastedContent(makePage({ jsonLd: [credited({ image: 'https://i.example/p.jpg' })] }));

            expect(relative.kind === 'found' ? relative.evidence.imageUrl : 'x').toBeUndefined();
            expect(absolute.kind === 'found' ? absolute.evidence.imageUrl : undefined).toBe('https://i.example/p.jpg');
        });

        it('gives each of several recipes its own evidence', () => {
            const result = readPastedContent(
                makePage({
                    jsonLd: [
                        credited({ name: 'A', author: 'Ann', image: 'https://i.example/a.jpg' }),
                        credited({ name: 'B', author: 'Bob', image: 'https://i.example/b.jpg' }),
                    ],
                }),
            );

            expect(result.kind === 'several' ? result.choices : []).toMatchObject([
                { kind: 'found', evidence: { credit: { authors: ['Ann'] }, imageUrl: 'https://i.example/a.jpg' } },
                { kind: 'found', evidence: { credit: { authors: ['Bob'] }, imageUrl: 'https://i.example/b.jpg' } },
            ]);
        });

        it('reads the credit and image from microdata', () => {
            const body = makeMicrodataBody(
                [
                    '<div itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Micro Mo</span></div>',
                    '<meta itemprop="license" content="https://creativecommons.org/licenses/by/4.0/">',
                    '<img itemprop="image" src="https://i.example/soup.jpg">',
                ].join(''),
            );

            expect(readPastedContent(makePage({ body }))).toMatchObject({
                kind: 'found',
                evidence: {
                    credit: { authors: ['Micro Mo'], license: 'https://creativecommons.org/licenses/by/4.0/' },
                    imageUrl: 'https://i.example/soup.jpg',
                },
            });
        });
    });

    describe('the paste digest', () => {
        const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

        it('is the SHA-256 hex of the UTF-8 paste, on every result but tooLarge', () => {
            const found = makePage({ jsonLd: [makeRecipeNode()] });
            const several = makePage({ jsonLd: [makeRecipeNode({ name: 'A' }), makeRecipeNode({ name: 'B' })] });
            const unusable = makePage({ jsonLd: [makeRecipeNode({ name: 'x'.repeat(201) })] });
            const pages = [found, several, unusable, makePage(), 'plain text é €', '', 'abc'];

            for (const text of pages) {
                expect(readPastedContent(text)).toMatchObject({ pasteDigest: sha256(text) });
            }

            expect(readPastedContent('abc')).toMatchObject({
                pasteDigest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
            });
        });

        it('differs when one character differs', () => {
            const a = readPastedContent('abc');
            const b = readPastedContent('abd');

            expect(a.kind !== 'tooLarge' && b.kind !== 'tooLarge' ? a.pasteDigest !== b.pasteDigest : false).toBe(true);
        });

        it('is absent from tooLarge, which never reads the paste', () => {
            expect(Object.keys(readPastedContent('a'.repeat(MAX_PASTE_BYTES + 1)))).toEqual(['kind', 'maxBytes']);
        });
    });

    describe('what counts as a page (classifyPaste is the one rule)', () => {
        it('reads text that mentions "&lt; 1 tsp" or has a bare "<" as text, not a page', () => {
            expect(readPastedContent('1 cup flour\n&lt; 1 tsp salt')).toMatchObject({
                kind: 'none',
                source: { kind: 'none' },
            });
            expect(readPastedContent('Bake < 20 minutes\nhttps://www.example.com/recipe/1/pancakes/')).toMatchObject({
                kind: 'none',
                source: SOURCE,
            });
        });

        it('reads a page only when it has the html, script or ld+json marks, in any case', () => {
            const markup = `<SCRIPT TYPE="APPLICATION/LD+JSON">${JSON.stringify(makeRecipeNode())}</SCRIPT>`;

            expect(readPastedContent(markup)).toMatchObject({ kind: 'found' });
            expect(readPastedContent(makeMicrodataBody())).toMatchObject({ kind: 'none' });
        });
    });

    describe('a broken page never reaches the console', () => {
        const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('logs nothing, so the paste cannot leak through a parse error', () => {
            const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
            const marker = 'SECRET_MARKER_4f9c';
            const broken = `{"@type": "Recipe", "name": "${marker}", broken ${marker}`;

            readPastedContent(makePage({ jsonLd: [broken, `[[[${marker}`, `{"__proto__":{"x":"${marker}"`] }));
            readPastedContent(
                `<script type="application/ld+json">${broken}</script><div itemscope itemtype="https://schema.org/Recipe">${marker}`,
            );

            for (const spy of spies) {
                expect(spy).not.toHaveBeenCalled();
            }
        });
    });
});

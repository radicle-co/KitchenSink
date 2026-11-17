import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_JSON_LD_BLOCK_BYTES, MAX_JSON_LD_BLOCKS, MAX_PASTE_BYTES, MAX_WALK_NODES } from '../pageCaps.js';
import { parsePage } from '../pageDocument.js';
import type * as PageDocumentModule from '../pageDocument.js';
import { readPastedContent } from '../readPastedContent.js';
import {
    makeLinkHead,
    makeMicrodataBody,
    makePage,
    makeRecipeCard,
    makeRecipeNode,
} from '../__fixtures__/pageFixtures.js';

// The real parser, watched, so a test can say it was never asked to read a paste.
vi.mock('../pageDocument.js', async (importOriginal) => {
    const actual = await importOriginal<typeof PageDocumentModule>();

    return { ...actual, parsePage: vi.fn(actual.parsePage) };
});

const SOURCE = { kind: 'found', citation: { url: 'https://www.example.com/recipe/1/pancakes/', site: 'example.com' } };

describe('readPastedContent', () => {
    it('reads a JSON-LD page into a recipe and a suggested source', () => {
        const page = makePage({ jsonLd: [makeRecipeNode()], head: makeLinkHead({ canonical: SOURCE.citation.url }) });

        expect(readPastedContent(page)).toMatchObject({
            kind: 'extracted',
            recipe: { title: 'Test Pancakes', servings: 4, ingredientLines: ['1 cup flour', '2 eggs'] },
            source: SOURCE,
        });
    });

    it("falls back to the recipe node's own url when the page states no address", () => {
        const page = makePage({ jsonLd: [makeRecipeNode({ url: SOURCE.citation.url })] });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted', source: SOURCE });
    });

    it('finds the recipe but no source when the page names no address', () => {
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode()] }))).toMatchObject({
            kind: 'extracted',
            source: { kind: 'none' },
        });
    });

    it('reads a microdata page', () => {
        expect(readPastedContent(makePage({ body: makeMicrodataBody() }))).toMatchObject({
            kind: 'extracted',
            recipe: { title: 'Micro Soup' },
            source: { kind: 'found', citation: { site: 'example.com' } },
        });
    });

    /**
     * Rewritten for the 2026-11-15 ruling. This proved that several recipes on a page came back as `several`, with a
     * pick-one choice each. There is no pick-one now: the page's own recipe is the one that names the page, else it is a no.
     */
    describe('several recipes on one page', () => {
        it("is severalRecipes when no recipe is the page's own, and still carries the page's source", () => {
            const page = makePage({
                jsonLd: [makeRecipeNode({ name: 'A' }), makeRecipeNode({ name: 'B', recipeIngredient: ['1 pear'] })],
                head: makeLinkHead({ canonical: SOURCE.citation.url }),
            });

            expect(readPastedContent(page)).toEqual(
                expect.objectContaining({ kind: 'notExtractable', reason: 'severalRecipes', source: SOURCE }),
            );
        });

        it('extracts the one recipe that names the page and passes over the related ones', () => {
            const page = makePage({
                jsonLd: [
                    makeRecipeNode({ name: 'Related', url: 'https://www.example.com/recipe/2/waffles/' }),
                    makeRecipeNode({ name: 'Own', url: SOURCE.citation.url }),
                ],
                head: makeLinkHead({ canonical: SOURCE.citation.url }),
            });

            expect(readPastedContent(page)).toMatchObject({
                kind: 'extracted',
                recipe: { title: 'Own' },
                source: SOURCE,
            });
        });

        it('counts every candidate before the gate: a roundup with only one recipe that would pass is still severalRecipes', () => {
            const page = makePage({
                jsonLd: [makeRecipeNode({ name: 'A' }), makeRecipeNode({ name: 'B', recipeIngredient: [] })],
            });

            expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'severalRecipes' });
        });

        it('counts a recipe written twice once', () => {
            const page = makePage({ jsonLd: [makeRecipeNode({ name: 'A' }), makeRecipeNode({ name: ' a ' })] });

            expect(readPastedContent(page)).toMatchObject({ kind: 'extracted', recipe: { title: 'A' } });
        });
    });

    it('keeps the detected source on a page with no recipe, so the cook can be asked about it', () => {
        expect(readPastedContent(makePage({ head: makeLinkHead({ canonical: SOURCE.citation.url }) }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'noRecipe',
            source: SOURCE,
        });
    });

    /** Rewritten: a recipe over a limit was `unusable`; it is now the gate's `notExtractable`, with the reason and the title. */
    it('says a recipe the gate refuses is notExtractable, why, and which recipe it was', () => {
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode({ name: 'x'.repeat(201) })] }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'titleUnusable',
            title: 'x'.repeat(201),
        });
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode({ recipeInstructions: [] })] }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'noSteps',
            title: 'Test Pancakes',
        });
    });

    it("keeps the recipe node's own source on a refused recipe", () => {
        const node = makeRecipeNode({ recipeIngredient: [], url: SOURCE.citation.url });

        expect(readPastedContent(makePage({ jsonLd: [node] }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'noIngredients',
            source: SOURCE,
        });
    });

    it('does not fall through to microdata when the JSON-LD recipe is refused: a structured candidate that fails is a no', () => {
        const stepless = makeRecipeNode({ recipeInstructions: [] });
        // Rewritten for round 5: the page now shows the JSON-LD recipe (a card), so the gate's own refusal is what is tested.
        const page = makePage({ jsonLd: [stepless], body: makeRecipeCard(stepless) + makeMicrodataBody() });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'noSteps' });
    });

    it('names the tier that read the recipe, for measurement', () => {
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode()] }))).toMatchObject({ tier: 'jsonLd' });
        expect(readPastedContent(makePage({ body: makeMicrodataBody() }))).toMatchObject({ tier: 'microdata' });
    });

    it('has no kind of result left that asks the cook to pick, review or repair', () => {
        const pages = [
            makePage({ jsonLd: [makeRecipeNode()] }),
            makePage({ jsonLd: [makeRecipeNode({ name: 'A' }), makeRecipeNode({ name: 'B' })] }),
            makePage({ jsonLd: [makeRecipeNode({ name: '' })] }),
            makePage(),
            'text',
        ];

        expect(
            pages
                .map((page) => readPastedContent(page).kind)
                .every((kind) => kind === 'extracted' || kind === 'notExtractable'),
        ).toBe(true);
    });

    /**
     * Rewritten: a page cut for depth was `unusable: pageTooDeep`; it is `notExtractable: pageTooComplex`. Rewritten again
     * for round 5: a recipe found before the cut is no longer a yes, because a page cut short cannot be checked against its
     * data (G-CORR), so it is `pageTooComplex` too, with the tier and the title.
     */
    it('says a page nested past the depth cap is pageTooComplex when no recipe was found before the cut', () => {
        const deep = `${'<div>'.repeat(5_000)}x${'</div>'.repeat(5_000)}`;

        expect(readPastedContent(makePage({ body: deep }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageTooComplex',
        });
        expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode()], body: deep }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageTooComplex',
            title: 'Test Pancakes',
            tier: 'jsonLd',
        });
    });

    /**
     * A walk cut short by the node or depth cap must refuse the read: "a recipe is never judged against half a page"
     * (`pageCaps.ts`). Each case below was an `extracted` that dropped what the cut hid (a second recipe, a late step).
     */
    describe('a walk cut short is pageTooComplex, never extracted', () => {
        const tooComplex = { kind: 'notExtractable', reason: 'pageTooComplex' };
        const filler = Array.from({ length: MAX_WALK_NODES + 5 }, () => 0);

        it('JSON-LD: a second recipe past the node budget', () => {
            const second = makeRecipeNode({ name: 'Second Pancakes' });

            expect(readPastedContent(makePage({ jsonLd: [{ '@graph': [makeRecipeNode(), second] }] }))).toMatchObject({
                reason: 'severalRecipes',
            });
            expect(
                readPastedContent(makePage({ jsonLd: [{ '@graph': [makeRecipeNode(), ...filler, second] }] })),
            ).toMatchObject(tooComplex);
        });

        it('JSON-LD: a recipe nested past the depth cap', () => {
            let nested: unknown = makeRecipeNode();

            for (let level = 0; level < 40; level += 1) {
                nested = { wrapper: nested };
            }

            expect(readPastedContent(makePage({ jsonLd: [nested], body: '<main>x</main>' }))).toMatchObject(tooComplex);
        });

        it('instructions: steps past the node budget', () => {
            const steps = ['Mix.', ...Array.from({ length: MAX_WALK_NODES + 5 }, () => 'Stir.')];
            const node = makeRecipeNode({ recipeInstructions: steps });

            expect(readPastedContent(makePage({ jsonLd: [node] }))).toMatchObject(tooComplex);
            expect(
                readPastedContent(makePage({ jsonLd: [makeRecipeNode({ recipeInstructions: steps.slice(0, 50) })] })),
            ).toMatchObject({ kind: 'extracted' });
        });

        it('microdata: a step past the node budget', () => {
            const props = '<i itemprop="note">n</i>'.repeat(MAX_WALK_NODES + 5);
            const body = (late: string) =>
                `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><i itemprop="recipeIngredient">1 onion</i><p itemprop="recipeInstructions">Simmer.</p>${late}</div>`;

            expect(
                readPastedContent(makePage({ body: body('<p itemprop="recipeInstructions">Serve.</p>') })),
            ).toMatchObject({ kind: 'extracted' });
            expect(
                readPastedContent(makePage({ body: body(`${props}<p itemprop="recipeInstructions">Serve.</p>`) })),
            ).toMatchObject(tooComplex);
        });

        it('JSON-LD: a block over the byte cap, beside another recipe', () => {
            const big = makeRecipeNode({
                name: 'Big Pancakes',
                recipeIngredient: ['x'.repeat(MAX_JSON_LD_BLOCK_BYTES)],
            });

            expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode({ name: 'Small Pancakes' })] }))).toMatchObject(
                {
                    kind: 'extracted',
                },
            );
            expect(
                readPastedContent(makePage({ jsonLd: [big, makeRecipeNode({ name: 'Small Pancakes' })] })),
            ).toMatchObject(tooComplex);
        });

        it('JSON-LD: more blocks than the block cap', () => {
            const filler = Array.from({ length: MAX_JSON_LD_BLOCKS - 1 }, () => ({ '@type': 'Thing' }));
            const first = makeRecipeNode();

            expect(readPastedContent(makePage({ jsonLd: [first, ...filler] }))).toMatchObject({ kind: 'extracted' });
            expect(
                readPastedContent(makePage({ jsonLd: [first, ...filler, makeRecipeNode({ name: 'Last Pancakes' })] })),
            ).toMatchObject(tooComplex);
        });

        it('JSON-LD: a string field whose markup runs past the node budget', () => {
            const step = (comments: number) => `Simmer.${'<!---->'.repeat(comments)} Serve.`;
            const node = (comments: number) => makeRecipeNode({ recipeInstructions: ['Mix.', step(comments)] });

            expect(readPastedContent(makePage({ jsonLd: [node(5)] }))).toMatchObject({ kind: 'extracted' });
            expect(readPastedContent(makePage({ jsonLd: [node(MAX_WALK_NODES + 5)] }))).toMatchObject(tooComplex);
        });

        it('microdata: a property whose text runs past the node budget', () => {
            // Comments are nodes the text read counts but the element walk does not, so only the text read is cut.
            const step = (comments: number) =>
                `<p itemprop="recipeInstructions">Simmer.${'<!---->'.repeat(comments)} Serve.</p>`;
            const body = (inner: string) =>
                `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><i itemprop="recipeIngredient">1 onion</i>${inner}</div>`;

            expect(readPastedContent(makePage({ body: body(step(5)) }))).toMatchObject({ kind: 'extracted' });
            expect(readPastedContent(makePage({ body: body(step(MAX_WALK_NODES + 5)) }))).toMatchObject(tooComplex);
        });

        it('microdata: an item nested past the depth cap', () => {
            const nested = `${'<div itemscope itemprop="a" itemtype="https://schema.org/Thing">'.repeat(40)}${'</div>'.repeat(40)}`;
            const body = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><i itemprop="recipeIngredient">1 onion</i><p itemprop="recipeInstructions">Simmer.</p>${nested}</div>`;

            expect(readPastedContent(makePage({ body }))).toMatchObject(tooComplex);
        });
    });

    describe('plain text with no markup', () => {
        it('has no structured recipe and no source when there is no link', () => {
            expect(readPastedContent('Pancakes\n1 cup flour\n2 eggs\nMix and cook.')).toMatchObject({
                kind: 'notExtractable',
                reason: 'notAPage',
                source: { kind: 'none' },
            });
        });

        it('takes the source from a line that is only a link', () => {
            expect(
                readPastedContent('Source: https://www.example.com/recipe/1/pancakes/\nPancakes\n1 cup flour'),
            ).toMatchObject({
                kind: 'notExtractable',
                reason: 'notAPage',
                source: SOURCE,
            });
        });

        it('does not take a link inside a sentence, a link to our own site, or one to an IP address', () => {
            expect(readPastedContent('See https://www.example.com/a for more')).toMatchObject({
                kind: 'notExtractable',
                reason: 'notAPage',
                source: { kind: 'none' },
            });
            expect(readPastedContent('https://commise.app/recipes/1')).toMatchObject({
                kind: 'notExtractable',
                reason: 'notAPage',
                source: { kind: 'none' },
            });
            expect(readPastedContent('http://10.0.0.1/recipe')).toMatchObject({
                kind: 'notExtractable',
                reason: 'notAPage',
                source: { kind: 'none' },
            });
        });

        it('is none for an empty paste', () => {
            expect(readPastedContent('')).toMatchObject({
                kind: 'notExtractable',
                reason: 'notAPage',
                source: { kind: 'none' },
            });
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
            expect(readPastedContent('a'.repeat(MAX_PASTE_BYTES)).kind).toBe('notExtractable');
            expect(readPastedContent('€'.repeat(666_666)).kind).toBe('notExtractable');
        });

        // ⛔ Counted, never timed: the parser is never asked to read a paste past the cap.
        it('checks the size before parsing anything', () => {
            vi.mocked(parsePage).mockClear();

            const result = readPastedContent(`<div>${'<p>'.repeat(MAX_PASTE_BYTES)}`);

            expect(result.kind).toBe('tooLarge');
            expect(parsePage).not.toHaveBeenCalled();
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
                kind: 'extracted',
                evidence: {
                    credit: { authors: ['Jane Cook'], publisher: 'Pie Site' },
                    imageUrl: 'https://www.example.com/img/pie.jpg',
                },
            });
        });

        // 003B: three facts beside the recipe, each tri-state (absent: the page states nothing). Facts only: the reader
        // applies no policy to them, and none of them changes whether a recipe is read.
        describe('access, date and AI opt-out facts', () => {
            const evidence = (page: string) => {
                const result = readPastedContent(page);

                if (result.kind !== 'extracted') {
                    throw new Error(`expected a recipe, got ${result.kind}`);
                }

                return result.evidence;
            };

            it.each([
                [true, true],
                ['True', true],
                ['false', false],
                [false, false],
            ])('reads isAccessibleForFree %j as %j', (value, read) => {
                expect(evidence(makePage({ jsonLd: [credited({ isAccessibleForFree: value })] }))).toMatchObject({
                    isAccessibleForFree: read,
                });
            });

            it.each([['yes'], [1], [{ value: true }]])('leaves isAccessibleForFree absent for %j', (value) => {
                expect(evidence(makePage({ jsonLd: [credited({ isAccessibleForFree: value })] }))).not.toHaveProperty(
                    'isAccessibleForFree',
                );
            });

            // Round 9 (code-reviewer HIGH 3 on #324): a paywall is often stated on the page node, not the recipe. Both facts
            // are read from the Recipe node, then from its container: the node whose mainEntity is the recipe, or a WebPage
            // or Article in the same page. Any false wins, in a list too.
            describe('read from the recipe and its container', () => {
                const recipe = (overrides: Record<string, unknown> = {}) =>
                    credited({ '@id': 'https://example.com/pie#recipe', ...overrides });

                it.each([
                    [
                        'an Article whose mainEntity is the recipe',
                        { '@type': 'NewsArticle', isAccessibleForFree: false, mainEntity: recipe() },
                    ],
                    [
                        'a WebPage in the same @graph, the text "False"',
                        { '@graph': [{ '@type': 'WebPage', isAccessibleForFree: 'False' }, recipe()] },
                    ],
                    [
                        'a node whose mainEntity names the recipe by @id',
                        {
                            '@graph': [
                                {
                                    '@type': 'Thing',
                                    isAccessibleForFree: false,
                                    mainEntity: { '@id': 'https://example.com/pie#recipe' },
                                },
                                recipe(),
                            ],
                        },
                    ],
                    [
                        'a container that says false over a recipe that says true',
                        {
                            '@graph': [
                                { '@type': 'BlogPosting', isAccessibleForFree: false },
                                recipe({ isAccessibleForFree: true }),
                            ],
                        },
                    ],
                    ['a list holding false', { '@graph': [recipe({ isAccessibleForFree: [true, false] })] }],
                    // Re-review of d700c5ed1, MEDIUM 4 and 5.
                    [
                        'the schema.org address of False',
                        { '@graph': [recipe({ isAccessibleForFree: 'https://schema.org/False' })] },
                    ],
                    ['the compact schema:False', { '@graph': [recipe({ isAccessibleForFree: 'schema:False' })] }],
                    ['a JSON-LD value object', { '@graph': [recipe({ isAccessibleForFree: { '@value': 'false' } })] }],
                    [
                        "the recipe's own mainEntityOfPage, over the recipe's true",
                        recipe({
                            isAccessibleForFree: true,
                            mainEntityOfPage: { '@type': 'WebPage', isAccessibleForFree: false },
                        }),
                    ],
                    [
                        "the recipe's isPartOf",
                        recipe({ isPartOf: { '@type': 'CreativeWork', isAccessibleForFree: false } }),
                    ],
                    [
                        "a paywalled WebPageElement in the recipe's hasPart",
                        recipe({
                            isAccessibleForFree: true,
                            hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.paywall' },
                        }),
                    ],
                    [
                        "a paywalled WebPageElement in the page node's hasPart",
                        {
                            '@graph': [
                                {
                                    '@type': 'NewsArticle',
                                    hasPart: { '@type': 'WebPageElement', isAccessibleForFree: 'False' },
                                },
                                recipe(),
                            ],
                        },
                    ],
                ])('reads isAccessibleForFree false from %s', (_name, block) => {
                    expect(evidence(makePage({ jsonLd: [block], body: makeRecipeCard(recipe()) }))).toMatchObject({
                        isAccessibleForFree: false,
                    });
                });

                it.each([
                    ['http://schema.org/True', true],
                    ['https://schema.org/False', false],
                    ['schema:True', true],
                ])('reads the schema.org form %j as %j', (value, read) => {
                    expect(
                        evidence(
                            makePage({
                                jsonLd: [recipe({ isAccessibleForFree: value })],
                                body: makeRecipeCard(recipe()),
                            }),
                        ),
                    ).toMatchObject({ isAccessibleForFree: read });
                });

                // Re-review of d700c5ed1, MEDIUM 4: a statement the reader cannot read may be a paywall, so it never lets the
                // answer be true. The answer is unknown (absent) instead.
                it.each([
                    [
                        'a container that says "no"',
                        {
                            '@graph': [
                                { '@type': 'WebPage', isAccessibleForFree: 'no' },
                                recipe({ isAccessibleForFree: true }),
                            ],
                        },
                    ],
                    [
                        'a list holding an unreadable value',
                        { '@graph': [recipe({ isAccessibleForFree: [true, 'paywalled'] })] },
                    ],
                ])('leaves isAccessibleForFree absent, not true, with %s', (_name, block) => {
                    expect(evidence(makePage({ jsonLd: [block], body: makeRecipeCard(recipe()) }))).not.toHaveProperty(
                        'isAccessibleForFree',
                    );
                });

                it('reads a microdata link to the schema.org address of False', () => {
                    const body = makeMicrodataBody(
                        '<link itemprop="isAccessibleForFree" href="https://schema.org/False">',
                    );

                    expect(evidence(makePage({ body }))).toMatchObject({ isAccessibleForFree: false });
                });

                it('reads isAccessibleForFree true when only the container says so', () => {
                    const block = { '@graph': [{ '@type': 'WebPage', isAccessibleForFree: true }, recipe()] };

                    expect(evidence(makePage({ jsonLd: [block] }))).toMatchObject({ isAccessibleForFree: true });
                });

                it('does not read a node that is neither a page nor the recipe’s container', () => {
                    const block = { '@graph': [{ '@type': 'Organization', isAccessibleForFree: false }, recipe()] };

                    expect(evidence(makePage({ jsonLd: [block] }))).not.toHaveProperty('isAccessibleForFree');
                });

                it('takes datePublished from the recipe first, then from its container', () => {
                    const page = { '@type': 'WebPage', datePublished: '2023-01-01' };

                    expect(evidence(makePage({ jsonLd: [{ '@graph': [page, recipe()] }] }))).toMatchObject({
                        datePublished: '2023-01-01',
                    });
                    expect(
                        evidence(makePage({ jsonLd: [{ '@graph': [page, recipe({ datePublished: '2024-03-01' })] }] })),
                    ).toMatchObject({ datePublished: '2024-03-01' });
                });

                it('reads isAccessibleForFree false from any microdata property on the page', () => {
                    const body = `<div itemscope itemtype="https://schema.org/WebPage"><meta itemprop="isAccessibleForFree" content="false">${makeMicrodataBody()}</div>`;

                    expect(evidence(makePage({ body }))).toMatchObject({ isAccessibleForFree: false });
                });
            });

            it.each(['2024-03-01', '2024-03-01T09:30:00+01:00', '2024-03-01T08:30:00Z'])(
                'keeps datePublished %j as written',
                (date) => {
                    expect(evidence(makePage({ jsonLd: [credited({ datePublished: date })] }))).toMatchObject({
                        datePublished: date,
                    });
                },
            );

            it.each([
                'March 1, 2024',
                '2024-13-45',
                '',
                '2024-03-01 and more',
                '2024-02-30',
                '2024-01-01T99:99',
                '2024-01-01T10:00+99:00',
                '2024-01-01T23:60',
            ])('leaves datePublished %j absent', (date) => {
                expect(evidence(makePage({ jsonLd: [credited({ datePublished: date })] }))).not.toHaveProperty(
                    'datePublished',
                );
            });

            it.each([
                ['a TDMRep reservation', '<meta name="tdm-reservation" content="1">', true],
                ['a robots noai', '<meta name="robots" content="index, follow, noai">', true],
                ['a robots noimageai', '<meta name="ROBOTS" content="noimageai">', true],
                ['a TDMRep non-reservation', '<meta name="tdm-reservation" content="0">', false],
                // Round 9 (code-reviewer MEDIUM 5 on #324).
                ['a robots noai after a semicolon', '<meta name="robots" content="index;noai">', true],
                ['an X-Robots-Tag http-equiv', '<meta http-equiv="X-Robots-Tag" content="noai, noimageai">', true],
                [
                    'an X-Robots-Tag naming an AI crawler',
                    '<meta http-equiv="X-Robots-Tag" content="GPTBot: noindex">',
                    true,
                ],
                ['a GPTBot meta', '<meta name="GPTBot" content="noindex, nofollow">', true],
                ['a CCBot meta', '<meta name="ccbot" content="none">', true],
                ['a Google-Extended meta', '<meta name="Google-Extended" content="noindex">', true],
                // Fail-safe, documented: a meta a cook cannot see still states the page's reservation.
                ['a robots noai inside noscript', '<noscript><meta name="robots" content="noai"></noscript>', true],
                // Re-review of d700c5ed1, LOW 7: every agent segment of one X-Robots-Tag value is read.
                [
                    'an X-Robots-Tag whose second agent is an AI crawler',
                    '<meta http-equiv="X-Robots-Tag" content="googlebot: noindex, gptbot: none">',
                    true,
                ],
                [
                    'an X-Robots-Tag noai after a directive with a value',
                    '<meta http-equiv="X-Robots-Tag" content="max-snippet: 50, noai">',
                    true,
                ],
                [
                    'a non-reservation beside a noai',
                    '<meta name="tdm-reservation" content="0"><meta name="robots" content="noai">',
                    true,
                ],
            ])('reads %s as aiOptOut %j', (_name, head, read) => {
                expect(evidence(makePage({ jsonLd: [credited()], head }))).toMatchObject({ aiOptOut: read });
            });

            it.each([
                ['no signal', ''],
                ['a robots meta with neither token', '<meta name="robots" content="index, follow">'],
                ['an unknown reservation value', '<meta name="tdm-reservation" content="maybe">'],
                ['a robots noindex, which is about search, not AI', '<meta name="robots" content="noindex">'],
                ['a crawler meta that allows', '<meta name="GPTBot" content="index, follow">'],
                ['a search crawler meta', '<meta name="googlebot" content="noindex">'],
                [
                    'an X-Robots-Tag noindex for a search crawler',
                    '<meta http-equiv="X-Robots-Tag" content="googlebot: noindex">',
                ],
            ])('leaves aiOptOut absent with %s', (_name, head) => {
                expect(evidence(makePage({ jsonLd: [credited()], head }))).not.toHaveProperty('aiOptOut');
            });

            it('drops a colon heading in recipeIngredient before the gate (R2), in capitals or not', () => {
                const node = makeRecipeNode({
                    recipeIngredient: ['For the sauce:', '1 cup flour', 'TOPPING 2:', '2 eggs'],
                    recipeInstructions: ['Mix the flour and eggs.', 'Bake until golden.'],
                });
                const body = `<article><h1>${String(node['name'])}</h1><h3>For the sauce:</h3><ul><li>1 cup flour</li></ul><h3>TOPPING 2:</h3><ul><li>2 eggs</li></ul><ol><li>Mix the flour and eggs.</li><li>Bake until golden.</li></ol></article>`;

                expect(readPastedContent(makePage({ jsonLd: [node], body }))).toMatchObject({
                    kind: 'extracted',
                    recipe: { ingredientLines: ['1 cup flour', '2 eggs'] },
                });
            });

            it('reads the same recipe whatever the facts say: none of them is a reason to refuse', () => {
                const plain = readPastedContent(makePage({ jsonLd: [credited()] }));
                const marked = readPastedContent(
                    makePage({
                        jsonLd: [credited({ isAccessibleForFree: false, datePublished: '2024-03-01' })],
                        head: '<meta name="tdm-reservation" content="1">',
                    }),
                );

                expect(marked.kind).toBe('extracted');
                expect(marked.kind === 'extracted' && plain.kind === 'extracted' && marked.recipe).toEqual(
                    plain.kind === 'extracted' && plain.recipe,
                );
            });
        });

        it('keeps the recipe exactly the fields that become the import: no credit or image in it', () => {
            const result = readPastedContent(makePage({ jsonLd: [credited()] }));

            expect(result.kind === 'extracted' ? Object.keys(result.recipe).sort() : []).toEqual([
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

            expect(result).toMatchObject({ kind: 'extracted', evidence: { credit: { authors: [] } } });
            expect(result.kind === 'extracted' ? Object.keys(result.evidence) : []).toEqual(['credit']);
            expect(result.kind === 'extracted' ? Object.keys(result.evidence.credit) : []).toEqual(['authors']);
        });

        it('drops a relative image when the page names no canonical address, and keeps an absolute one', () => {
            const relative = readPastedContent(makePage({ jsonLd: [credited()] }));
            const absolute = readPastedContent(makePage({ jsonLd: [credited({ image: 'https://i.example/p.jpg' })] }));

            expect(relative.kind === 'extracted' ? relative.evidence.imageUrl : 'x').toBeUndefined();
            expect(absolute.kind === 'extracted' ? absolute.evidence.imageUrl : undefined).toBe(
                'https://i.example/p.jpg',
            );
        });

        it("gives the selected recipe its own evidence, not a related recipe's", () => {
            const result = readPastedContent(
                makePage({
                    jsonLd: [
                        credited({
                            name: 'A',
                            author: 'Ann',
                            image: 'https://i.example/a.jpg',
                            url: 'https://i.example/a',
                        }),
                        credited({
                            name: 'B',
                            author: 'Bob',
                            image: 'https://i.example/b.jpg',
                            url: SOURCE.citation.url,
                        }),
                    ],
                    head: makeLinkHead({ canonical: SOURCE.citation.url }),
                }),
            );

            expect(result).toMatchObject({
                kind: 'extracted',
                recipe: { title: 'B' },
                evidence: { credit: { authors: ['Bob'] }, imageUrl: 'https://i.example/b.jpg' },
            });
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
                kind: 'extracted',
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
                kind: 'notExtractable',
                reason: 'notAPage',
                source: { kind: 'none' },
            });
            expect(readPastedContent('Bake < 20 minutes\nhttps://www.example.com/recipe/1/pancakes/')).toMatchObject({
                kind: 'notExtractable',
                reason: 'notAPage',
                source: SOURCE,
            });
        });

        it('reads a page only when it has the html, script or ld+json marks, in any case', () => {
            const node = makeRecipeNode();
            const markup = `<SCRIPT TYPE="APPLICATION/LD+JSON">${JSON.stringify(node)}</SCRIPT><body>${makeRecipeCard(node)}</body>`;

            expect(readPastedContent(markup)).toMatchObject({ kind: 'extracted' });
            expect(readPastedContent(makeMicrodataBody())).toMatchObject({
                kind: 'notExtractable',
                reason: 'notAPage',
            });
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

    describe('round 5: the page must agree with its structured data (G-CORR, G-EMPTY) and names are shown or dropped (R3)', () => {
        const NODE = makeRecipeNode({ recipeIngredient: ['1 cup flour', '2 eggs'] });

        it('says no, with the reason, the title and the tier, when the page does not show the recipe', () => {
            const page = makePage({ jsonLd: [NODE], body: '<main><h1>Another page</h1><p>1 cup flour</p></main>' });

            expect(readPastedContent(page)).toMatchObject({
                kind: 'notExtractable',
                reason: 'pageDisagreesWithSchema',
                title: 'Test Pancakes',
                tier: 'jsonLd',
            });
        });

        it('says no to a paste with no body', () => {
            const page = makePage({ jsonLd: [NODE] })
                .replace('<body>', '')
                .replace('</body>', '');

            expect(readPastedContent(page)).toMatchObject({
                kind: 'notExtractable',
                reason: 'pageHasNoBody',
                tier: 'jsonLd',
            });
        });

        it('says no to a microdata recipe with an empty declared step, and names the tier', () => {
            const page = makePage({
                body: makeMicrodataBody('<p itemprop="recipeInstructions"></p>'),
            });

            expect(readPastedContent(page)).toMatchObject({
                kind: 'notExtractable',
                reason: 'declaredStepsEmpty',
                tier: 'microdata',
            });
        });

        it('reports the tier on a recipe the gate refuses', () => {
            expect(readPastedContent(makePage({ jsonLd: [makeRecipeNode({ recipeInstructions: [] })] }))).toMatchObject(
                {
                    kind: 'notExtractable',
                    reason: 'noSteps',
                    tier: 'jsonLd',
                },
            );
        });

        it('carries no tier when no recipe was found', () => {
            expect(readPastedContent(makePage({ body: '<p>nothing</p>' }))).not.toHaveProperty('tier');
        });

        it('writes a step name in front of the step only on a page that shows the name', () => {
            const named = makeRecipeNode({
                recipeInstructions: [
                    { '@type': 'HowToStep', name: 'Scramble the egg', text: 'Whisk the eggs.' },
                    { '@type': 'HowToStep', name: 'Top', text: 'Remove the pan.' },
                ],
            });
            const card = makePage({ jsonLd: [named] });
            const shown = card.replace('</article>', '<h3>Scramble the egg</h3></article>');

            expect(readPastedContent(shown)).toMatchObject({
                recipe: {
                    steps: [{ instruction: 'Scramble the egg: Whisk the eggs.' }, { instruction: 'Remove the pan.' }],
                },
            });
            expect(readPastedContent(card)).toMatchObject({
                recipe: { steps: [{ instruction: 'Whisk the eggs.' }, { instruction: 'Remove the pan.' }] },
            });
        });
    });
});

import { describe, expect, it } from 'vitest';

import { selectCandidate } from '../recipeSelection.js';
import type { PageAddresses } from '../detectPageSource.js';
import type { PageCandidate } from '../pageRecipeCandidate.js';

const NO_ADDRESSES: PageAddresses = { canonical: undefined, ogUrl: undefined, baseHref: undefined };
const PAGE = 'https://www.example.com/recipe/1/pancakes/';

/** A candidate. Override what a test changes; the default key makes each one distinct. */
function candidateOf(title: string, overrides: Partial<PageCandidate> = {}): PageCandidate {
    return {
        title,
        key: `name:${title}`,
        recipe: {
            title,
            ingredientLines: [`1 ${title}`],
            steps: [{ instruction: `Cook the ${title}.` }],
        },
        links: [],
        credit: { authors: [] },
        imageRefs: [],
        ...overrides,
    };
}

describe('selectCandidate: which recipe a page is about, or that it cannot be said', () => {
    it('rule 2: returns the only candidate', () => {
        const only = candidateOf('A');

        expect(selectCandidate([only], NO_ADDRESSES)).toEqual({ kind: 'one', candidate: only });
    });

    it('is several for no candidates at all, which is not a page of one', () => {
        expect(selectCandidate([], NO_ADDRESSES)).toEqual({ kind: 'several' });
    });

    describe('rule 1: the same recipe written twice counts once', () => {
        it('collapses candidates with the same title, ingredients and steps, ignoring case and whitespace', () => {
            const first = candidateOf('Pancakes', { key: 'id:a' });
            const copy = candidateOf('  PANCAKES ', {
                key: 'id:b',
                recipe: {
                    title: '  PANCAKES ',
                    ingredientLines: ['1  pancakes'],
                    steps: [{ instruction: 'cook  the Pancakes.' }],
                },
            });

            expect(selectCandidate([first, copy], NO_ADDRESSES)).toEqual({ kind: 'one', candidate: first });
        });

        it('keeps two recipes that differ in one ingredient', () => {
            const a = candidateOf('Pancakes', { key: 'id:a' });
            const b = candidateOf('Pancakes', {
                key: 'id:b',
                recipe: { ...a.recipe, ingredientLines: ['2 pancakes'] },
            });

            expect(selectCandidate([a, b], NO_ADDRESSES)).toEqual({ kind: 'several' });
        });

        it('keeps two recipes that differ only in their steps', () => {
            const a = candidateOf('Pancakes', { key: 'id:a' });
            const b = candidateOf('Pancakes', {
                key: 'id:b',
                recipe: { ...a.recipe, steps: [{ instruction: 'Bake.' }] },
            });

            expect(selectCandidate([a, b], NO_ADDRESSES)).toEqual({ kind: 'several' });
        });
    });

    describe('rule 3: of several, the one that names the page address', () => {
        const addresses: PageAddresses = { canonical: PAGE, ogUrl: undefined, baseHref: undefined };

        it('picks the one candidate whose link is the canonical address', () => {
            const own = candidateOf('Own', { links: [PAGE] });
            const related = candidateOf('Related', { links: ['https://www.example.com/recipe/2/waffles/'] });

            expect(selectCandidate([related, own], addresses)).toEqual({ kind: 'one', candidate: own });
        });

        it('matches the og:url, and ignores a fragment on the candidate link', () => {
            const own = candidateOf('Own', { links: [`${PAGE}#comments`] });
            const related = candidateOf('Related', { links: [] });

            expect(selectCandidate([related, own], { canonical: undefined, ogUrl: PAGE, baseHref: undefined })).toEqual(
                {
                    kind: 'one',
                    candidate: own,
                },
            );
        });

        it('is several when no candidate names the page', () => {
            const a = candidateOf('A', { links: ['https://www.example.com/a/'] });
            const b = candidateOf('B', { links: ['https://www.example.com/b/'] });

            expect(selectCandidate([a, b], addresses)).toEqual({ kind: 'several' });
        });

        it('is several when two candidates name the page', () => {
            const a = candidateOf('A', { links: [PAGE] });
            const b = candidateOf('B', { links: [PAGE] });

            expect(selectCandidate([a, b], addresses)).toEqual({ kind: 'several' });
        });

        it('is several when the page states no address', () => {
            const a = candidateOf('A', { links: [PAGE] });
            const b = candidateOf('B', { links: [] });

            expect(selectCandidate([a, b], NO_ADDRESSES)).toEqual({ kind: 'several' });
        });

        it('reads a relative link against the base href', () => {
            const own = candidateOf('Own', { links: ['/recipe/1/pancakes/'] });
            const related = candidateOf('Related', { links: ['/recipe/2/waffles/'] });

            expect(
                selectCandidate([related, own], {
                    canonical: PAGE,
                    ogUrl: undefined,
                    baseHref: 'https://www.example.com/',
                }),
            ).toEqual({ kind: 'one', candidate: own });
        });
    });

    it('rule 4: counts candidates before any gate, so a roundup is several even when only one would pass', () => {
        const good = candidateOf('Good');
        const unusable = candidateOf('Unusable', {
            recipe: { title: 'Unusable', ingredientLines: [], steps: [] },
        });

        expect(selectCandidate([unusable, good], NO_ADDRESSES)).toEqual({ kind: 'several' });
    });
});

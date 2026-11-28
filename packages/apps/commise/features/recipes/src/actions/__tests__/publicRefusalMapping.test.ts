/**
 * `publicRefusalOf` has no ordering of its own: it asks recipe-core's `refusalOf` and maps the answer to the client's
 * reason string through `REFUSALS_OF_SOURCE`. This pins the mapping and the answers the recipe page gave before it
 * delegated, as a literal table, so a change in either fails here.
 */
import { RecipeSourceType, type RecipeSourceKindView, type RecipeStatementKindView } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { PUBLIC_REFUSALS, REFUSALS_OF_SOURCE, publicRefusalOf, type PublicRefusalFacts } from '../publicRefusal.js';

const facts = (
    sourceType: RecipeSourceType,
    sourceKind: RecipeSourceKindView | null,
    statementKind: RecipeStatementKindView | null,
    held: boolean,
): PublicRefusalFacts => ({ sourceType, sourceKind, statementKind, held });

describe('the reason of each refusal name', () => {
    it('lists exactly the reasons the recipe page shows', () => {
        expect(new Set(REFUSALS_OF_SOURCE.map((pair) => pair[1]))).toEqual(new Set(PUBLIC_REFUSALS));
    });

    it('maps each refusal name of recipe-core to a reason at most once (names are unique)', () => {
        const names = REFUSALS_OF_SOURCE.map((pair) => pair[0]);

        expect(new Set(names).size).toBe(names.length);
    });
});

describe('publicRefusalOf answers what the recipe page answered before it delegated', () => {
    const UC = RecipeSourceType.USER_CREATED;

    it.each([
        ['nothing', facts(UC, null, null, false), 'none'],
        ['a book', facts(RecipeSourceType.IMPORTED_PHYSICAL, 'book', null, false), 'policy.book'],
        ['a paid site', facts(RecipeSourceType.IMPORTED_PAID, 'paid_site', null, false), 'policy.paidSite'],
        ['a web copy', facts(RecipeSourceType.IMPORTED_PUBLIC, 'public_web', null, false), 'policy.webPage'],
        ['curator text', facts(RecipeSourceType.IMPORTED_PUBLIC, null, null, false), 'none'],
        ['from a person', facts(UC, null, 'fromPerson', false), 'fromPerson'],
        ['from a person and held', facts(UC, null, 'fromPerson', true), 'fromPerson'],
        ['an unknown statement', facts(UC, null, 'unrecognised', false), 'unrecognised'],
        ['an unknown kind', facts(UC, 'unrecognised', null, false), 'unrecognised'],
        ['held', facts(UC, null, null, true), 'sourceConflict'],
        ['a paid site and held', facts(RecipeSourceType.IMPORTED_PAID, 'paid_site', null, true), 'policy.paidSite'],
    ] as const)('%s', (_label, input, expected) => {
        expect(publicRefusalOf(input)).toBe(expected);
    });
});

/**
 * The ONE answer to "why can this recipe not be public" (board P6, plan makePublicRefusalNotice U1, KTD-1). Written
 * before `publicRefusal.ts`, from the decision table in the plan: the oracle is the table, not the implementation.
 *
 * The table is exhaustive over the source types and kinds and the statement kinds, with `held` crossed in, so a new
 * value on either enum makes the totality check fail until a row says what it means.
 */
import {
    RECIPE_SOURCE_KINDS,
    RECIPE_STATEMENT_KINDS,
    RecipeSourceType,
    UNRECOGNISED_SOURCE_KIND,
    UNRECOGNISED_STATEMENT_KIND,
    type RecipeSourceKindView,
    type RecipeStatementKindView,
} from '@kitchensink/recipe-core';

import { describe, expect, it } from 'vitest';

import { PUBLIC_REFUSALS, publicRefusalOf, type PublicRefusal, type PublicRefusalFacts } from '../publicRefusal.js';

const { USER_CREATED, IMPORTED_PUBLIC, IMPORTED_PHYSICAL, IMPORTED_PAID } = RecipeSourceType;

const facts = (over: Partial<PublicRefusalFacts>): PublicRefusalFacts => ({
    sourceType: USER_CREATED,
    sourceKind: null,
    statementKind: null,
    held: false,
    ...over,
});

describe('publicRefusalOf: the decision table', () => {
    const rows: ReadonlyArray<readonly [string, Partial<PublicRefusalFacts>, PublicRefusal]> = [
        ['from another person', { statementKind: 'fromPerson' }, 'fromPerson'],
        [
            'from another person over a web copy',
            { statementKind: 'fromPerson', sourceType: IMPORTED_PUBLIC, sourceKind: 'public_web' },
            'fromPerson',
        ],
        [
            'from another person while held (R3: its line wins)',
            { statementKind: 'fromPerson', held: true },
            'fromPerson',
        ],
        ['an unrecognised statement kind', { statementKind: UNRECOGNISED_STATEMENT_KIND }, 'unrecognised'],
        [
            'an unrecognised statement kind while held',
            { statementKind: UNRECOGNISED_STATEMENT_KIND, held: true },
            'unrecognised',
        ],
        [
            'a web page',
            { sourceType: IMPORTED_PUBLIC, sourceKind: 'public_web', statementKind: 'source' },
            'policy.webPage',
        ],
        ['a web page with no statement', { sourceType: IMPORTED_PUBLIC, sourceKind: 'public_web' }, 'policy.webPage'],
        ['a web page, held', { sourceType: IMPORTED_PUBLIC, sourceKind: 'public_web', held: true }, 'policy.webPage'],
        ['a book', { sourceType: IMPORTED_PHYSICAL, sourceKind: 'book', statementKind: 'source' }, 'policy.book'],
        ['a book with no kind', { sourceType: IMPORTED_PHYSICAL }, 'policy.book'],
        [
            'a paid site',
            { sourceType: IMPORTED_PAID, sourceKind: 'paid_site', statementKind: 'source' },
            'policy.paidSite',
        ],
        ['a paid site with no kind', { sourceType: IMPORTED_PAID }, 'policy.paidSite'],
        [
            'an unrecognised source kind',
            { sourceType: IMPORTED_PUBLIC, sourceKind: UNRECOGNISED_SOURCE_KIND },
            'unrecognised',
        ],
        [
            'an unrecognised kind on a book',
            { sourceType: IMPORTED_PHYSICAL, sourceKind: UNRECOGNISED_SOURCE_KIND },
            'unrecognised',
        ],
        ['a recorded source (held) on a recipe the slots rule governs', { held: true }, 'sourceConflict'],
        [
            'public-domain text (imported_public, no kind), held',
            { sourceType: IMPORTED_PUBLIC, held: true },
            'sourceConflict',
        ],
        ['I wrote this', { statementKind: 'authored' }, 'none'],
        ['I wrote this, held', { statementKind: 'authored', held: true }, 'sourceConflict'],
        ['a recipe the cook wrote', {}, 'none'],
        ['public-domain text (imported_public, no kind)', { sourceType: IMPORTED_PUBLIC }, 'none'],
    ];

    it.each(rows)('%s gives %s', (_name, over, expected) => {
        expect(publicRefusalOf(facts(over))).toBe(expected);
    });

    it('gives a reason from the closed list for every combination of the enums, held or not', () => {
        const kinds: ReadonlyArray<RecipeSourceKindView | null> = [
            null,
            ...RECIPE_SOURCE_KINDS,
            UNRECOGNISED_SOURCE_KIND,
        ];
        const statements: ReadonlyArray<RecipeStatementKindView | null> = [
            null,
            ...RECIPE_STATEMENT_KINDS,
            UNRECOGNISED_STATEMENT_KIND,
        ];

        for (const sourceType of Object.values(RecipeSourceType)) {
            for (const sourceKind of kinds) {
                for (const statementKind of statements) {
                    for (const held of [false, true]) {
                        expect(PUBLIC_REFUSALS).toContain(
                            publicRefusalOf({ sourceType, sourceKind, statementKind, held }),
                        );
                    }
                }
            }
        }
    });

    it('never offers Public (none) for a recipe the shared rule says is private only', () => {
        // The function composes recipe-core's `privateRuleOf`; it must not drift from it.
        expect(publicRefusalOf(facts({ sourceType: IMPORTED_PUBLIC, sourceKind: 'public_web' }))).not.toBe('none');
        expect(publicRefusalOf(facts({ sourceType: IMPORTED_PHYSICAL, sourceKind: 'book' }))).not.toBe('none');
        expect(publicRefusalOf(facts({ sourceType: IMPORTED_PAID, sourceKind: 'paid_site' }))).not.toBe('none');
    });
});

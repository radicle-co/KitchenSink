/**
 * The ONE answer to "why can this recipe not be public" (board P6, plan makePublicRefusalNotice U1, KTD-1). Written
 * before `publicRefusal.ts`, from the decision table in the plan: the oracle is the table, not the implementation.
 *
 * Two layers. The table is the oracle for what each reason means. The cross-product holds the properties over every source
 * type, source kind, statement kind and `held`: never Public for a private-only rule (judged by recipe-core's
 * `privateRuleOf`, not by this function's own branches), never Public for a held recipe, "from another person" always
 * wins, and every reason in the list is reachable. A new value on an enum is judged by those properties, not by a row
 * someone forgot to write.
 */
import {
    RECIPE_SOURCE_KINDS,
    RECIPE_STATEMENT_KINDS,
    RecipeSourceType,
    privateRuleOf,
    UNRECOGNISED_SOURCE_KIND,
    UNRECOGNISED_STATEMENT_KIND,
    type RecipeSourceKindView,
    type RecipeStatementKindView,
} from '@kitchensink/recipe-core';

import { describe, expect, it } from 'vitest';

import {
    PUBLIC_REFUSALS,
    publicRefusalOf,
    publicRefusalOfStored,
    type PublicRefusal,
    type PublicRefusalFacts,
} from '../publicRefusal.js';

const { USER_CREATED, IMPORTED_PUBLIC, IMPORTED_PHYSICAL, IMPORTED_PAID } = RecipeSourceType;

const facts = (over: Partial<PublicRefusalFacts>): PublicRefusalFacts => ({
    sourceType: USER_CREATED,
    sourceKind: null,
    statementKind: null,
    held: false,
    corrected: false,
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
        [
            'a staff correction hold (read after "from another person", as the server does)',
            { corrected: true },
            'sourceCorrected',
        ],
        [
            'a staff correction hold on a recipe the cook wrote',
            { corrected: true, statementKind: 'authored' },
            'sourceCorrected',
        ],
        ['a staff correction hold, held too', { corrected: true, held: true }, 'sourceCorrected'],
        [
            'a staff correction hold on a book: the hold names the reason',
            { corrected: true, sourceType: IMPORTED_PHYSICAL, sourceKind: 'book' },
            'sourceCorrected',
        ],
        [
            'from another person while corrected: its line wins, the server reads it first',
            { corrected: true, statementKind: 'fromPerson' },
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

    describe('over every combination of the enums, held or not', () => {
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
        const combinations: PublicRefusalFacts[] = Object.values(RecipeSourceType).flatMap((sourceType) =>
            kinds.flatMap((sourceKind) =>
                statements.flatMap((statementKind) =>
                    [false, true].flatMap((held) =>
                        [false, true].map((corrected) => ({ sourceType, sourceKind, statementKind, held, corrected })),
                    ),
                ),
            ),
        );

        it('never offers Public for a recipe the shared rule says is private only (no drift from privateRuleOf)', () => {
            const offered = combinations.filter(
                (c) => privateRuleOf(c.sourceType, c.sourceKind) === 'privateOnly' && publicRefusalOf(c) === 'none',
            );

            expect(offered).toEqual([]);
        });

        it('never offers Public for a corrected recipe', () => {
            expect(combinations.filter((c) => c.corrected && publicRefusalOf(c) === 'none')).toEqual([]);
        });

        it('never offers Public for a held recipe', () => {
            expect(combinations.filter((c) => c.held && publicRefusalOf(c) === 'none')).toEqual([]);
        });

        it('says "from another person" whenever the cook stated it, whatever else is true', () => {
            const others = combinations.filter(
                (c) => c.statementKind === 'fromPerson' && publicRefusalOf(c) !== 'fromPerson',
            );

            expect(others).toEqual([]);
        });

        it('reaches every reason in the list, so a reason no input can produce is a failure', () => {
            expect(new Set(combinations.map(publicRefusalOf))).toEqual(new Set(PUBLIC_REFUSALS));
        });
    });
});

describe('publicRefusalOfStored: a stored recipe whose kind and statement may be absent', () => {
    it('reads the wire’s sourceCorrected, absent as false', () => {
        const recipe = { sourceType: RecipeSourceType.USER_CREATED };

        expect(publicRefusalOfStored({ ...recipe, sourceCorrected: true }, false)).toBe('sourceCorrected');
        expect(publicRefusalOfStored({ ...recipe, sourceCorrected: false }, false)).toBe('none');
        expect(publicRefusalOfStored(recipe, false)).toBe('none');
    });

    it('reads an absent kind and statement as none, as the explicit nulls do', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            for (const held of [false, true]) {
                expect(publicRefusalOfStored({ sourceType }, held)).toBe(
                    publicRefusalOf({ sourceType, sourceKind: null, statementKind: null, held, corrected: false }),
                );
            }
        }
    });

    it('passes a stated kind and statement through', () => {
        expect(
            publicRefusalOfStored(
                { sourceType: RecipeSourceType.USER_CREATED, sourceKind: null, statementKind: 'fromPerson' },
                false,
            ),
        ).toBe('fromPerson');
        expect(publicRefusalOfStored({ sourceType: RecipeSourceType.IMPORTED_PHYSICAL }, false)).toBe('policy.book');
    });
});

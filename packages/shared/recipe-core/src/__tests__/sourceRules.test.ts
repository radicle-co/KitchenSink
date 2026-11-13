import { describe, expect, it } from 'vitest';

import { RECIPE_SOURCE_KINDS, RecipeSourceType, privateRuleOf } from '../recipe.types.js';
import { PRIVATE_ONLY_SOURCE_KEYS, privateOnlySourceKey, sourceIsCorrectable } from '../sourceRules.js';

/**
 * ADR-0089: ONE rule says whether a recipe's source can still be changed by the cook, read by the service policy and by
 * the editor's Source row. A literal table, so a mutant that drops a clause fails one row.
 */
describe('sourceIsCorrectable', () => {
    const AT = new Date('2026-11-01T00:00:00.000Z');
    const OPEN = { sourceType: 'user_created', sourceKind: null, firstPublishedAt: null, clonedFromId: null } as const;

    it.each([
        ['a never-published recipe with no source', OPEN, true],
        [
            'a never-published web copy the cook stated',
            { ...OPEN, sourceType: 'imported_public', sourceKind: 'public_web' },
            true,
        ],
        ['a clone with no inherited kind (the cook may state one)', { ...OPEN, clonedFromId: 'r-1' }, true],
        ['a recipe first published (a Date)', { ...OPEN, firstPublishedAt: AT }, false],
        ['a recipe first published (an ISO string)', { ...OPEN, firstPublishedAt: AT.toISOString() }, false],
        [
            'the curator’s public-domain text (imported_public, no kind)',
            { ...OPEN, sourceType: 'imported_public' },
            false,
        ],
        ['a book recipe', { ...OPEN, sourceType: 'imported_physical', sourceKind: 'book' }, false],
        ['a paid-site recipe', { ...OPEN, sourceType: 'imported_paid', sourceKind: 'paid_site' }, false],
        ['a book recipe stored with no kind', { ...OPEN, sourceType: 'imported_physical' }, false],
        [
            'a web copy INHERITED by a clone (closes the relabel-by-clone route)',
            { ...OPEN, sourceType: 'imported_public', sourceKind: 'public_web', clonedFromId: 'r-1' },
            false,
        ],
        [
            'a cook-written recipe whose kind this client does not know (fails closed)',
            { ...OPEN, sourceKind: 'unrecognised' },
            false,
        ],
        [
            'an imported recipe whose kind this client does not know (fails closed)',
            { ...OPEN, sourceType: 'imported_public', sourceKind: 'unrecognised' },
            false,
        ],
        [
            'a published web copy',
            { ...OPEN, sourceType: 'imported_public', sourceKind: 'public_web', firstPublishedAt: AT },
            false,
        ],
    ] as const)('%s', (_name, recipe, expected) => {
        expect(sourceIsCorrectable(recipe)).toBe(expected);
    });

    it('treats an absent first-publish instant (a client wire omits it) as never published', () => {
        expect(sourceIsCorrectable({ ...OPEN, firstPublishedAt: undefined })).toBe(true);
    });
});

describe('PRIVATE_ONLY_SOURCE_KEYS — the private-only rule as DATA a query binds', () => {
    // Derived from `privateRuleOf` over every (sourceType, sourceKind) pair, so the two cannot drift. A query binds these
    // as parameters; no SQL text crosses the package boundary.
    const KINDS = [...RECIPE_SOURCE_KINDS, null] as const;

    it.each(Object.values(RecipeSourceType).flatMap((type) => KINDS.map((kind) => [type, kind] as const)))(
        'key membership agrees with privateRuleOf for %s with kind %s',
        (sourceType, sourceKind) => {
            expect(PRIVATE_ONLY_SOURCE_KEYS.includes(privateOnlySourceKey(sourceType, sourceKind))).toBe(
                privateRuleOf(sourceType, sourceKind) === 'privateOnly',
            );
        },
    );

    it('spells a missing kind as the empty string, and joins the pair with a colon', () => {
        expect(privateOnlySourceKey('imported_physical', null)).toBe('imported_physical:');
        expect(privateOnlySourceKey('imported_public', 'public_web')).toBe('imported_public:public_web');
    });

    it('lists exactly the private-only pairs: the whole book and paid-site label, and the web copy', () => {
        expect([...PRIVATE_ONLY_SOURCE_KEYS].sort()).toEqual(
            [
                'imported_paid:',
                'imported_paid:book',
                'imported_paid:paid_site',
                'imported_paid:public_web',
                'imported_physical:',
                'imported_physical:book',
                'imported_physical:paid_site',
                'imported_physical:public_web',
                'imported_public:public_web',
            ].sort(),
        );
    });
});

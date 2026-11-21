import { describe, expect, it } from 'vitest';

import { RECIPE_SOURCE_KINDS, RecipeSourceType, privateRuleOf } from '../recipe.types.js';
import { PRIVATE_ONLY_SOURCE_KEYS, privateOnlySourceKey, sourceLockOf } from '../sourceRules.js';

/**
 * ADR-0089, ADR-0093 section 8: ONE rule says whether a recipe's source can still be changed by the cook, read by the
 * service policy and by the editor's Source row. A literal table, so a mutant that drops a clause fails one row.
 *
 * Rewritten for the owner ruling of 2026-11-15: the cook's statement stays editable after the first publish, so the rows
 * that said "first published is locked" now prove the recipe is correctable. The locks that are not about the first
 * publish (the curator's text, a paid site, a clone's inherited kind, an unknown kind) keep their rows.
 */
describe('sourceLockOf, before the answer is confirmed', () => {
    const AT = new Date('2026-11-01T00:00:00.000Z');
    const OPEN = {
        sourceType: 'user_created',
        sourceKind: null,
        statementKind: null,
        firstPublishedAt: null,
        clonedFromId: null,
        sourceConfirmed: false,
    } as const;

    it.each([
        ['a never-published recipe with no source', OPEN, 'open'],
        [
            'a never-published web copy the cook stated',
            { ...OPEN, sourceType: 'imported_public', sourceKind: 'public_web' },
            'open',
        ],
        ['a clone with no inherited kind (the cook may state one)', { ...OPEN, clonedFromId: 'r-1' }, 'open'],
        ['a recipe first published (a Date) stays correctable', { ...OPEN, firstPublishedAt: AT }, 'open'],
        [
            'a recipe first published (an ISO string) stays correctable',
            { ...OPEN, firstPublishedAt: AT.toISOString() },
            'open',
        ],
        [
            'the curator’s public-domain text (imported_public, no kind)',
            { ...OPEN, sourceType: 'imported_public' },
            'locked',
        ],
        [
            'a never-published book the cook stated in the editor',
            { ...OPEN, sourceType: 'imported_physical', sourceKind: 'book' },
            'open',
        ],
        [
            'a published book stays correctable: the statement is the cook\u2019s, the evidence stays',
            { ...OPEN, sourceType: 'imported_physical', sourceKind: 'book', firstPublishedAt: AT },
            'open',
        ],
        [
            'a book INHERITED by a clone',
            { ...OPEN, sourceType: 'imported_physical', sourceKind: 'book', clonedFromId: 'r-1' },
            'locked',
        ],
        ['a paid-site recipe', { ...OPEN, sourceType: 'imported_paid', sourceKind: 'paid_site' }, 'locked'],
        ['a book recipe stored with no kind', { ...OPEN, sourceType: 'imported_physical' }, 'locked'],
        [
            'a web copy INHERITED by a clone (closes the relabel-by-clone route)',
            { ...OPEN, sourceType: 'imported_public', sourceKind: 'public_web', clonedFromId: 'r-1' },
            'locked',
        ],
        [
            'a cook-written recipe whose kind this client does not know (fails closed)',
            { ...OPEN, sourceKind: 'unrecognised' },
            'locked',
        ],
        [
            'an imported recipe whose kind this client does not know (fails closed)',
            { ...OPEN, sourceType: 'imported_public', sourceKind: 'unrecognised' },
            'locked',
        ],
        [
            'a published web copy stays correctable',
            { ...OPEN, sourceType: 'imported_public', sourceKind: 'public_web', firstPublishedAt: AT },
            'open',
        ],
        [
            'a published paid-site recipe stays locked: not a statement the cook made',
            { ...OPEN, sourceType: 'imported_paid', sourceKind: 'paid_site', firstPublishedAt: AT },
            'locked',
        ],
        [
            'a published web copy INHERITED by a clone stays locked',
            {
                ...OPEN,
                sourceType: 'imported_public',
                sourceKind: 'public_web',
                firstPublishedAt: AT,
                clonedFromId: 'r-1',
            },
            'locked',
        ],
        // P7 (fromPersonLock): a stored "From another person" is the one answer the cook cannot change or clear.
        [
            'a never-published recipe whose statement is "From another person"',
            { ...OPEN, statementKind: 'fromPerson' },
            'locked',
        ],
        [
            'a published recipe whose statement is "From another person"',
            { ...OPEN, statementKind: 'fromPerson', firstPublishedAt: AT },
            'locked',
        ],
        [
            'a clone holding "From another person"',
            { ...OPEN, statementKind: 'fromPerson', clonedFromId: 'r-1' },
            'locked',
        ],
        [
            'a statement kind this client does not know (fails closed)',
            { ...OPEN, statementKind: 'unrecognised' },
            'locked',
        ],
        ['an authored statement stays correctable', { ...OPEN, statementKind: 'authored' }, 'open'],
        [
            'a source statement over a web copy stays correctable',
            { ...OPEN, sourceType: 'imported_public', sourceKind: 'public_web', statementKind: 'source' },
            'open',
        ],
        [
            'a source statement over a book stays correctable',
            { ...OPEN, sourceType: 'imported_physical', sourceKind: 'book', statementKind: 'source' },
            'open',
        ],
    ] as const)('%s', (_name, recipe, expected) => {
        expect(sourceLockOf(recipe)).toBe(expected);
    });

    it('does not read the first-publish instant at all: a wire that carries one and one that omits it answer alike', () => {
        const onTheWire = { ...OPEN, firstPublishedAt: AT };

        expect(sourceLockOf(onTheWire)).toBe(sourceLockOf(OPEN));
    });
});

/**
 * ADR-0099, plan everyAnswerSourceLock KTD-1: once an answer is confirmed (first publish, Make public with a statement, a staff
 * correction) the cook can no longer change it, except an own answer, which can only be downgraded to a book or a paid site.
 * A literal table, so a mutant that drops a clause fails one row.
 */
describe('sourceLockOf, once the answer is confirmed', () => {
    const CONFIRMED = {
        sourceType: 'user_created',
        sourceKind: null,
        statementKind: null,
        firstPublishedAt: null,
        clonedFromId: null,
        sourceConfirmed: true,
    } as const;

    it.each([
        ['confirmed with no answer stays open (KD1, AE20)', CONFIRMED, 'open'],
        [
            'a confirmed clone with no inherited kind and no answer stays open',
            { ...CONFIRMED, clonedFromId: 'r-1' },
            'open',
        ],
        ['a confirmed own answer can only be downgraded', { ...CONFIRMED, statementKind: 'authored' }, 'downgradeOnly'],
        [
            'a confirmed own answer on a clone (nothing inherited) can only be downgraded',
            { ...CONFIRMED, statementKind: 'authored', clonedFromId: 'r-1' },
            'downgradeOnly',
        ],
        [
            'a confirmed web copy is locked',
            { ...CONFIRMED, sourceType: 'imported_public', sourceKind: 'public_web', statementKind: 'source' },
            'locked',
        ],
        [
            'a confirmed web copy with no statement (an import) is locked',
            { ...CONFIRMED, sourceType: 'imported_public', sourceKind: 'public_web' },
            'locked',
        ],
        [
            'a confirmed book is locked',
            { ...CONFIRMED, sourceType: 'imported_physical', sourceKind: 'book', statementKind: 'source' },
            'locked',
        ],
        [
            'a confirmed paid site is locked',
            { ...CONFIRMED, sourceType: 'imported_paid', sourceKind: 'paid_site', statementKind: 'source' },
            'locked',
        ],
        ['a confirmed "From another person" is locked', { ...CONFIRMED, statementKind: 'fromPerson' }, 'locked'],
        ['a confirmed curator text is locked', { ...CONFIRMED, sourceType: 'imported_public' }, 'locked'],
        ['a confirmed unknown kind is locked', { ...CONFIRMED, sourceKind: 'unrecognised' }, 'locked'],
        ['a confirmed unknown statement is locked', { ...CONFIRMED, statementKind: 'unrecognised' }, 'locked'],
        [
            'a confirmed inherited web copy is locked',
            { ...CONFIRMED, sourceType: 'imported_public', sourceKind: 'public_web', clonedFromId: 'r-1' },
            'locked',
        ],
    ] as const)('%s', (_name, recipe, expected) => {
        expect(sourceLockOf(recipe)).toBe(expected);
    });

    it.each([
        ['an unconfirmed recipe cleared after "From another person" (the P7 R2 state)', false],
        ['a confirmed recipe cleared after "From another person" (the P7 R2 state)', true],
    ] as const)('%s is locked: a past attestation with no stored statement', (_name, sourceConfirmed) => {
        expect(sourceLockOf({ ...CONFIRMED, sourceConfirmed, attestedFromPerson: true })).toBe('locked');
    });

    it('a confirmed own answer set by staff over a past "From another person" attestation can only be downgraded', () => {
        expect(sourceLockOf({ ...CONFIRMED, statementKind: 'authored', attestedFromPerson: true })).toBe(
            'downgradeOnly',
        );
    });

    it('is not unlocked by a first-publish instant, and not locked by it either: only `sourceConfirmed` decides', () => {
        const published = {
            ...CONFIRMED,
            statementKind: 'authored',
            firstPublishedAt: '2026-11-01T00:00:00.000Z',
        } as const;

        expect(sourceLockOf(published)).toBe('downgradeOnly');
        expect(sourceLockOf({ ...published, sourceConfirmed: false })).toBe('open');
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

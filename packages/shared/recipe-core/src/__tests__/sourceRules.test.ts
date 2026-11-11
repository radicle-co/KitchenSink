import { describe, expect, it } from 'vitest';

import { PRIVATE_ONLY_SQL, sourceIsCorrectable } from '../sourceRules.js';

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

describe('PRIVATE_ONLY_SQL — the SQL twin of the private-only rule', () => {
    // Derived from `privateRuleOf` over every (sourceType, sourceKind) pair, so the two cannot drift; a real database
    // evaluates it against every pair in `recipeSourceKind.e2e.test.ts`.
    it('names exactly the private-only labels, NULL-safe', () => {
        expect(PRIVATE_ONLY_SQL).toBe(
            "COALESCE((source_type = 'imported_public' AND source_kind IN ('public_web')) OR source_type = 'imported_physical' OR source_type = 'imported_paid', false)",
        );
    });
});

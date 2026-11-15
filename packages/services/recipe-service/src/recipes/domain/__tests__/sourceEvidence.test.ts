import { describe, expect, it } from 'vitest';
import { RecipeSourceType } from '@kitchensink/recipe-core';

import { resolveStatementProvenance } from '../provenancePolicy.js';
import { evidenceRowOf, sourceConflictOfEvidence } from '../sourceEvidence.js';

const WEB = resolveStatementProvenance({ kind: 'public_web', citation: 'https://www.allrecipes.com/recipe/1/soup/' });
const BOOK = resolveStatementProvenance({ kind: 'book', citation: 'Joy of Cooking' });
const PAID = resolveStatementProvenance({ kind: 'paid_site', citation: 'Cook’s Illustrated' });
const OWN = resolveStatementProvenance({ kind: 'authored' });

function defined<T>(value: T | undefined): T {
    if (value === undefined) {
        throw new Error('fixture did not resolve');
    }

    return value;
}

describe('evidenceRowOf — the row a statement leaves behind', () => {
    it.each([
        ['a fragment', 'https://www.allrecipes.com/recipe/1/soup/#comments', 'https://www.allrecipes.com/recipe/1/soup/'],
        ['a bare #', 'https://www.allrecipes.com/recipe/1/soup/#', 'https://www.allrecipes.com/recipe/1/soup/'],
        [
            'a fragment holding a ?',
            'https://www.allrecipes.com/recipe/1/soup/?a=1#x?y=2',
            'https://www.allrecipes.com/recipe/1/soup/?a=1',
        ],
    ])('keys a web source by its page, never by %s', (_label, address, key) => {
        const provenance = { ...defined(WEB), sourceUrl: address };

        const row = evidenceRowOf(provenance, 'editorLink');

        expect(row).toMatchObject({ sourceKey: key });
        // The stored address is what the cook stated; only the KEY drops the fragment.
        expect(row).toMatchObject({ sourceUrl: address });
    });

    it('records a web statement with its address, key, site and kind', () => {
        expect(evidenceRowOf(defined(WEB), 'editorLink')).toEqual({
            capture: 'editorLink',
            sourceUrl: 'https://www.allrecipes.com/recipe/1/soup/',
            sourceKey: 'https://www.allrecipes.com/recipe/1/soup/',
            sourceDomain: 'allrecipes.com',
            sourceKind: 'public_web',
        });
    });

    it('records a book by citation, with no address and no domain', () => {
        expect(evidenceRowOf(defined(BOOK), 'importFile')).toEqual({
            capture: 'importFile',
            sourceKind: 'book',
            citation: 'Joy of Cooking',
        });
    });

    it('records a paid site by citation alone', () => {
        expect(evidenceRowOf(defined(PAID), 'importFile')).toMatchObject({
            sourceKind: 'paid_site',
            citation: 'Cook’s Illustrated',
        });
    });

    it('records nothing for a recipe the cook says is their own, or for the curator’s text', () => {
        expect(evidenceRowOf(defined(OWN), 'editorLink')).toBeUndefined();
        expect(
            evidenceRowOf(
                {
                    sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                    sourceUrl: 'https://gutenberg.org/x',
                    sourceAttribution: 'PG',
                    sourceKind: null,
                },
                'editorLink',
            ),
        ).toBeUndefined();
    });

    it('refuses a web provenance with no address: a defect in the caller, never a silent gap in the evidence', () => {
        expect(() => evidenceRowOf({ ...defined(WEB), sourceUrl: null }, 'editorLink')).toThrow(/address/u);
    });
});

describe('sourceConflictOfEvidence — the one call of the recipe-core predicate', () => {
    const OWN_RECIPE = { sourceType: RecipeSourceType.USER_CREATED, sourceKind: null } as const;

    it('holds a cook-written recipe whose web source was cleared', () => {
        expect(
            sourceConflictOfEvidence([{ sourceDomain: 'allrecipes.com', sourceKind: 'public_web' }], OWN_RECIPE),
        ).toBe(true);
    });

    it('does not hold a recipe with no evidence', () => {
        expect(sourceConflictOfEvidence([], OWN_RECIPE)).toBe(false);
    });

    it('passes no verified site claim: a domain is never exempt today', () => {
        expect(sourceConflictOfEvidence([{ sourceDomain: 'mysite.com', sourceKind: null }], OWN_RECIPE)).toBe(true);
    });
});

import { describe, expect, it } from 'vitest';

import { RECIPE_SOURCE_KINDS, RecipeSourceType, privateRuleOf } from '../recipe.types.js';
import { sourceConflictOf, type SourceEvidenceFacts } from '../sourceConflict.js';

/**
 * The ONE seam of the evidence rule: a recipe that ever had a third-party source stated may not be Public. The truth table is
 * literal, so a mutant that drops a clause (the claim exemption, the book and paid-site arm, the private-only short circuit)
 * fails at least one row.
 */
const WEB: SourceEvidenceFacts = { sourceDomain: 'allrecipes.com', sourceKind: 'public_web' };
const PASTED_PAGE: SourceEvidenceFacts = { sourceDomain: 'allrecipes.com', sourceKind: null };
const BOOK: SourceEvidenceFacts = { sourceDomain: null, sourceKind: 'book' };
const PAID_CITATION_ONLY: SourceEvidenceFacts = { sourceDomain: null, sourceKind: 'paid_site' };
const NO_FACTS: SourceEvidenceFacts = { sourceDomain: null, sourceKind: null };

const COOK_WRITTEN = { sourceType: RecipeSourceType.USER_CREATED, sourceKind: null } as const;
const CURATOR_TEXT = { sourceType: RecipeSourceType.IMPORTED_PUBLIC, sourceKind: null } as const;
const WEB_COPY = { sourceType: RecipeSourceType.IMPORTED_PUBLIC, sourceKind: 'public_web' } as const;
const BOOK_RECIPE = { sourceType: RecipeSourceType.IMPORTED_PHYSICAL, sourceKind: 'book' } as const;

describe('sourceConflictOf', () => {
    it.each([
        ['a cook-written recipe, no evidence', COOK_WRITTEN, [], false],
        ['a cook-written recipe whose web source was cleared', COOK_WRITTEN, [WEB], true],
        ['a cook-written recipe, a pasted page that named a site', COOK_WRITTEN, [PASTED_PAGE], true],
        ['a cook-written recipe, a book once stated', COOK_WRITTEN, [BOOK], true],
        ['a cook-written recipe, a paid site stated by citation only', COOK_WRITTEN, [PAID_CITATION_ONLY], true],
        ['a cook-written recipe, evidence that names nothing third-party', COOK_WRITTEN, [NO_FACTS], false],
        ['a cook-written recipe, one harmless row and one web row', COOK_WRITTEN, [NO_FACTS, WEB], true],
        ["the curator's public-domain text, no evidence", CURATOR_TEXT, [], false],
        ['the curator text that also carries web evidence', CURATOR_TEXT, [WEB], true],
        ['a web copy (private-only already; the rule is not asked)', WEB_COPY, [WEB], false],
        ['a book recipe (private-only already)', BOOK_RECIPE, [BOOK], false],
    ] as const)('%s', (_name, recipe, evidence, expected) => {
        expect(sourceConflictOf({ evidence, ...recipe, verifiedSiteClaims: [] })).toBe(expected);
    });

    it('lifts the hold for a site the cook proved they own, but never for a book or paid site', () => {
        const claims = ['allrecipes.com'];

        expect(sourceConflictOf({ evidence: [WEB], ...COOK_WRITTEN, verifiedSiteClaims: claims })).toBe(false);
        expect(sourceConflictOf({ evidence: [WEB, BOOK], ...COOK_WRITTEN, verifiedSiteClaims: claims })).toBe(true);
        expect(sourceConflictOf({ evidence: [WEB], ...COOK_WRITTEN, verifiedSiteClaims: ['other.com'] })).toBe(true);
    });

    it('never holds a recipe that is already private-only, over the whole label cross product', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            for (const sourceKind of [...RECIPE_SOURCE_KINDS, null]) {
                const expected = privateRuleOf(sourceType, sourceKind) !== 'privateOnly';

                expect(
                    sourceConflictOf({ evidence: [WEB, BOOK], sourceType, sourceKind, verifiedSiteClaims: [] }),
                ).toBe(expected);
            }
        }
    });
});

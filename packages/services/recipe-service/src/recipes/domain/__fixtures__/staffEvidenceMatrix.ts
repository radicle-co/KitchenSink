/**
 * The AE7 case matrix of ADR-0106: what the write-side evidence rule answers for a recipe whose evidence includes rows a staff
 * correction appended. ONE list, read by the unit test (`sourceEvidence.test.ts`, through `sourceConflictOfEvidence`) and written
 * to a real database by the LOCAL e2e (`holdClear.e2e.test.ts`), so the two cannot disagree about what a row means.
 *
 * Every `conflict` value is written by hand from the rule: a staff finding is not a cook's claim and never holds a recipe out of
 * Public, a cook's own third-party evidence still does, and a book label keeps the recipe private through its label.
 */
import { RecipeSourceType, type RecipeSourceKindView } from '@kitchensink/recipe-core';

import type { EvidenceFacts } from '../sourceEvidence.js';

export interface StaffEvidenceCase {
    readonly name: string;
    readonly recipe: { readonly sourceType: RecipeSourceType; readonly sourceKind: RecipeSourceKindView | null };
    readonly evidence: readonly EvidenceFacts[];
    /** Whether `sourceConflictOfEvidence` answers true (Public refused for the evidence). */
    readonly conflict: boolean;
}

const COOK_WRITTEN = { sourceType: RecipeSourceType.USER_CREATED, sourceKind: null } as const;
const BOOK_RECIPE = { sourceType: RecipeSourceType.IMPORTED_PHYSICAL, sourceKind: 'book' } as const;

export const STAFF_EVIDENCE_MATRIX: readonly StaffEvidenceCase[] = [
    {
        name: 'a mistaken correction cleared: only a staff web row on an own recipe',
        recipe: COOK_WRITTEN,
        evidence: [{ capture: 'staffCorrection', sourceDomain: 'allrecipes.com', sourceKind: 'public_web' }],
        conflict: false,
    },
    {
        name: 'a staff book row on an own recipe',
        recipe: COOK_WRITTEN,
        evidence: [{ capture: 'staffCorrection', sourceDomain: null, sourceKind: 'book' }],
        conflict: false,
    },
    {
        name: 'a correct correction to a book: the recipe is private-only by its label, so the evidence rule is not asked',
        recipe: BOOK_RECIPE,
        evidence: [{ capture: 'staffCorrection', sourceDomain: null, sourceKind: 'book' }],
        conflict: false,
    },
    {
        name: 'a staff row plus the cook’s own book row',
        recipe: COOK_WRITTEN,
        evidence: [
            { capture: 'staffCorrection', sourceDomain: null, sourceKind: 'book' },
            { capture: 'editorCitation', sourceDomain: null, sourceKind: 'book' },
        ],
        conflict: true,
    },
    {
        name: 'a staff row plus the cook’s own web link',
        recipe: COOK_WRITTEN,
        evidence: [
            { capture: 'staffCorrection', sourceDomain: 'allrecipes.com', sourceKind: 'public_web' },
            { capture: 'editorLink', sourceDomain: 'allrecipes.com', sourceKind: 'public_web' },
        ],
        conflict: true,
    },
    {
        name: 'a row with no capture counts as the cook’s: the rule fails closed',
        recipe: COOK_WRITTEN,
        evidence: [{ sourceDomain: null, sourceKind: 'book' }],
        conflict: true,
    },
];

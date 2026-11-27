/**
 * The stored-value objects of the recipe state model (docs/architecture/recipeStateModel.md 4.2). Each stored string is
 * pinned as a literal: a value changed in the module is a stored-data change, and must fail here first.
 */
import { describe, expect, it } from 'vitest';

import { RecipeStatus, RecipeVisibility } from '../recipe.types.js';
import {
    Audience,
    EvidenceCapture,
    Lifecycle,
    Origin,
    RewrittenFact,
    SOURCE_LOCK,
} from '../recipeState/recipeStateValues.js';

describe('recipe state stored values', () => {
    it('stores each origin under its pinned string', () => {
        expect(Origin).toEqual({
            ORIGIN_UNSTATED: 'unstated',
            ORIGIN_OWN: 'own',
            ORIGIN_WEB_PAGE: 'webPage',
            ORIGIN_BOOK: 'book',
            ORIGIN_PAID_SITE: 'paidSite',
            ORIGIN_PERSON: 'person',
            ORIGIN_PUBLIC_DOMAIN: 'publicDomain',
            ORIGIN_COMMISE_WRITTEN: 'commiseWritten',
        });
    });

    it('stores each evidence capture and rewritten fact under its pinned string', () => {
        expect(EvidenceCapture).toEqual({
            EVIDENCE_PASTED_PAGE: 'pastedPage',
            EVIDENCE_EDITOR_LINK: 'editorLink',
            EVIDENCE_EDITOR_CITATION: 'editorCitation',
            EVIDENCE_IMPORT_FILE: 'importFile',
            EVIDENCE_STAFF_CORRECTION: 'staffCorrection',
        });
        expect(RewrittenFact).toEqual({
            REWRITTEN_ABSENT: 'absent',
            REWRITTEN_BY_COOK: 'earnedByCook',
            REWRITTEN_BY_AI: 'earnedByAi',
        });
    });

    it('keeps lifecycle and audience equal to the columns the database already stores', () => {
        expect(Lifecycle.LIFECYCLE_DRAFT).toBe(RecipeStatus.DRAFT);
        expect(Lifecycle.LIFECYCLE_PUBLISHED).toBe(RecipeStatus.PUBLISHED);
        expect(Audience.AUDIENCE_PRIVATE).toBe(RecipeVisibility.PRIVATE);
        expect(Audience.AUDIENCE_PUBLIC).toBe(RecipeVisibility.PUBLIC);
    });

    it('names the three source locks by the strings sourceLockOf answers', () => {
        expect(SOURCE_LOCK).toEqual({
            SOURCE_LOCK_OPEN: 'open',
            SOURCE_LOCK_DOWNGRADE_ONLY: 'downgradeOnly',
            SOURCE_LOCK_LOCKED: 'locked',
        });
    });
});

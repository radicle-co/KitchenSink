/**
 * An unusable Source blocks Publish and lives in Photos & publish (ADR-0089). A draft still saves: only the wire's own
 * refusals keep a draft on the device (`draftFloorErrors`), and a link the wire refuses is simply not sent.
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues } from '../../__fixtures__/index.js';
import { firstInvalidFieldOf } from '../../editor/gate.js';
import { errorsInSection, firstSectionWithErrors, sectionOfField } from '../../editor/sections.js';
import { sourceFieldId, stepFieldId } from '../fieldIds.js';
import { draftFloorErrors, validateRecipeForm } from '../validate.js';

const filled = (sourceLink?: string) => makeFilledRecipeFormValues(sourceLink === undefined ? {} : { sourceLink });

describe('validateRecipeForm: the Source', () => {
    it('has no source error with no link or a usable one', () => {
        expect(validateRecipeForm(filled(), '').source).toBeUndefined();
        expect(validateRecipeForm(filled('https://www.allrecipes.com/recipe/1/'), '').source).toBeUndefined();
    });

    it('refuses text that is not a web link', () => {
        expect(validateRecipeForm(filled('soup'), '').source).toBe('sourceInvalid');
    });

    it('refuses a Commise link', () => {
        expect(validateRecipeForm(filled('https://commise.app/en/recipes/1'), '').source).toBe('sourceOwnSite');
    });

    it('never keeps a draft on the device', () => {
        expect(draftFloorErrors(filled('soup'))).toEqual({});
    });
});

describe('where the Source error lives', () => {
    it('belongs to Photos & publish', () => {
        expect(sectionOfField('source')).toBe('photos');
        expect(errorsInSection({ source: 'sourceInvalid' }, 'photos')).toEqual({ source: 'sourceInvalid' });
        expect(firstSectionWithErrors({ source: 'sourceOwnSite' })).toBe('photos');
    });

    it('takes a refused Publish to the Source field, after the earlier fields', () => {
        expect(firstInvalidFieldOf({ source: 'sourceInvalid' }, filled())).toBe(sourceFieldId);
        expect(
            firstInvalidFieldOf(
                { source: 'sourceInvalid', steps: 'stepsRequired' },
                { ...filled(), steps: [{ instruction: '' }] },
            ),
        ).toBe(stepFieldId(0));
    });
});

import { describe, expect, it } from 'vitest';

import {
    PUBLISH_REQUIREMENTS,
    RecipeErrorCode,
    publishRequirementSchema,
    publishRequirementsUnmetDetailsSchema,
    recipeErrorCodeSchema,
} from '../index.js';

describe('PUBLISH_REQUIREMENTS', () => {
    it('names what Publish needs, in the editor’s page order: cuisine (Details), ingredients, steps', () => {
        expect([...PUBLISH_REQUIREMENTS]).toEqual(['cuisine', 'ingredients', 'steps']);
        expect(publishRequirementSchema.options).toEqual([...PUBLISH_REQUIREMENTS]);
    });
});

describe('publishRequirementsUnmetDetailsSchema', () => {
    it('carries at least one missing requirement', () => {
        expect(publishRequirementsUnmetDetailsSchema.safeParse({ missing: ['cuisine'] }).success).toBe(true);
        expect(publishRequirementsUnmetDetailsSchema.safeParse({ missing: ['cuisine', 'steps'] }).success).toBe(true);
        expect(publishRequirementsUnmetDetailsSchema.safeParse({ missing: [] }).success).toBe(false);
        expect(publishRequirementsUnmetDetailsSchema.safeParse({}).success).toBe(false);
    });

    it('refuses a requirement this build does not know', () => {
        expect(publishRequirementsUnmetDetailsSchema.safeParse({ missing: ['photos'] }).success).toBe(false);
    });
});

describe('PUBLISH_REQUIREMENTS_UNMET', () => {
    it('is a recipe-domain error code, on the runtime list as well as the constant', () => {
        expect(RecipeErrorCode.PUBLISH_REQUIREMENTS_UNMET).toBe('PUBLISH_REQUIREMENTS_UNMET');
        expect(recipeErrorCodeSchema.safeParse('PUBLISH_REQUIREMENTS_UNMET').success).toBe(true);
    });
});

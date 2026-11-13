/**
 * Which recipes a bulk import REFUSES outright (ADR-0072 §3, owner ruling 2026-11-11): one with no ingredient lines or no
 * steps. The rule is the publish policy's content half, asked once through `unmetContentRequirements`; these tests pin that
 * the import does not keep a second copy of it, and which refusal wins when both apply. REWRITTEN over counts (review item
 * 7 on #220): the upload counts the recipe, and the save and the view count a payload that slipped past it, with ONE rule.
 */
import { describe, expect, it } from 'vitest';

import { importRefusalOf } from '../importRefusal.js';

describe('importRefusalOf', () => {
    it('is null for a recipe with a line and a step', () => {
        expect(importRefusalOf({ ingredientLineCount: 1, stepCount: 1 })).toBeNull();
    });

    it('refuses a recipe with no ingredient line', () => {
        expect(importRefusalOf({ ingredientLineCount: 0, stepCount: 1 })).toBe('noIngredients');
    });

    it('refuses a recipe with no step', () => {
        expect(importRefusalOf({ ingredientLineCount: 1, stepCount: 0 })).toBe('noSteps');
    });

    it('names the FIRST gap in the publish order when both are missing: ingredients', () => {
        expect(importRefusalOf({ ingredientLineCount: 0, stepCount: 0 })).toBe('noIngredients');
    });
});

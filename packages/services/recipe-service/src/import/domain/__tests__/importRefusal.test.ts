/**
 * Which recipes a bulk import REFUSES outright (ADR-0072 §3, owner ruling 2026-11-11): one with no ingredient lines or no
 * steps. The rule is the publish policy's content half, asked once through `unmetContentRequirements`; these tests pin that
 * the import does not keep a second copy of it, and which refusal wins when both apply.
 */
import { describe, expect, it } from 'vitest';

import { importRefusalOf } from '../importRefusal.js';

describe('importRefusalOf', () => {
    it('is null for a recipe with a line and a step', () => {
        expect(importRefusalOf({ ingredientLines: ['1 egg'], steps: [{ instruction: 'Boil' }] })).toBeNull();
    });

    it('refuses a recipe with no ingredient line', () => {
        expect(importRefusalOf({ ingredientLines: [], steps: [{ instruction: 'Boil' }] })).toBe('noIngredients');
    });

    it('refuses a recipe with no step', () => {
        expect(importRefusalOf({ ingredientLines: ['1 egg'], steps: [] })).toBe('noSteps');
    });

    it('names the FIRST gap in the publish order when both are missing: ingredients', () => {
        expect(importRefusalOf({ ingredientLines: [], steps: [] })).toBe('noIngredients');
    });
});

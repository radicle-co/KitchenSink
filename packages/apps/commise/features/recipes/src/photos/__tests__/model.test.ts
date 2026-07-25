/**
 * Unit test for the photos model's shared limit (DA5) — `MAX_RECIPE_PHOTOS` must be the recipe-core
 * constant re-exported, not a locally hand-restated `10`, so the client and the wire-facing package can
 * never drift on the per-recipe photo cap.
 */
import { describe, expect, it } from 'vitest';

import { MAX_RECIPE_PHOTOS as CORE_MAX_RECIPE_PHOTOS } from '@kitchensink/recipe-core';

import { isAtPhotoCap, MAX_RECIPE_PHOTOS } from '../model.js';

describe('MAX_RECIPE_PHOTOS (single source of truth)', () => {
    it('is the SAME constant recipe-core exports — not a locally hand-restated value', () => {
        expect(MAX_RECIPE_PHOTOS).toBe(CORE_MAX_RECIPE_PHOTOS);
    });
});

describe('isAtPhotoCap', () => {
    it('is false below the cap and true at/above it', () => {
        expect(isAtPhotoCap(MAX_RECIPE_PHOTOS - 1)).toBe(false);
        expect(isAtPhotoCap(MAX_RECIPE_PHOTOS)).toBe(true);
        expect(isAtPhotoCap(MAX_RECIPE_PHOTOS + 1)).toBe(true);
    });
});

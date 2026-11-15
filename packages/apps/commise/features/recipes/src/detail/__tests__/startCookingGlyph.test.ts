/**
 * The Start cooking row's glyph. The row tests read the glyph through
 * `START_COOKING_GLYPH`, which proves both leaves read the one constant but passes for any value. This pins the value
 * itself: `cookingPot`, never `flame`, which means kcal.
 */
import { describe, expect, it } from 'vitest';

import { START_COOKING_GLYPH } from '../startCookingGlyph.js';

describe('START_COOKING_GLYPH', () => {
    it('is the cooking pot', () => {
        expect(START_COOKING_GLYPH).toBe('cookingPot');
    });
});

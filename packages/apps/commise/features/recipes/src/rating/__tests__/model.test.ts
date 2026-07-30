/**
 * Unit tests for the recipe-rating control's pure model layer (FR-013). Covers the own-recipe gate
 * (`ratingModeFor`) and the localized, pluralized star-option label (`formatStarOptionLabel`). These are the
 * platform-neutral pieces the web and native leaves both consume, so a drift here would drift both platforms.
 *
 * The `ratingModeFor` cases are written as a mutation lens: the own-recipe gate (Sc8) is the security-relevant
 * branch, so an inverted or dropped comparison MUST fail a test here rather than silently offering a rating
 * input on the viewer's own recipe.
 */
import { describe, expect, it } from 'vitest';

import { formatStarOptionLabel, ratingModeFor } from '../model.js';

describe('ratingModeFor (own-recipe gate, Sc8)', () => {
    it('is "own" when the viewer is the recipe owner', () => {
        expect(ratingModeFor({ viewerId: 'usr_1', ownerId: 'usr_1' })).toBe('own');
    });

    it('is "rate" when the viewer is not the owner', () => {
        expect(ratingModeFor({ viewerId: 'usr_2', ownerId: 'usr_1' })).toBe('rate');
    });

    it('is "rate" when the viewer id is unknown (deniably not the owner)', () => {
        // An absent viewer id must NOT resolve to "own" (which would hide the input on every recipe); the
        // backend guard is the real enforcement, so an unknown viewer falls through to the rate affordance.
        expect(ratingModeFor({ ownerId: 'usr_1' })).toBe('rate');
    });
});

describe('formatStarOptionLabel', () => {
    it('uses the singular template for one star', () => {
        expect(formatStarOptionLabel(1, { one: 'Rate {count} star', other: 'Rate {count} stars' }, 'en')).toBe(
            'Rate 1 star',
        );
    });

    it('uses the plural template for more than one star', () => {
        expect(formatStarOptionLabel(4, { one: 'Rate {count} star', other: 'Rate {count} stars' }, 'en')).toBe(
            'Rate 4 stars',
        );
    });
});

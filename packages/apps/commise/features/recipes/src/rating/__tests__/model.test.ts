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

import { formatStarOptionLabel, ratingModeFor, resolveSelectedStars } from '../model.js';

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

describe('resolveSelectedStars (server viewerRating vs optimistic session override, FR-013)', () => {
    it('PRE-SELECTS the server viewerRating on load when there is no session override', () => {
        // The core new behavior: a returning viewer's saved stars are pre-selected straight from the server.
        // Mutation lens: if the container drops the `viewerRating` pass-through (passes undefined), this is
        // undefined and pre-select silently breaks.
        expect(resolveSelectedStars(undefined, 4)).toBe(4);
    });

    it('selects nothing when the viewer has not rated and has taken no action', () => {
        expect(resolveSelectedStars(undefined, undefined)).toBeUndefined();
    });

    it('bridges a just-made rating optimistically before the refetch lands (no flicker to the old value)', () => {
        // Viewer just rated 5; the server still reports the pre-write 3 until the detail refetch completes.
        expect(resolveSelectedStars({ stars: 5 }, 3)).toBe(5);
    });

    it('lets the SERVER win once it reflects the viewer’s rating (override becomes inert — no double truth)', () => {
        expect(resolveSelectedStars({ stars: 5 }, 5)).toBe(5);
    });

    it('bridges a just-made REMOVAL optimistically (shows unselected immediately, not the old stars)', () => {
        // The three-state override earns its keep here: a removal must NOT flicker back to the pre-removal 3
        // while the refetch is in flight. A bare `number | undefined` override could not express this.
        expect(resolveSelectedStars({ stars: undefined }, 3)).toBeUndefined();
    });

    it('lets the server win once a removal is reflected (viewerRating now absent)', () => {
        expect(resolveSelectedStars({ stars: undefined }, undefined)).toBeUndefined();
    });

    it('distinguishes a REMOVAL from NO-ACTION against the same server rating', () => {
        // Same server value (3), opposite results: an explicit removal clears the selection; no action defers
        // to the server and keeps it. Collapsing the two would either strand a removed rating or drop a saved one.
        expect(resolveSelectedStars({ stars: undefined }, 3)).toBeUndefined();
        expect(resolveSelectedStars(undefined, 3)).toBe(3);
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

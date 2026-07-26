/**
 * Unit test for the photos model's shared limit (DA5) — `MAX_RECIPE_PHOTOS` must be the recipe-core
 * constant re-exported, not a locally hand-restated `10`, so the client and the wire-facing package can
 * never drift on the per-recipe photo cap.
 */
import { describe, expect, it } from 'vitest';

import { MAX_RECIPE_PHOTOS as CORE_MAX_RECIPE_PHOTOS } from '@kitchensink/recipe-core';

import { makePhoto } from '../../__fixtures__/index.js';
import { isAtPhotoCap, isCoverPhoto, MAX_RECIPE_PHOTOS } from '../model.js';

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

describe('isCoverPhoto (cover = the lowest-sort-order photo, i.e. index 0)', () => {
    const photos = [
        makePhoto({ id: 'ph_1', order: 1 }),
        makePhoto({ id: 'ph_2', order: 2 }),
        makePhoto({ id: 'ph_3', order: 3 }),
    ];

    it('is true for the FIRST photo — the cover defaults to it, with no explicit selection', () => {
        expect(isCoverPhoto(photos, 'ph_1')).toBe(true);
    });

    it('is false for any non-first photo', () => {
        expect(isCoverPhoto(photos, 'ph_2')).toBe(false);
        expect(isCoverPhoto(photos, 'ph_3')).toBe(false);
    });

    it('promotes the next photo to cover once the former first photo is gone (remove-cover reassigns)', () => {
        // The former cover `ph_1` has been removed → `ph_2` is now index 0 and therefore the cover.
        const afterRemoval = [makePhoto({ id: 'ph_2', order: 2 }), makePhoto({ id: 'ph_3', order: 3 })];
        expect(isCoverPhoto(afterRemoval, 'ph_2')).toBe(true);
        expect(isCoverPhoto(afterRemoval, 'ph_1')).toBe(false);
    });

    it('is false for any id when there are no photos', () => {
        expect(isCoverPhoto([], 'ph_1')).toBe(false);
    });
});

/**
 * Test fixture: a fake `PhotosDal` + CDN base for constructing `RecipesService` in unit tests.
 *
 * `RecipesService` embeds a recipe's photos in the detail read via an injected `PhotosDal`; unit tests
 * that don't exercise photos just need a stub whose `findByRecipe` returns no rows.
 */
import { vi } from 'vitest';

import type { PhotosDal } from '../../photos/dal/photos.dal.js';

/** A CloudFront base URL for resolving embedded photo URLs in unit tests. */
export const RECIPE_PHOTOS_CDN = 'https://cdn.example.com';

/** A `PhotosDal` stub whose `findByRecipe` returns no photos (the default for non-photo unit tests). */
export function fakePhotosDal(): PhotosDal {
    return { findByRecipe: vi.fn().mockResolvedValue([]) } as unknown as PhotosDal;
}

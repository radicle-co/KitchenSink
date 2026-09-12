/**
 * Test fixture: a fake `RatingsDal` for constructing `RecipesService` in unit tests.
 *
 * `RecipesService.getById` reads the viewer's own rating (for `RecipeDetail.viewerRating`) via an injected
 * `RatingsDal`. Unit tests that don't exercise viewer ratings just need a stub whose `findStars` returns
 * `undefined` (viewer has not rated); pass `stars` to simulate a viewer who has.
 */
import { vi } from 'vitest';

import type { RatingsDal } from '../../ratings/dal/ratings.dal.js';

/**
 * A `RatingsDal` stub. `findStars` resolves to `stars` when provided (a viewer who has rated), else
 * `undefined` (the default — viewer has NOT rated), matching the DAL's real contract.
 *
 * @param stars - The viewer's stars to return from `findStars`, or `undefined` for an unrated viewer.
 */
export function fakeRatingsDal(stars?: number): RatingsDal {
    return { findStars: vi.fn().mockResolvedValue(stars) } as unknown as RatingsDal;
}

/**
 * CR-001 / FR-013 — unit tests for {@link RatingsController} over a fake {@link RatingsService}.
 *
 * The controller is thin: it takes the verified caller ULID (resolved by `@OwnerId()`, the rater) and the
 * path id, forwards them to the service, and returns its result verbatim. The write rate-limit
 * (`@WriteRateLimit()`) and status codes (PUT 200 / DELETE 204) are framework decorators, verified by the
 * throttle + e2e specs; the "missing principal → 401" path lives on the decorator and is tested there.
 */
import { describe, it, expect, vi } from 'vitest';

import { RatingsController } from '../ratings.controller.js';
import type { RatingsService } from '../ratings.service.js';
import type { SetRatingDto } from '../dto/setRating.dto.js';
import type { RecipeResponse } from '../../recipes/dto/recipeResponse.dto.js';

const RATER = '01JRATER00000000000000000A';
const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
const DETAIL = { id: RECIPE_ID, ratingCount: 1 } as unknown as RecipeResponse;

function fakeService(overrides: Partial<RatingsService> = {}): RatingsService {
    return { setRating: vi.fn(), deleteRating: vi.fn(), ...overrides } as unknown as RatingsService;
}

describe('RatingsController', () => {
    it('setRating forwards the verified rater, the path id, and the body, returning the detail', async () => {
        const setRating = vi.fn().mockResolvedValue(DETAIL);
        const controller = new RatingsController(fakeService({ setRating }));
        const body = { stars: 4 } as SetRatingDto;

        const result = await controller.setRating(RATER, RECIPE_ID, body);

        expect(setRating).toHaveBeenCalledWith(RATER, RECIPE_ID, body);
        expect(result).toBe(DETAIL);
    });

    it('deleteRating forwards the verified rater and the path id, returning void', async () => {
        const deleteRating = vi.fn().mockResolvedValue(undefined);
        const controller = new RatingsController(fakeService({ deleteRating }));

        const result = await controller.deleteRating(RATER, RECIPE_ID);

        expect(deleteRating).toHaveBeenCalledWith(RATER, RECIPE_ID);
        expect(result).toBeUndefined();
    });
});

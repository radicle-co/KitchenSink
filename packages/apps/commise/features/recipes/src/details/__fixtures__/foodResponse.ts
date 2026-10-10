/**
 * Fixture factories for the details dialog's food read (curated U14).
 */
import type { FoodResponse } from '@kitchensink/food-service-client';

/**
 * A `RESOLVED` food as `GET /api/v1/foods/{id}` returns it, with no variants unless given.
 *
 * @param overrides - Fields to replace.
 * @returns The food.
 */
export function makeFoodResponse(overrides: Partial<FoodResponse> = {}): FoodResponse {
    return {
        id: 'food_root',
        name: 'beef brisket',
        description: null,
        kind: 'generic',
        status: 'RESOLVED',
        nutrients: [],
        portions: [],
        provenance: {},
        variants: [],
        ...overrides,
    };
}

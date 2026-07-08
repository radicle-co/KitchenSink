/**
 * Fixture factories for the ingredients domain (`make*` accepting `Partial<T>`, per CODING_STANDARDS).
 * Used by the ingredient DAL / service / controller unit tests.
 */
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import type {
    AddResult,
    CandidateView,
    FoodView,
    SearchResultView,
    StatusResult,
} from '@kitchensink/food-service-client';

/** A canonical `Ingredient` domain object with overridable fields. */
export function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'All-purpose flour',
        isUserEntered: false,
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

/** A raw (snake_case) `ingredients` row as returned by `db.execute`, with overridable fields. */
export function makeRawIngredientRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'All-purpose flour',
        food_id: null,
        food_resolution_status: null,
        is_user_entered: false,
        calories_per_100g: null,
        protein_g_per_100g: null,
        carbs_g_per_100g: null,
        fat_g_per_100g: null,
        created_at: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

/** A food-service `search` hit view. */
export function makeSearchResultView(overrides: Partial<SearchResultView> = {}): SearchResultView {
    return {
        id: '01J0000000000000000000FOOD',
        name: 'All-purpose flour',
        score: 0.92,
        ...overrides,
    };
}

/** A food-service `addByName` (`202`) result. */
export function makeAddResult(overrides: Partial<AddResult> = {}): AddResult {
    return {
        id: '01J0000000000000000000FOOD',
        status: FoodResolutionStatus.PENDING,
        ...overrides,
    };
}

/** A food-service golden record view (`RESOLVED`). */
export function makeFoodView(overrides: Partial<FoodView> = {}): FoodView {
    return {
        id: '01J0000000000000000000FOOD',
        name: 'All-purpose flour',
        description: null,
        kind: 'generic',
        status: FoodResolutionStatus.RESOLVED,
        nutrients: [
            { nutrient: 'Energy', amount: 364, unit: 'kcal', basis: 'per_100g', source: 'usda' },
            { nutrient: 'Protein', amount: 10.3, unit: 'g', basis: 'per_100g', source: 'usda' },
            { nutrient: 'Carbohydrate, by difference', amount: 76.3, unit: 'g', basis: 'per_100g', source: 'usda' },
            { nutrient: 'Total lipid (fat)', amount: 0.98, unit: 'g', basis: 'per_100g', source: 'usda' },
        ],
        portions: [],
        provenance: {},
        ...overrides,
    };
}

/** A food-service `getStatus` result. */
export function makeStatusResult(overrides: Partial<StatusResult> = {}): StatusResult {
    return {
        id: '01J0000000000000000000FOOD',
        status: FoodResolutionStatus.PENDING,
        ...overrides,
    };
}

/** A food-service disambiguation candidate view. */
export function makeCandidateView(overrides: Partial<CandidateView> = {}): CandidateView {
    return {
        candidateId: 'cand-1',
        source: 'usda',
        externalKey: '123456',
        name: 'Flour, wheat, all-purpose',
        summary: null,
        ...overrides,
    };
}

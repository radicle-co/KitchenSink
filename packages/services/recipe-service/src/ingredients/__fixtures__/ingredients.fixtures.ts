/**
 * Fixture factories for the ingredients domain (`make*` accepting `Partial<T>`, per CODING_STANDARDS).
 * Used by the ingredient DAL / service / controller unit tests.
 */
import { vi } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import type {
    AddResult,
    CandidateView,
    FoodServiceClient,
    SearchResultView,
    FoodView,
    StatusResult,
} from '@kitchensink/food-service-client';

import { CallerToken } from '../../auth/CallerToken.js';
import { canonicalIngredientName, type CanonicalIngredientName } from '../domain/ingredientName.js';
import type { FoodServiceClients } from '../FoodServiceClients.factory.js';

/**
 * The caller credential the ingredient tests forward to the food service (issue #120). A real request
 * carries the user's verified Clerk bearer; the tests only need a distinct, redacting {@link CallerToken}.
 */
export const CALLER_TOKEN = CallerToken.fromAuthorizationHeader('Bearer caller-session-jwt') as CallerToken;

/** The mocked food-client methods a {@link makeFoodClients} double exposes. */
export type FoodClientMocks = Record<string, ReturnType<typeof vi.fn>>;

/**
 * A {@link FoodServiceClients} double: ONE underlying mocked client, returned by both `standard()` and
 * `typeahead()`, plus the spies on those factory methods so a test can assert WHICH caller a client was
 * minted for and which budget was used.
 */
export function makeFoodClients(): {
    clients: FoodServiceClients;
    mocks: FoodClientMocks;
    standard: ReturnType<typeof vi.fn>;
    typeahead: ReturnType<typeof vi.fn>;
} {
    const mocks: FoodClientMocks = {
        search: vi.fn(),
        addByName: vi.fn(),
        getById: vi.fn(),
        getStatus: vi.fn(),
        getCandidates: vi.fn(),
        resolve: vi.fn(),
        batch: vi.fn(),
        createAuthoredFood: vi.fn(),
    };
    const client = mocks as unknown as FoodServiceClient;
    const standard = vi.fn(() => client);
    const typeahead = vi.fn(() => client);

    return { clients: { standard, typeahead } as unknown as FoodServiceClients, mocks, standard, typeahead };
}

/**
 * Present an existing stubbed `FoodServiceClient` as the per-request client factory the service now takes
 * (issue #120) — for suites whose subject is the DAL/SQL rather than the credential seam, so they keep
 * asserting against the client double they already had.
 */
export function foodClientsOf(client: FoodServiceClient): FoodServiceClients {
    return { standard: () => client, typeahead: () => client } as unknown as FoodServiceClients;
}

/**
 * Parse a test literal into a {@link CanonicalIngredientName}.
 *
 * ⚠️ It runs the REAL smart constructor rather than casting, so a test can never hand the DAL a brand the
 * production parser would have refused — which would make the type's guarantee a fiction exactly where it is
 * being verified. A literal that does not survive canonicalization is a broken fixture, so it throws.
 *
 * @param raw - The literal name a test wants to write.
 * @returns The branded canonical name.
 * @throws {Error} When the literal carries no visible content.
 */
export function makeCanonicalName(raw: string): CanonicalIngredientName {
    const name = canonicalIngredientName(raw);

    if (name === undefined) {
        throw new Error(`Test fixture name ${JSON.stringify(raw)} carries no visible content.`);
    }

    return name;
}

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
        // FOOD's own portions — this is the food service's view type, not the `ingredients` column U10
        // dropped. Removing it was my over-correction; the two are different shapes with the same name.
        portions: [],
        status: FoodResolutionStatus.RESOLVED,
        nutrients: [
            { nutrient: 'Energy', amount: 364, unit: 'kcal', basis: 'per_100g', source: 'usda' },
            { nutrient: 'Protein', amount: 10.3, unit: 'g', basis: 'per_100g', source: 'usda' },
            { nutrient: 'Carbohydrate, by difference', amount: 76.3, unit: 'g', basis: 'per_100g', source: 'usda' },
            { nutrient: 'Total lipid (fat)', amount: 0.98, unit: 'g', basis: 'per_100g', source: 'usda' },
        ],
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

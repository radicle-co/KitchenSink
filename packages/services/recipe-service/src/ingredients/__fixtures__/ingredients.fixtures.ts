/**
 * Fixture factories for the ingredients domain (`make*` accepting `Partial<T>`, per CODING_STANDARDS).
 * Used by the ingredient DAL / service / controller unit tests.
 */
import { vi, type Mock } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import type { AddResponse, CandidateView, FoodServiceClient, SearchResultView } from '@kitchensink/food-service-client';

import { CallerToken } from '../../auth/CallerToken.js';
import { canonicalIngredientName, type CanonicalIngredientName } from '../domain/ingredientName.js';
import type { FoodServiceClients } from '../FoodServiceClients.factory.js';

/**
 * The caller credential the ingredient tests forward to the food service (issue #120). A real request
 * carries the user's verified Clerk bearer; the tests only need a distinct, redacting {@link CallerToken}.
 */
export const CALLER_TOKEN = CallerToken.fromAuthorizationHeader('Bearer caller-session-jwt') as CallerToken;

/** The mocked food-client methods a {@link makeFoodClients} double exposes. */
export type FoodClientMocks = ReturnType<typeof foodClientMocks>;

/**
 * One mock per food-client method the ingredient suites stub, keyed by the client's own method names: a stub on a
 * name the client does not have is a compile error, not a stub that silently does nothing.
 */
function foodClientMocks() {
    return {
        search: vi.fn(),
        addByName: vi.fn(),
        getById: vi.fn(),
        getStatus: vi.fn(),
        getCandidates: vi.fn(),
        resolve: vi.fn(),
        batch: vi.fn(),
        createAuthoredFood: vi.fn(),
        // Typed by the client's own signature, so a stubbed answer that food could not send fails to compile.
        getNutrition: vi.fn<FoodServiceClient['getNutrition']>(),
        getAuthoredNutrition: vi.fn<FoodServiceClient['getAuthoredNutrition']>(),
    } satisfies Partial<Record<keyof FoodServiceClient, Mock>>;
}

/** Food's read deadline in the doubles unless a suite names one: a fixed figure, since most doubles never wait. */
const DOUBLE_READ_DEADLINE_MS = 1_000;

/**
 * A {@link FoodServiceClients} double: ONE underlying mocked client, returned by `standard()`, `typeahead()` and
 * `readClient()`, plus the spies on those factory methods so a test can assert WHICH caller a client was
 * minted for and which budget was used.
 *
 * @param options - `readDeadlineMs` for a suite whose subject waits on food's read deadline.
 */
export function makeFoodClients(options: { readonly readDeadlineMs?: number } = {}): {
    clients: FoodServiceClients;
    mocks: FoodClientMocks;
    standard: Mock;
    typeahead: Mock;
    readClient: Mock<FoodServiceClients['readClient']>;
} {
    const mocks = foodClientMocks();
    const client = mocks as unknown as FoodServiceClient;
    const standard = vi.fn(() => client);
    const typeahead = vi.fn(() => client);
    const readClient = vi.fn<FoodServiceClients['readClient']>(() => client);
    const clients = clientsDouble({
        standard,
        typeahead,
        client,
        readClient,
        readDeadlineMs: options.readDeadlineMs ?? DOUBLE_READ_DEADLINE_MS,
    });

    return { clients, mocks, standard, typeahead, readClient };
}

/**
 * Every public member of {@link FoodServiceClients}, each minting `client`. The `satisfies` makes a member the
 * factory gains and the double lacks a compile error, rather than a `TypeError` in whichever suite reaches it first.
 */
function clientsDouble(parts: {
    readonly standard: () => FoodServiceClient;
    readonly typeahead: () => FoodServiceClient;
    readonly client: FoodServiceClient;
    readonly readClient?: FoodServiceClients['readClient'];
    readonly readDeadlineMs?: number;
}): FoodServiceClients {
    const double = {
        standard: parts.standard,
        typeahead: parts.typeahead,
        nutrition: () => parts.client,
        postCommitNutrition: () => parts.client,
        readClient: parts.readClient ?? (() => parts.client),
        readDeadlineMs: () => parts.readDeadlineMs ?? DOUBLE_READ_DEADLINE_MS,
    } satisfies Pick<FoodServiceClients, keyof FoodServiceClients>;

    return double as unknown as FoodServiceClients;
}

/**
 * Present an existing stubbed `FoodServiceClient` as the per-request client factory the service now takes
 * (issue #120) — for suites whose subject is the DAL/SQL rather than the credential seam, so they keep
 * asserting against the client double they already had.
 */
export function foodClientsOf(client: FoodServiceClient): FoodServiceClients {
    return clientsDouble({ standard: () => client, typeahead: () => client, client });
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
export function makeAddResult(overrides: Partial<AddResponse> = {}): AddResponse {
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

/**
 * `POST /api/v1/collections` over the REAL HTTP pipeline, its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a):
 * owner 2026-10-13, a private collection is a Premium feature.
 *
 * The dev-bypass principal carries no `permissions`, so every request here is a FREE-TIER cook. That is exactly the case
 * the wire must prove: the controller derives the tier from the principal, the service consults the policy, and a refusal
 * reaches the client as `400 INVALID_VISIBILITY` with the `requiredEntitlement` detail the upsell reads, with nothing
 * written. The premium half (default private; private allowed) is the service suite's and the LOCAL e2e's.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JCOLLECTIONTIER00000000001';
const NOW = new Date('2026-01-01T00:00:00.000Z');

let food: FoodFake;
let booted: BootedServiceApp;

const createIfUnderCap = vi.fn(async (input: { ownerId: string; name: string; visibility: string }) => ({
    id: 'col_new',
    ownerId: input.ownerId,
    name: input.name,
    description: null,
    visibility: input.visibility,
    sourceCollectionId: null,
    sourceOwnerDisplayName: null,
    sourceCollectionName: null,
    lastPulledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
}));

/**
 * Create a collection as the free-tier cook.
 *
 * @param body - The request body.
 * @sideEffect One HTTP request.
 */
async function post(body: Record<string, unknown>): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/collections`, {
            method: 'POST',
            headers: { authorization: bearerFor(COOK), 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            { provide: CollectionsDal, useValue: { createIfUnderCap } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    createIfUnderCap.mockClear();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('POST /api/v1/collections — private is Premium (integration: real pipeline, mocked dependencies)', () => {
    it('creates a free-tier cook’s collection PUBLIC when no visibility is sent', async () => {
        const res = await post({ name: 'Dinners' });

        expect(res.status).toBe(201);
        expect(((await res.json()) as { visibility: string }).visibility).toBe('public');
        expect(createIfUnderCap).toHaveBeenCalledWith(
            expect.objectContaining({ visibility: 'public' }),
            expect.any(Number),
        );
    });

    it('REFUSES private with 400 INVALID_VISIBILITY naming the premium entitlement, and writes nothing', async () => {
        const res = await post({ name: 'Secret', visibility: 'private' });
        const body = (await res.json()) as { code: string; details?: { requiredEntitlement?: string } };

        expect(res.status).toBe(400);
        expect(body.code).toBe('INVALID_VISIBILITY');
        expect(body.details?.requiredEntitlement).toBe('premium');
        expect(createIfUnderCap).not.toHaveBeenCalled();
    });
});

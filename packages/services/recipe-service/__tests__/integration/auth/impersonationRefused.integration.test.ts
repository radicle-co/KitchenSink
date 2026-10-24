/**
 * Integration: recipe-service refuses a Clerk impersonation session token with 401 (owner ruling 2026-10-15).
 *
 * The REAL `AuthMiddleware` → `ClerkAuthService` → `verifyClerkToken` → `@clerk/backend`'s `verifyToken`, over a
 * token genuinely RS256-signed by a key the booted app trusts. Clerk signs an impersonation session like any other and
 * marks it with an `act` claim; only the shared verifier's rule stops it. The data access is a double that must never
 * be reached by the refused request.
 *
 * The control matters: the SAME token without `act` is served, so the 401 is the `act` rule and not a misconfigured
 * key or `azp`.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { generateClerkKeypair, mintToken } from '../../../tests/support/jwt.js';
import { startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const AZP = 'https://recipes-impersonation.example.com';
const OWNER = '01JIMPERSONATED000000000001';
const NOW = new Date('2026-01-01T00:00:00.000Z');
const keypair = generateClerkKeypair();
const saved: Record<string, string | undefined> = {};

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
 * Create a public collection with a token minted with (or without) the impersonation marker.
 *
 * @sideEffect One HTTP request.
 */
async function createCollection(act: { readonly sub: string } | undefined): Promise<Response> {
    const token = mintToken(keypair.privateKeyPem, {
        sub: 'user_impersonated',
        azp: AZP,
        externalId: OWNER,
        ...(act === undefined ? {} : { act }),
    });

    return fetch(`${booted.baseUrl}/api/v1/collections`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Mine', visibility: 'public' }),
    });
}

beforeAll(async () => {
    for (const key of ['CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'RECIPE_DEV_AUTH_USER_ID']) {
        saved[key] = process.env[key];
    }

    // No dev bypass: the signed token is the only identity. Set before boot — the defaults apply only when absent.
    delete process.env['RECIPE_DEV_AUTH_USER_ID'];
    process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
    process.env['CLERK_AUTHORIZED_PARTIES'] = AZP;
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

    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

describe('recipe-service — impersonation session token (integration: real auth chain, mocked data access)', () => {
    it('⛔ answers 401 to a validly signed token carrying an act claim, and writes nothing', async () => {
        const res = await createCollection({ sub: 'user_admin' });

        expect(res.status).toBe(401);
        expect(createIfUnderCap).not.toHaveBeenCalled();
    });

    it('control: the same token without act is served', async () => {
        const res = await createCollection(undefined);

        expect(res.status).toBe(201);
        expect(createIfUnderCap).toHaveBeenCalledTimes(1);
    });
});

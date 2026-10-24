/**
 * Who may USE a paid feature, by ROLE, over the REAL HTTP pipeline with its dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a; plan 2026-10-14-009 D5).
 *
 * Owner ruling 2026-10-15: superuser, vip and premium get the paid features; an ADMIN does not — an admin sees them as a
 * default user does, and superuser is the admin who uses the whole app free. The roles are SIGNED: each request carries
 * an RS256 token from a throwaway key the booted app trusts, so the real `AuthMiddleware` → `verifyClerkToken` (which
 * parses `public_metadata.roles`) → `isPremiumPrincipal` → the collection visibility policy decides. A private collection
 * is the paid feature; only the DAL is a double.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { generateClerkKeypair, mintToken } from '../../../tests/support/jwt.js';
import { startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const AZP = 'https://recipes.example.com';
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
 * Create a private collection as a cook holding `roles` in their signed `public_metadata`.
 *
 * @sideEffect One HTTP request.
 */
async function createPrivateAs(roles: readonly string[]): Promise<Response> {
    const owner = `01JPAIDROLE${roles.join('').toUpperCase()}`.padEnd(26, '0').slice(0, 26);
    const token = mintToken(keypair.privateKeyPem, { sub: `user_${owner}`, azp: AZP, externalId: owner, roles });

    return fetch(`${booted.baseUrl}/api/v1/collections`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Secret', visibility: 'private' }),
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

describe('a private collection, by signed role (integration: real auth chain, mocked data access)', () => {
    it.each([['superuser'], ['vip'], ['premium']])('%s may create one', async (role) => {
        const res = await createPrivateAs([role]);

        expect(res.status).toBe(201);
        expect(((await res.json()) as { visibility: string }).visibility).toBe('private');
        expect(createIfUnderCap).toHaveBeenCalledWith(
            expect.objectContaining({ visibility: 'private' }),
            expect.any(Number),
        );
    });

    it.each([['admin'], ['default']])(
        '⛔ %s is refused with 400 INVALID_VISIBILITY naming the premium entitlement, and nothing is written',
        async (role) => {
            const res = await createPrivateAs([role]);
            const body = (await res.json()) as { code: string; details?: { requiredEntitlement?: string } };

            expect(res.status).toBe(400);
            expect(body.code).toBe('INVALID_VISIBILITY');
            expect(body.details?.requiredEntitlement).toBe('premium');
            expect(createIfUnderCap).not.toHaveBeenCalled();
        },
    );
});

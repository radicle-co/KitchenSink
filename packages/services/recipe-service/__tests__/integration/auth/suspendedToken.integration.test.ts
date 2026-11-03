/**
 * Integration: recipe-service answers 403 to a SUSPENDED account's token, except on the data-rights routes (ADR-0081).
 *
 * The REAL `AuthMiddleware` → `ClerkAuthService` → `verifyClerkToken` → `@clerk/backend`'s `verifyToken`, over a token
 * genuinely RS256-signed by a key the booted app trusts, carrying the signed `public_metadata.suspended` mark identity
 * writes. The data access is a double that the refused request must never reach. The control matters: the SAME token
 * without the mark is served, so the 403 is the suspension rule and not a misconfigured key or `azp`.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { generateClerkKeypair, mintToken } from '../../../tests/support/jwt.js';
import { startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const AZP = 'https://recipes-suspended.example.com';
const OWNER = '01JSUSPENDED00000000000001';
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

const bearer = (suspended: boolean | undefined): string =>
    `Bearer ${mintToken(keypair.privateKeyPem, { sub: 'user_suspended', azp: AZP, externalId: OWNER, suspended })}`;

beforeAll(async () => {
    for (const key of ['CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES', 'RECIPE_DEV_AUTH_USER_ID']) {
        saved[key] = process.env[key];
    }

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

const createCollection = (authorization: string): Promise<Response> =>
    fetch(`${booted.baseUrl}/api/v1/collections`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Mine', visibility: 'public' }),
    });

describe('recipe-service — suspended account token (integration: real auth chain, mocked data access)', () => {
    it('⛔ answers 403 ACCOUNT_SUSPENDED to a validly signed suspended token, and writes nothing', async () => {
        const res = await createCollection(bearer(true));

        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
        expect(createIfUnderCap).not.toHaveBeenCalled();
    });

    it('control: the same token without the mark is served', async () => {
        const res = await createCollection(bearer(undefined));

        expect(res.status).toBe(201);
        expect(createIfUnderCap).toHaveBeenCalledTimes(1);
    });

    it('control: a null or false mark is served (the clear step writes null)', async () => {
        expect((await createCollection(bearer(false))).status).toBe(201);
    });

    it.each([
        ['POST', '/api/v1/account/erasure'],
        ['GET', '/api/v1/account/export'],
        ['GET', '/api/v1/recipes'],
    ])('lets a suspended account past authentication on %s %s', async (method, path) => {
        const res = await fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearer(true), 'content-type': 'application/json' },
            ...(method === 'POST' ? { body: '{}' } : {}),
        });

        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
    });
});

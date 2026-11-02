/**
 * `POST /api/v1/collections/{id}/pull-from-source` and `/preview` over the REAL HTTP pipeline, dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a). Audit finding 3: once the source has gone private, a pull answers 404 like a
 * clone does, and the membership read never runs.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const CLONER = '01JPULLHIDDEN0000000000001';
const SOURCE_OWNER = '01JPULLHIDDEN0000000000002';
const CLONE_ID = '00000000-0000-4000-8000-0000000000a1';
const SOURCE_ID = '00000000-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-01-01T00:00:00.000Z');

const row = (overrides: Record<string, unknown>) => ({
    description: null,
    sourceOwnerDisplayName: null,
    sourceCollectionName: null,
    lastPulledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
});

let food: FoodFake;
let booted: BootedServiceApp;
let sourceVisibility: 'public' | 'private' = 'public';

const previewMembershipIds = vi.fn(async () => ({ cloneIds: [], sourceIds: ['rec-new'] }));
const findById = vi.fn(async (id: string) =>
    id === CLONE_ID
        ? row({ id: CLONE_ID, ownerId: CLONER, name: 'My clone', visibility: 'public', sourceCollectionId: SOURCE_ID })
        : row({
              id: SOURCE_ID,
              ownerId: SOURCE_OWNER,
              name: 'Their list',
              visibility: sourceVisibility,
              sourceCollectionId: null,
          }),
);

async function post(path: string): Promise<Response> {
    return asPrincipal(CLONER, () =>
        fetch(`${booted.baseUrl}/api/v1/collections/${CLONE_ID}/${path}`, {
            method: 'POST',
            headers: { authorization: bearerFor(CLONER), 'content-type': 'application/json' },
            body: '{}',
        }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            { provide: CollectionsDal, useValue: { findById, previewMembershipIds } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    previewMembershipIds.mockClear();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('pulling from a source that has gone private (integration: real pipeline, mocked dependencies)', () => {
    it.each(['pull-from-source', 'pull-from-source/preview'])('404s POST %s and reads no memberships', async (path) => {
        sourceVisibility = 'private';

        const res = await post(path);

        expect(res.status).toBe(404);
        expect(previewMembershipIds).not.toHaveBeenCalled();
    });

    it('still previews while the source is public', async () => {
        sourceVisibility = 'public';

        const res = await post('pull-from-source/preview');

        expect(res.status).toBe(200);
        expect(previewMembershipIds).toHaveBeenCalledOnce();
    });
});

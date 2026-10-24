/**
 * `GET /api/v1/collections` over the REAL HTTP pipeline, its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the
 * real `AppModule` with the collections DAL doubled. W-11: each element of the list carries what its card shows about
 * its members — a recipe count and up to four cover URLs. The SQL that scopes both to what the caller may read is the
 * LOCAL e2e tier's (`tests/e2e/collections/memberSummaries.e2e.test.ts`); this file proves the wire half: the response
 * parses with the PUBLISHED list schema (so a client that parses it with the schema package accepts it), keys become
 * absolute CDN URLs, a collection the DAL knows nothing about is an honest `0` and `[]`, and no more than four covers
 * are ever answered.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { collectionListResponseSchema } from '@kitchensink/schema-recipe';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { CollectionsDal, type CollectionMemberSummary } from '../../../src/collections/dal/collections.dal.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JCOLLECTIONSLIST000000001';
const NOW = new Date('2026-01-01T00:00:00.000Z');

let food: FoodFake;
let booted: BootedServiceApp;

/** One stored collection row, as the DAL returns it. */
const row = (id: string, name: string) => ({
    id,
    ownerId: COOK,
    name,
    description: null,
    visibility: 'private' as const,
    sourceCollectionId: null,
    lastPulledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
});

const listByOwner = vi.fn();
const memberSummaries = vi.fn(
    async (): Promise<ReadonlyMap<string, CollectionMemberSummary>> =>
        new Map([
            ['col_full', { recipeCount: 9, coverKeys: ['k/1.jpg', 'k/2.jpg', 'k/3.jpg', 'k/4.jpg', 'k/5.jpg'] }],
            ['col_one', { recipeCount: 1, coverKeys: ['k/only.jpg'] }],
        ]),
);

/**
 * Read the cook's collections.
 *
 * @sideEffect One HTTP request.
 */
async function listCollections(): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/collections`, { headers: { authorization: bearerFor(COOK) } }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            { provide: CollectionsDal, useValue: { listByOwner, memberSummaries } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    listByOwner.mockReset();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('GET /api/v1/collections — the card summary (integration: real pipeline, mocked dependencies)', () => {
    it('answers a body the PUBLISHED list schema accepts, with each count and its covers as CDN URLs', async () => {
        listByOwner.mockResolvedValue({
            rows: [row('col_full', 'Weeknights'), row('col_one', 'One photo'), row('col_none', 'Empty')],
            total: 3,
        });

        const res = await listCollections();
        const body = collectionListResponseSchema.parse(await res.json());

        expect(res.status).toBe(200);
        expect(body.data.map((item) => item.recipeCount)).toEqual([9, 1, 0]);
        expect(body.data[1]?.coverPhotoUrls).toHaveLength(1);
        expect(body.data[1]?.coverPhotoUrls[0]).toMatch(/^https?:\/\/.+\/k\/only\.jpg$/u);
    });

    it('never answers more than four covers, whatever the DAL hands it', async () => {
        listByOwner.mockResolvedValue({ rows: [row('col_full', 'Weeknights')], total: 1 });

        const body = collectionListResponseSchema.parse(await (await listCollections()).json());

        expect(body.data[0]?.coverPhotoUrls).toHaveLength(4);
    });

    it('answers 0 and [] for a collection with no summary, rather than leaving the fields out', async () => {
        listByOwner.mockResolvedValue({ rows: [row('col_none', 'Empty')], total: 1 });

        const body = collectionListResponseSchema.parse(await (await listCollections()).json());

        expect(body.data[0]).toMatchObject({ recipeCount: 0, coverPhotoUrls: [] });
    });

    it('scopes the summary to the caller, who owns every collection listed', async () => {
        listByOwner.mockResolvedValue({ rows: [row('col_full', 'Weeknights')], total: 1 });

        await listCollections();

        expect(memberSummaries).toHaveBeenLastCalledWith(['col_full'], COOK);
    });
});

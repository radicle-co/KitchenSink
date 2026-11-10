/**
 * Unit tests for the author's publication doors on {@link FoodServiceClient} (ADR-0029 section 5 and 7): the own-food
 * list, asking staff, reading the newest request, and editing a food (`200` private, `202 editPending` public). Each
 * coded refusal maps to its own typed error, not to the generic `UnexpectedResponseError` the arm used before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetContractSkewLatchForTests } from '../contractSkew.js';
import {
    FoodServiceClient,
    PublicationNotApprovableError,
    PublicationNotRequestableError,
    PublicationRequestNotFoundError,
    isPublicationNotRequestableError,
    isPublicationRequestNotFoundError,
} from '../index.js';

const BASE = 'https://food.example.test';

beforeEach(() => {
    resetContractSkewLatchForTests();
});

function stubFetch(status: number, body?: unknown): typeof fetch {
    return vi.fn(
        async () => new Response(body === undefined ? undefined : JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;
}

function apiCalls(fetchMock: typeof fetch): [string, { method: string; body?: string }][] {
    return (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => !String(call[0]).endsWith('/health'),
    ) as [string, { method: string; body?: string }][];
}

const REQUEST = {
    id: 'req_1',
    foodId: 'food_1',
    versionNumber: 2,
    status: 'declined',
    declineReason: 'The calories look too low.',
    createdAt: '2026-11-09T10:00:00.000Z',
    decidedAt: '2026-11-09T11:00:00.000Z',
};
const SNAPSHOT = {
    name: 'Oat milk',
    description: null,
    macros: { calories: 120, proteinG: 3, carbsG: 16, fatG: 5 },
    portions: [],
};

describe('FoodServiceClient.listOwnFoods', () => {
    it('GETs the list, passes the cursor, and returns the items with the unseen-decision count', async () => {
        const body = {
            items: [{ id: 'f1', name: 'Oat milk', publicationState: 'asked', updatedAt: '2026-11-09T10:00:00.000Z' }],
            nextCursor: 'c2',
            unseenDecisions: 1,
        };
        const fetchMock = stubFetch(200, body);
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        await expect(client.listOwnFoods('c1')).resolves.toEqual(body);
        expect(apiCalls(fetchMock)[0]![0]).toBe(`${BASE}/api/v1/foods/authored?cursor=c1`);
    });

    it('asks with no query string for the first page', async () => {
        const fetchMock = stubFetch(200, { items: [], unseenDecisions: 0 });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        await client.listOwnFoods();

        expect(apiCalls(fetchMock)[0]![0]).toBe(`${BASE}/api/v1/foods/authored`);
    });
});

describe('FoodServiceClient.requestPublication / getPublicationRequest', () => {
    it('POSTs the ask and returns the request with its snapshot (200 when one is already open, 201 when new)', async () => {
        for (const status of [200, 201]) {
            const fetchMock = stubFetch(status, { request: { ...REQUEST, status: 'pending' }, snapshot: SNAPSHOT });
            const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

            const detail = await client.requestPublication('food_1');
            const [url, init] = apiCalls(fetchMock)[0]!;

            expect(detail.request.status).toBe('pending');
            expect(url).toBe(`${BASE}/api/v1/foods/authored/food_1/publication-request`);
            expect(init.method).toBe('POST');
        }
    });

    it('reads the newest request whatever its status, with the decline reason and the snapshot', async () => {
        const fetchMock = stubFetch(200, { request: REQUEST, snapshot: SNAPSHOT });
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const detail = await client.getPublicationRequest('food_1');

        expect(detail.request.declineReason).toBe('The calories look too low.');
        expect(apiCalls(fetchMock)[0]![1].method).toBe('GET');
    });

    it('maps PUBLICATION_NOT_REQUESTABLE to a typed error that carries the reason', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: stubFetch(409, {
                code: 'PUBLICATION_NOT_REQUESTABLE',
                message: 'no',
                details: { id: 'food_1', reason: 'declined' },
            }),
        });

        const error = await client.requestPublication('food_1').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(PublicationNotRequestableError);
        expect(isPublicationNotRequestableError(error)).toBe(true);
        expect((error as PublicationNotRequestableError).reason).toBe('declined');
    });

    it('maps PUBLICATION_REQUEST_NOT_FOUND to its own typed error', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: stubFetch(404, {
                code: 'PUBLICATION_REQUEST_NOT_FOUND',
                message: 'none',
                details: { id: 'food_1' },
            }),
        });

        const error = await client.getPublicationRequest('food_1').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(PublicationRequestNotFoundError);
        expect(isPublicationRequestNotFoundError(error)).toBe(true);
    });

    it('maps PUBLICATION_NOT_APPROVABLE (a staff door) to a typed error too, so the arm is no longer generic', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: stubFetch(409, {
                code: 'PUBLICATION_NOT_APPROVABLE',
                message: 'no',
                details: { id: 'food_1', reason: 'notNewest' },
            }),
        });

        await expect(client.getPublicationRequest('food_1')).rejects.toBeInstanceOf(PublicationNotApprovableError);
    });
});

describe('FoodServiceClient.updateAuthoredFood', () => {
    const INPUT = { name: 'Oat milk', macros: SNAPSHOT.macros };

    it('PUTs the edit; a private food answers 200 with the food and the edit applied', async () => {
        const food = {
            id: 'food_1',
            name: 'Oat milk',
            description: null,
            kind: 'generic',
            status: 'RESOLVED',
            nutrients: [],
            portions: [],
            provenance: {},
            variants: [],
        };
        const fetchMock = stubFetch(200, food);
        const client = new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const result = await client.updateAuthoredFood('food_1', INPUT);
        const [url, init] = apiCalls(fetchMock)[0]!;

        expect(result.kind).toBe('applied');
        expect(url).toBe(`${BASE}/api/v1/foods/food_1`);
        expect(init.method).toBe('PUT');
    });

    it('a public food answers 202 editPending, which is a result and not a failure', async () => {
        const client = new FoodServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: stubFetch(202, { publication: { state: 'editPending', versionNumber: 3 } }),
        });

        await expect(client.updateAuthoredFood('food_1', INPUT)).resolves.toEqual({
            kind: 'editPending',
            versionNumber: 3,
        });
    });
});

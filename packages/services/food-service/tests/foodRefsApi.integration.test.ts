/**
 * `POST /api/v1/foods/refs/resolve` over a real HTTP request, with the DAO DOUBLED (§7.1a: integration mocks
 * its dependencies). Booted by `support/mockedFoodsApi.ts`: the real auth guard, pipe, controller, service,
 * resolution policy and exception filter; no database.
 *
 * | Requirement (curated plan U8, roots slice; blueprint step 2) | Pinned here |
 * | --- | --- |
 * | `Cache-Control: private, no-store`, `200` not POST's `201` | the headers and status Nest actually sends |
 * | the route is reachable, not swallowed by a `:id` route | a `POST` to the path answers the resolver's body |
 * | "the resolver refuses an empty, over-limit or malformed batch" | `400 VALIDATION_FAILED` from the REAL pipe, and the DAO never read |
 * | the verified requester reaches the policy | author finds, stranger and `svc_*` get `absent`, unsynced defers `401` |
 * | "the entry for an unknown id equals the entry for another user's private food" | byte-equal RAW response bodies |
 * | the DAO is read once, for the distinct root ids | the double's call log |
 *
 * What the database does with the read is `tests/e2e/foodRefsResolve.e2e.test.ts`'s job.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { makeFoodRefFacts, makePrivateFoodRefFacts } from '../src/foods/__fixtures__/foodRefFacts.js';
import type { VariantFacts } from '../src/foods/dao/foodVariant.dao.js';
import type { FoodRefFacts } from '../src/foods/dao/food.dao.js';
import { foodErrorSchema, MAX_FOOD_REFS, resolveFoodRefsResponseSchema } from '../src/foods/foods.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);
const PATH = '/api/v1/foods/refs/resolve';

const PRIVATE_ID = '01JPR1VATEF00D000000000000';
const CATALOG_ID = '01JCATA10GF00D000000000000';

describe('POST /api/v1/foods/refs/resolve (booted Nest, DAO doubled)', () => {
    /** The rows the doubled DAO answers with; each case sets it. */
    let rows: FoodRefFacts[] = [];
    const readRefFacts = vi.fn(async (ids: readonly string[]) => rows.filter((row) => ids.includes(row.id)));
    /** Curated U8 S5: the variants the doubled variant table holds — one live cut of the catalog food. */
    const variantRows: VariantFacts[] = [
        {
            id: 'V-floret',
            rootId: CATALOG_ID,
            retired: false,
            parts: [{ attribute: 'cut', ordinal: 0, text: 'florets' }],
        },
    ];
    const readFacts = vi.fn(async (ids: readonly string[]) => variantRows.filter((row) => ids.includes(row.id)));
    let api: MockedFoodsApi;

    beforeAll(async () => {
        // The REAL owner reader runs over these doubles (the harness's default), so this tier exercises its composition.
        api = await bootMockedFoodsApi({ foodDao: { readRefFacts }, variants: { readFacts } });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        rows = [
            makeFoodRefFacts({ id: CATALOG_ID, name: 'Broccoli, raw' }),
            makePrivateFoodRefFacts({ id: PRIVATE_ID }),
        ];
        readRefFacts.mockClear();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('answers 200 (not POST’s 201) with private, no-store — a per-caller body no cache may keep', async () => {
        const res = await api.call('POST', PATH, {
            token: 'author',
            body: { refs: [{ kind: 'root', id: CATALOG_ID }] },
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(resolveFoodRefsResponseSchema.parse(res.body)).toStrictEqual({
            entries: [
                { outcome: 'found', ref: { kind: 'root', id: CATALOG_ID }, name: 'Broccoli, raw', status: 'RESOLVED' },
            ],
        });
    });

    it('reads the distinct ROOT ids once, and answers each distinct ref in first-appearance order', async () => {
        const res = await api.call('POST', PATH, {
            token: 'author',
            body: {
                refs: [
                    { kind: 'variant', id: 'v-1' },
                    { kind: 'root', id: PRIVATE_ID },
                    { kind: 'root', id: CATALOG_ID },
                    { kind: 'root', id: PRIVATE_ID },
                ],
            },
        });

        expect(readRefFacts).toHaveBeenCalledTimes(1);
        expect(readRefFacts).toHaveBeenCalledWith([PRIVATE_ID, CATALOG_ID]);
        expect((res.body as { entries: { outcome: string; ref: { id: string } }[] }).entries).toStrictEqual([
            { outcome: 'absent', ref: { kind: 'variant', id: 'v-1' } },
            {
                outcome: 'found',
                ref: { kind: 'root', id: PRIVATE_ID },
                name: 'Grandma’s spice mix',
                status: 'RESOLVED',
                visibility: 'private',
            },
            { outcome: 'found', ref: { kind: 'root', id: CATALOG_ID }, name: 'Broccoli, raw', status: 'RESOLVED' },
        ]);
    });

    it('S5: a variant ref is found under its root, through the real owner reader, in the published shape', async () => {
        const res = await api.call('POST', PATH, {
            token: 'stranger',
            body: { refs: [{ kind: 'variant', id: 'V-floret' }] },
        });

        expect(res.status).toBe(200);
        expect(resolveFoodRefsResponseSchema.parse(res.body)).toStrictEqual({
            entries: [
                {
                    outcome: 'found',
                    ref: { kind: 'variant', id: 'V-floret' },
                    name: 'Broccoli, raw',
                    status: 'RESOLVED',
                    variant: { rootId: CATALOG_ID, parts: [{ attribute: 'cut', text: 'florets' }] },
                },
            ],
        });
    });

    describe('the verified requester is who the policy decides over', () => {
        const body = { refs: [{ kind: 'root', id: PRIVATE_ID }] };

        it('the author finds their private food', async () => {
            const res = await api.call('POST', PATH, { token: 'author', body });

            expect(res.body).toMatchObject({ entries: [{ outcome: 'found', visibility: 'private' }] });
        });

        it.each(['stranger', 'service'])('⛔ the %s gets absent', async (token) => {
            const res = await api.call('POST', PATH, { token, body });

            expect(res.body).toStrictEqual({ entries: [{ outcome: 'absent', ref: { kind: 'root', id: PRIVATE_ID } }] });
        });

        it('an unsynced user token DEFERS with 401 IDENTITY_SYNC_PENDING, and nothing is read', async () => {
            const res = await api.call('POST', PATH, { token: 'unsynced', body });

            expect(res.status).toBe(401);
            expect(foodErrorSchema.parse(res.body).code).toBe('IDENTITY_SYNC_PENDING');
            expect(readRefFacts).not.toHaveBeenCalled();
        });

        it('no token is 401 before any work', async () => {
            const res = await api.call('POST', PATH, { body });

            expect(res.status).toBe(401);
            expect(readRefFacts).not.toHaveBeenCalled();
        });
    });

    it('⛔ a stranger’s private food and an unknown id answer BYTE-EQUAL bodies (same ref, row present vs gone)', async () => {
        const body = { refs: [{ kind: 'root', id: PRIVATE_ID }] };

        const concealed = await api.call('POST', PATH, { token: 'stranger', body });
        rows = rows.filter((row) => row.id !== PRIVATE_ID);
        const unknown = await api.call('POST', PATH, { token: 'stranger', body });

        expect(concealed.status).toBe(200);
        expect(concealed.text).toBe(unknown.text);
    });

    describe('the REAL pipe refuses a body the contract refuses — 400 VALIDATION_FAILED, nothing read', () => {
        it.each([
            ['an empty refs list', { refs: [] }],
            [
                'one ref over the cap',
                { refs: Array.from({ length: MAX_FOOD_REFS + 1 }, (_, index) => ({ kind: 'root', id: `f-${index}` })) },
            ],
            ['an unknown kind', { refs: [{ kind: 'forward', id: 'x' }] }],
            ['an unknown key on a ref', { refs: [{ kind: 'root', id: 'x', ownerId: 'someone-else' }] }],
            ['no body at all', undefined],
        ])('%s', async (_label, body) => {
            const res = await api.call('POST', PATH, { token: 'author', body });

            expect(res.status).toBe(400);
            expect(foodErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
            expect(readRefFacts).not.toHaveBeenCalled();
        });

        it('accepts exactly the cap (positive control for the over-cap case)', async () => {
            const refs = Array.from({ length: MAX_FOOD_REFS }, (_, index) => ({ kind: 'root', id: `f-${index}` }));

            expect((await api.call('POST', PATH, { token: 'author', body: { refs } })).status).toBe(200);
        });
    });
});

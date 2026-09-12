/**
 * `FoodFilterExpansionGateway` — a recipe filter on a ROOT also matches lines bound to its live variants (curated plan
 * U9; ADR-0006 forbids the join into food's database, so the root is expanded through food's own read of it).
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | one expansion wave | every root is asked at once, as the caller |
 * | a definite answer that names no variant | a pending root (202), an unknown root (404) or a malformed id (400) expands to nothing |
 * | ⛔ never a partial filter | any other failure, or no caller to ask as, is `502 SOURCE_UNAVAILABLE` |
 */
import { describe, expect, it, vi } from 'vitest';
import { BadRequestError, NotFoundError, UnexpectedResponseError } from '@kitchensink/food-service-client';

import { CALLER_TOKEN as CALLER, makeFoodClients } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import { FoodFilterExpansionGateway } from '../foodFilterExpansion.gateway.js';

/** Food's `GET /{id}` for a resolved root with these live variant ids. */
function resolvedRoot(id: string, variantIds: readonly string[]) {
    return {
        status: 'RESOLVED' as const,
        food: {
            id,
            name: id,
            description: null,
            kind: 'generic',
            status: 'RESOLVED' as const,
            nutrients: [],
            portions: [],
            provenance: {},
            variants: variantIds.map((variantId) => ({
                id: variantId,
                parts: [{ attribute: 'cut', text: variantId }],
            })),
        },
    };
}

describe('FoodFilterExpansionGateway.expand', () => {
    it('expands each root to its live variant ids, asking food AS THE CALLER, every root in ONE wave', async () => {
        const { clients, mocks, standard } = makeFoodClients();
        const pending: Array<() => void> = [];

        mocks.getById.mockImplementation(
            (id: string) =>
                new Promise((resolve) => {
                    pending.push(() => resolve(resolvedRoot(id, id === 'R-brisket' ? ['V-flat', 'V-point'] : [])));
                }),
        );

        const expansion = new FoodFilterExpansionGateway(clients).expand(CALLER, ['R-brisket', 'R-onion']);

        // Both requests are in flight before either answers: one wave, not a sequence.
        await vi.waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(2));
        pending.forEach((release) => release());

        expect(await expansion).toStrictEqual({ rootIds: ['R-brisket', 'R-onion'], variantIds: ['V-flat', 'V-point'] });
        expect(standard).toHaveBeenCalledWith(CALLER);
    });

    it.each([
        ['a pending root (202)', async () => ({ id: 'R-new', status: 'PENDING' as const, estimatedWaitSeconds: 5 })],
        ['an unknown or concealed root (404)', async () => Promise.reject(new NotFoundError('R-new'))],
        ['a malformed id (400)', async () => Promise.reject(new BadRequestError('invalid id'))],
    ])('expands %s to no variants — the root still filters on its own', async (_, answer) => {
        const { clients, mocks } = makeFoodClients();
        mocks.getById.mockImplementation(answer);

        expect(await new FoodFilterExpansionGateway(clients).expand(CALLER, ['R-new'])).toStrictEqual({
            rootIds: ['R-new'],
            variantIds: [],
        });
    });

    it.each([
        ['a transport failure', new Error('socket hang up')],
        ['a 5xx', new UnexpectedResponseError(503, 'food is down')],
    ])('⛔ answers %s with 502 SOURCE_UNAVAILABLE — never a filter missing some variants', async (_, error) => {
        const { clients, mocks } = makeFoodClients();
        mocks.getById.mockImplementation(async (id: string) =>
            id === 'R-down' ? Promise.reject(error) : resolvedRoot(id, ['V-1']),
        );

        await expect(new FoodFilterExpansionGateway(clients).expand(CALLER, ['R-ok', 'R-down'])).rejects.toMatchObject({
            response: { code: 'SOURCE_UNAVAILABLE' },
        });
    });

    it('⛔ with no caller credential it asks food nothing and answers 502 — no credential is substituted', async () => {
        const { clients, mocks } = makeFoodClients();

        await expect(new FoodFilterExpansionGateway(clients).expand(undefined, ['R-1'])).rejects.toMatchObject({
            response: { code: 'SOURCE_UNAVAILABLE' },
        });
        expect(mocks.getById).not.toHaveBeenCalled();
    });

    it('asks food nothing for no roots', async () => {
        const { clients, mocks } = makeFoodClients();

        expect(await new FoodFilterExpansionGateway(clients).expand(undefined, [])).toStrictEqual({
            rootIds: [],
            variantIds: [],
        });
        expect(mocks.getById).not.toHaveBeenCalled();
    });
});

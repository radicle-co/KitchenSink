/**
 * Stage-2 F2 — unit tests for {@link FoodCatalogGateway}, the availability-disciplined Gateway in front of
 * food-service's `/v1/foods/search` on the per-keystroke typeahead path.
 *
 * The load-bearing contract this suite pins is NEGATIVE: the gateway must NEVER throw and never return a
 * rejected promise, whatever the food service does (timeout, 5xx, auth failure, malformed payload). Every
 * failure degrades to `{ hits: [], availability: 'unavailable' }` so the caller can always render the
 * recipe-local section. Written before the gateway existed (TDD red → green).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchUnavailableError, UnauthorizedError } from '@kitchensink/food-service-client';
import type { FoodServiceClient } from '@kitchensink/food-service-client';

import { FoodCatalogGateway } from '../food-catalog.gateway.js';
import { makeSearchResultView } from '../__fixtures__/ingredients.fixtures.js';

/** A `FoodServiceClient` double exposing only the one method the gateway is allowed to call. */
function makeFoodClient(): { client: FoodServiceClient; search: ReturnType<typeof vi.fn> } {
    const search = vi.fn();

    return { client: { search } as unknown as FoodServiceClient, search };
}

describe('FoodCatalogGateway', () => {
    let client: FoodServiceClient;
    let search: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        ({ client, search } = makeFoodClient());
    });

    describe('when enabled and food-service answers', () => {
        it('maps hits to catalog hits, highest score first', async () => {
            search.mockResolvedValue({
                results: [
                    makeSearchResultView({ id: 'food-low', name: 'Chicken thigh', score: 0.2 }),
                    makeSearchResultView({ id: 'food-high', name: 'Chicken breast', score: 0.9 }),
                ],
            });
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            const outcome = await gateway.search('chicken', 10);

            expect(outcome.availability).toBe('ok');
            expect(outcome.hits).toEqual([
                { foodId: 'food-high', name: 'Chicken breast', score: 0.9 },
                { foodId: 'food-low', name: 'Chicken thigh', score: 0.2 },
            ]);
        });

        it('breaks score ties on name so the ordering is deterministic', async () => {
            search.mockResolvedValue({
                results: [
                    makeSearchResultView({ id: 'food-b', name: 'Beta', score: 0.5 }),
                    makeSearchResultView({ id: 'food-a', name: 'Alpha', score: 0.5 }),
                ],
            });
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            const outcome = await gateway.search('x', 10);

            expect(outcome.hits.map((hit) => hit.foodId)).toEqual(['food-a', 'food-b']);
        });

        it('drops hits whose golden name is null or blank (unrenderable, unpickable)', async () => {
            search.mockResolvedValue({
                results: [
                    makeSearchResultView({ id: 'food-null', name: null, score: 0.99 }),
                    makeSearchResultView({ id: 'food-blank', name: '   ', score: 0.98 }),
                    makeSearchResultView({ id: 'food-ok', name: 'Chicken breast', score: 0.1 }),
                ],
            });
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            const outcome = await gateway.search('chicken', 10);

            expect(outcome.hits).toEqual([{ foodId: 'food-ok', name: 'Chicken breast', score: 0.1 }]);
        });

        it('trims the golden name', async () => {
            search.mockResolvedValue({ results: [makeSearchResultView({ name: '  Chicken breast  ' })] });
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            const outcome = await gateway.search('chicken', 10);

            expect(outcome.hits[0]?.name).toBe('Chicken breast');
        });

        it('truncates to the requested limit AFTER ranking (keeps the best, not the first returned)', async () => {
            search.mockResolvedValue({
                results: [
                    makeSearchResultView({ id: 'food-1', name: 'One', score: 0.1 }),
                    makeSearchResultView({ id: 'food-2', name: 'Two', score: 0.2 }),
                    makeSearchResultView({ id: 'food-3', name: 'Three', score: 0.3 }),
                ],
            });
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            const outcome = await gateway.search('x', 2);

            expect(outcome.hits.map((hit) => hit.foodId)).toEqual(['food-3', 'food-2']);
        });

        it('passes the query through verbatim and calls food-service exactly once', async () => {
            search.mockResolvedValue({ results: [] });
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            await gateway.search('chicken breast', 10);

            expect(search).toHaveBeenCalledTimes(1);
            expect(search).toHaveBeenCalledWith('chicken breast');
        });

        it('reports `ok` with no hits when food-service has no local match', async () => {
            search.mockResolvedValue({ results: [] });
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            expect(await gateway.search('zzzz', 10)).toEqual({ hits: [], availability: 'ok' });
        });
    });

    describe('short-circuits (no cross-service call at all)', () => {
        it('returns `disabled` without calling food-service when the blend is switched off', async () => {
            const gateway = new FoodCatalogGateway(client, { enabled: false });

            expect(await gateway.search('chicken', 10)).toEqual({ hits: [], availability: 'disabled' });
            expect(search).not.toHaveBeenCalled();
        });

        it('returns `ok` with no hits for a blank query without calling food-service', async () => {
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            expect(await gateway.search('   ', 10)).toEqual({ hits: [], availability: 'ok' });
            expect(search).not.toHaveBeenCalled();
        });

        it('returns `ok` with no hits for a non-positive limit without calling food-service', async () => {
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            expect(await gateway.search('chicken', 0)).toEqual({ hits: [], availability: 'ok' });
            expect(search).not.toHaveBeenCalled();
        });
    });

    describe('F2 degradation — every failure mode resolves to `unavailable`, never throws', () => {
        it('degrades on a client timeout / transport abort (the case the short timeout produces)', async () => {
            search.mockRejectedValue(new FetchUnavailableError(undefined, 'aborted'));
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            expect(await gateway.search('chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('degrades on an auth failure (a misconfigured M2M token must not break the typeahead)', async () => {
            search.mockRejectedValue(new UnauthorizedError('nope'));
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            expect(await gateway.search('chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('degrades on a non-Error rejection', async () => {
            search.mockRejectedValue('boom');
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            expect(await gateway.search('chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('degrades on a malformed payload (missing `results`) instead of throwing a TypeError', async () => {
            search.mockResolvedValue({} as never);
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            expect(await gateway.search('chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('degrades on a payload whose `results` is not an array', async () => {
            search.mockResolvedValue({ results: 'nope' } as never);
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            expect(await gateway.search('chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('skips a structurally invalid row rather than failing the whole outcome', async () => {
            search.mockResolvedValue({
                results: [{ id: 42, name: 'Bad id', score: 0.9 }, makeSearchResultView({ id: 'food-ok' })] as never,
            });
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            const outcome = await gateway.search('chicken', 10);

            expect(outcome.availability).toBe('ok');
            expect(outcome.hits.map((hit) => hit.foodId)).toEqual(['food-ok']);
        });

        it('recovers on the next call — a transient failure is not sticky', async () => {
            search.mockRejectedValueOnce(new FetchUnavailableError(undefined, 'aborted'));
            search.mockResolvedValueOnce({ results: [makeSearchResultView({ id: 'food-ok' })] });
            const gateway = new FoodCatalogGateway(client, { enabled: true });

            expect((await gateway.search('chicken', 10)).availability).toBe('unavailable');
            expect((await gateway.search('chicken', 10)).availability).toBe('ok');
        });
    });
});

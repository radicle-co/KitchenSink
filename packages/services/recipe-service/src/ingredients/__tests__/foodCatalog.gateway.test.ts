/**
 * Stage-2 F2 — unit tests for {@link FoodCatalogGateway}, the availability-disciplined Gateway in front of
 * food-service's `/api/v1/foods/search` on the per-keystroke typeahead path.
 *
 * The load-bearing contract this suite pins is NEGATIVE: the gateway must NEVER throw and never return a
 * rejected promise, whatever the food service does (timeout, 5xx, auth failure, malformed payload). Every
 * failure degrades to `{ hits: [], availability: 'unavailable' }` so the caller can always render the
 * recipe-local section. Written before the gateway existed (TDD red → green).
 *
 * Since issue #120 the gateway also carries the CALLER's credential (it calls food as the user, not with a
 * service token), so two further properties are pinned here: the caller's token is what reaches the client
 * factory, and a caller with NO credential degrades exactly like a down food service — without issuing a
 * request that could only 401 (which on a per-keystroke path would drive food's per-source 401 shedder).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { FetchUnavailableError, SourceUnavailableError, UnauthorizedError } from '@kitchensink/food-service-client';
import type { FoodServiceClient } from '@kitchensink/food-service-client';
import { tieredRelevanceScore } from '@kitchensink/recipe-core/resolution/ranking-tiers';

import { CallerToken } from '../../auth/CallerToken.js';
import { FoodCatalogGateway } from '../foodCatalog.gateway.js';
import type { FoodServiceClients } from '../FoodServiceClients.factory.js';
import { makeSearchResultView } from '../__fixtures__/ingredients.fixtures.js';

/**
 * The score food-service assigns a barcode / external-key crosswalk hit.
 *
 * ⚠️ Duplicated here deliberately, and it is the wire contract that makes that safe rather than sloppy:
 * `foods.schema.ts` documents the search score as "trigram similarity; `1` for a barcode/external-key
 * crosswalk hit", and `FoodsService.search` unshifts at exactly that value. This test exists BECAUSE the
 * invariant spans two services and neither one's own suite can see it.
 */
const CROSSWALK_SCORE = 1;

/** The caller credential every non-degenerate case forwards. */
const CALLER = CallerToken.fromAuthorizationHeader('Bearer caller-session-jwt') as CallerToken;

/**
 * A {@link FoodServiceClients} double: records which caller a client was minted for and exposes only the one
 * client method the gateway is allowed to call.
 */
function makeFoodClients(): {
    clients: FoodServiceClients;
    search: ReturnType<typeof vi.fn>;
    typeahead: ReturnType<typeof vi.fn>;
} {
    const search = vi.fn();
    const typeahead = vi.fn(() => ({ search }) as unknown as FoodServiceClient);
    const standard = vi.fn(() => {
        throw new Error('the typeahead path must never use the 8s standard client');
    });

    return { clients: { typeahead, standard } as unknown as FoodServiceClients, search, typeahead };
}

describe('FoodCatalogGateway', () => {
    let clients: FoodServiceClients;
    let search: ReturnType<typeof vi.fn>;
    let typeahead: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        ({ clients, search, typeahead } = makeFoodClients());
    });

    describe('when enabled and food-service answers', () => {
        it('maps hits to catalog hits, highest score first', async () => {
            search.mockResolvedValue({
                results: [
                    makeSearchResultView({ id: 'food-low', name: 'Chicken thigh', score: 0.2 }),
                    makeSearchResultView({ id: 'food-high', name: 'Chicken breast', score: 0.9 }),
                ],
            });
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            const outcome = await gateway.search(CALLER, 'chicken', 10);

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
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            const outcome = await gateway.search(CALLER, 'x', 10);

            expect(outcome.hits.map((hit) => hit.foodId)).toEqual(['food-a', 'food-b']);
        });

        it('⛔ keeps an exact CROSSWALK hit first, ahead of the best possible TIERED score (U5)', async () => {
            // A cross-service invariant with nothing but arithmetic holding it up. `FoodsService.search`
            // unshifts a barcode / external-key crosswalk hit — an exact IDENTIFIER match — at score exactly
            // `1`, and this gateway then re-sorts the page by score, discarding that position. It stays
            // correct only because U5 normalizes the whole tier ladder into `[0, 1)`. `BEST_TIERED` below is
            // the largest score `tieredRelevanceScore` can produce; if a future weight edit pushed it past
            // 1, an exact barcode match would start ranking below a fuzzy name match, and neither service's
            // own tests would notice because the defect only exists where the two meet.
            const BEST_TIERED = tieredRelevanceScore({ tier: 'exact', baseMetric: 1, rawAffinity: true });

            expect(BEST_TIERED).toBeLessThan(CROSSWALK_SCORE);

            search.mockResolvedValue({
                results: [
                    makeSearchResultView({ id: 'food-crosswalk', name: 'Zebra bar', score: CROSSWALK_SCORE }),
                    makeSearchResultView({ id: 'food-lexical', name: 'Alpha exact', score: BEST_TIERED }),
                ],
            });
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            const outcome = await gateway.search(CALLER, 'x', 10);

            // Named `Zebra bar` on purpose: if the scores ever tie, `name ASC` puts it LAST, so this case
            // cannot pass by accident on the tiebreak.
            expect(outcome.hits.map((hit) => hit.foodId)).toEqual(['food-crosswalk', 'food-lexical']);
        });

        it('drops hits whose golden name is null or blank (unrenderable, unpickable)', async () => {
            search.mockResolvedValue({
                results: [
                    makeSearchResultView({ id: 'food-null', name: null, score: 0.99 }),
                    makeSearchResultView({ id: 'food-blank', name: '   ', score: 0.98 }),
                    makeSearchResultView({ id: 'food-ok', name: 'Chicken breast', score: 0.1 }),
                ],
            });
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            const outcome = await gateway.search(CALLER, 'chicken', 10);

            expect(outcome.hits).toEqual([{ foodId: 'food-ok', name: 'Chicken breast', score: 0.1 }]);
        });

        it('trims the golden name', async () => {
            search.mockResolvedValue({ results: [makeSearchResultView({ name: '  Chicken breast  ' })] });
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            const outcome = await gateway.search(CALLER, 'chicken', 10);

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
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            const outcome = await gateway.search(CALLER, 'x', 2);

            expect(outcome.hits.map((hit) => hit.foodId)).toEqual(['food-3', 'food-2']);
        });

        it('passes the query through verbatim and calls food-service exactly once', async () => {
            search.mockResolvedValue({ results: [] });
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            await gateway.search(CALLER, 'chicken breast', 10);

            expect(search).toHaveBeenCalledTimes(1);
            expect(search).toHaveBeenCalledWith('chicken breast');
        });

        it('reports `ok` with no hits when food-service has no local match', async () => {
            search.mockResolvedValue({ results: [] });
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            expect(await gateway.search(CALLER, 'zzzz', 10)).toEqual({ hits: [], availability: 'ok' });
        });
    });

    describe('caller-credential forwarding (issue #120)', () => {
        it('mints the typeahead client for THIS caller (the token forwarded is the one recipe verified)', async () => {
            search.mockResolvedValue({ results: [] });
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            await gateway.search(CALLER, 'chicken', 10);

            expect(typeahead).toHaveBeenCalledTimes(1);
            expect(typeahead).toHaveBeenCalledWith(CALLER);
        });

        it('degrades to local-only when the caller has NO credential, WITHOUT calling food-service', async () => {
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            // Honest degradation, not a 500 and not a swap to some other credential. And no request: a call
            // with no bearer could only 401, and on a per-keystroke path that would feed food's per-source
            // 401 load-shedder (FR-052) — turning our own misconfiguration into a denial of food's auth.
            expect(await gateway.search(undefined, 'chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
            expect(typeahead).not.toHaveBeenCalled();
            expect(search).not.toHaveBeenCalled();
        });

        it('never logs the caller credential when it degrades', async () => {
            search.mockRejectedValue(new UnauthorizedError('nope'));
            const gateway = new FoodCatalogGateway(clients, { enabled: true });
            const logged: string[] = [];

            const capture = (message: unknown): void => {
                logged.push(String(message));
            };

            vi.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
            vi.spyOn(Logger.prototype, 'debug').mockImplementation(capture);

            await gateway.search(CALLER, 'chicken', 10);
            await gateway.search(undefined, 'chicken', 10);

            expect(logged.length).toBeGreaterThan(0);
            expect(logged.join('\n')).not.toContain('caller-session-jwt');
            vi.restoreAllMocks();
        });
    });

    describe('short-circuits (no cross-service call at all)', () => {
        it('returns `disabled` without calling food-service when the blend is switched off', async () => {
            const gateway = new FoodCatalogGateway(clients, { enabled: false });

            expect(await gateway.search(CALLER, 'chicken', 10)).toEqual({ hits: [], availability: 'disabled' });
            expect(search).not.toHaveBeenCalled();
        });

        it('returns `ok` with no hits for a blank query without calling food-service', async () => {
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            expect(await gateway.search(CALLER, '   ', 10)).toEqual({ hits: [], availability: 'ok' });
            expect(search).not.toHaveBeenCalled();
        });

        it('returns `ok` with no hits for a non-positive limit without calling food-service', async () => {
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            expect(await gateway.search(CALLER, 'chicken', 0)).toEqual({ hits: [], availability: 'ok' });
            expect(search).not.toHaveBeenCalled();
        });
    });

    describe('F2 degradation — every failure mode resolves to `unavailable`, never throws', () => {
        it('degrades on a client timeout / transport abort (the case the short timeout produces)', async () => {
            search.mockRejectedValue(new FetchUnavailableError(undefined, 'aborted'));
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            expect(await gateway.search(CALLER, 'chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('degrades on an auth failure (a misconfigured M2M token must not break the typeahead)', async () => {
            search.mockRejectedValue(new UnauthorizedError('nope'));
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            expect(await gateway.search(CALLER, 'chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('degrades on a non-Error rejection', async () => {
            search.mockRejectedValue('boom');
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            expect(await gateway.search(CALLER, 'chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('degrades on a malformed payload (missing `results`) instead of throwing a TypeError', async () => {
            search.mockResolvedValue({} as never);
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            expect(await gateway.search(CALLER, 'chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('degrades on a payload whose `results` is not an array', async () => {
            search.mockResolvedValue({ results: 'nope' } as never);
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            expect(await gateway.search(CALLER, 'chicken', 10)).toEqual({ hits: [], availability: 'unavailable' });
        });

        it('skips a structurally invalid row rather than failing the whole outcome', async () => {
            search.mockResolvedValue({
                results: [{ id: 42, name: 'Bad id', score: 0.9 }, makeSearchResultView({ id: 'food-ok' })] as never,
            });
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            const outcome = await gateway.search(CALLER, 'chicken', 10);

            expect(outcome.availability).toBe('ok');
            expect(outcome.hits.map((hit) => hit.foodId)).toEqual(['food-ok']);
        });

        it('recovers on the next call — a transient failure is not sticky', async () => {
            search.mockRejectedValueOnce(new FetchUnavailableError(undefined, 'aborted'));
            search.mockResolvedValueOnce({ results: [makeSearchResultView({ id: 'food-ok' })] });
            const gateway = new FoodCatalogGateway(clients, { enabled: true });

            expect((await gateway.search(CALLER, 'chicken', 10)).availability).toBe('unavailable');
            expect((await gateway.search(CALLER, 'chicken', 10)).availability).toBe('ok');
        });
    });
});

/**
 * `searchLive` — the ON-DEMAND source search (plan U29), the gateway's second, deliberately different path.
 *
 * ⛔ **It stays TOTAL like `search`, but it must NOT collapse its failures into one value.** `search` may
 * degrade everything to `unavailable` because its result is strictly ADDITIVE — the local section renders
 * regardless and the cook loses nothing they asked for. Here the cook explicitly pressed a button, so the
 * three outcomes ARE the product: "the source has nothing" (stop looking), "busy, try again" (our reserved
 * lane, or a source 429), and "the source did not answer" (no known recovery window). Collapsing any pair
 * strands them in the wrong loop, which is why the outcome is a discriminated union rather than a boolean.
 *
 * ⚠️ It also takes the STANDARD (8s) client, never the typeahead one: this is the acknowledged SLOW path —
 * a multi-second wait is the expected experience — and a sub-second deadline would turn every real answer
 * into a fabricated "the source did not answer".
 */
describe('FoodCatalogGateway.searchLive (plan U29)', () => {
    let liveClients: FoodServiceClients;
    let searchLive: ReturnType<typeof vi.fn>;
    let standard: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        searchLive = vi.fn();
        standard = vi.fn(() => ({ searchLive }) as unknown as FoodServiceClient);
        const shortClient = vi.fn(() => {
            throw new Error('the live-search path must never use the SHORT typeahead client');
        });

        liveClients = { standard, typeahead: shortClient } as unknown as FoodServiceClients;
    });

    /** A gateway with the blend switched on. */
    function enabledGateway(): FoodCatalogGateway {
        return new FoodCatalogGateway(liveClients, { enabled: true });
    }

    it('uses the STANDARD client, because a multi-second source call is the expected experience', async () => {
        searchLive.mockResolvedValue({ results: [] });

        await enabledGateway().searchLive(CALLER, 'broccoli');

        // The typeahead factory throws if touched — a sub-second deadline here would manufacture failures.
        expect(standard).toHaveBeenCalledTimes(1);
        expect(standard.mock.calls[0]?.[0]).toBe(CALLER);
    });

    it('returns the hits, mapping the food service’s `id` to this service’s `foodId` vocabulary', async () => {
        searchLive.mockResolvedValue({
            results: [{ name: 'Broccoli, raw', id: 'food_1' }, { name: 'Broccoli rabe' }],
        });

        await expect(enabledGateway().searchLive(CALLER, 'broccoli')).resolves.toEqual({
            kind: 'results',
            hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }, { name: 'Broccoli rabe' }],
        });
    });

    it('reports an EMPTY result set as results, not as a failure — the source answered', async () => {
        searchLive.mockResolvedValue({ results: [] });

        // ⛔ The distinction the whole surface turns on: "nothing found" is an answer.
        await expect(enabledGateway().searchLive(CALLER, 'nosuchfood')).resolves.toEqual({
            kind: 'results',
            hits: [],
        });
    });

    it('reports BUSY when food refuses on the rate budget, carrying the retry window', async () => {
        searchLive.mockRejectedValue(new FetchUnavailableError(60, 'shed'));

        await expect(enabledGateway().searchLive(CALLER, 'broccoli')).resolves.toEqual({
            kind: 'busy',
            retryAfterSeconds: 60,
        });
    });

    it('reports UNAVAILABLE when the upstream source did not answer', async () => {
        searchLive.mockRejectedValue(new SourceUnavailableError('The food data source is unavailable'));

        await expect(enabledGateway().searchLive(CALLER, 'broccoli')).resolves.toEqual({ kind: 'unavailable' });
    });

    it('reports UNAVAILABLE for any other failure, rather than throwing at the caller', async () => {
        searchLive.mockRejectedValue(new UnauthorizedError('nope'));

        await expect(enabledGateway().searchLive(CALLER, 'broccoli')).resolves.toEqual({ kind: 'unavailable' });
    });

    it('reports UNAVAILABLE on a malformed payload rather than leaking it to the caller', async () => {
        searchLive.mockResolvedValue({ nope: true });

        await expect(enabledGateway().searchLive(CALLER, 'broccoli')).resolves.toEqual({ kind: 'unavailable' });
    });

    it('drops a nameless hit rather than rendering an unpickable row', async () => {
        searchLive.mockResolvedValue({ results: [{ name: '   ', id: 'food_1' }, { name: 'Broccoli, raw' }] });

        await expect(enabledGateway().searchLive(CALLER, 'broccoli')).resolves.toEqual({
            kind: 'results',
            hits: [{ name: 'Broccoli, raw' }],
        });
    });

    it('degrades WITHOUT issuing a request when the caller has no credential', async () => {
        await expect(enabledGateway().searchLive(undefined, 'broccoli')).resolves.toEqual({ kind: 'unavailable' });
        // An unauthenticated call could only 401, and food sheds on 401 volume (FR-052).
        expect(standard).not.toHaveBeenCalled();
    });

    it('reports UNAVAILABLE — not silence — when the blend is switched OFF', async () => {
        const gateway = new FoodCatalogGateway(liveClients, { enabled: false });

        // ⚠️ Deliberately NOT the `disabled` value `search` returns. There, silence is right: the local list
        // still works and nothing the cook asked for is missing. Here they pressed a button and are owed an
        // answer, and "the source cannot be searched right now" is the honest one.
        await expect(gateway.searchLive(CALLER, 'broccoli')).resolves.toEqual({ kind: 'unavailable' });
        expect(standard).not.toHaveBeenCalled();
    });
});

/**
 * `IngredientsService.searchLive` (plan U29) — the picker's ON-DEMAND source search, behind the
 * "Search USDA for '…'" control.
 *
 * ⚠️ The suggest and add-by-food cases this file used to hold moved to `ingredients.service.test.ts` when plan
 * 002 (0051) replaced the shared name catalog with bindings. This half is unchanged by that: the live search
 * never touched the catalog.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';

import type { FoodCatalogGateway } from '../foodCatalog.gateway.js';
import type { FoodLookupsDal } from '../dal/foodLookups.dal.js';
import type { FoodRefsGateway } from '../foodRefs.gateway.js';
import { IngredientsService } from '../ingredients.service.js';
import { CALLER_TOKEN as CALLER, makeFoodClients } from '../__fixtures__/ingredients.fixtures.js';
import {
    makeFakeIngredientResolutionsDal,
    makeFakeResolutionBandsDal,
} from '../__fixtures__/resolutionDals.fixture.js';

describe('IngredientsService.searchLive (plan U29)', () => {
    let catalog: FoodCatalogGateway;
    let searchLive: Mock;
    let service: IngredientsService;

    beforeEach(() => {
        searchLive = vi.fn().mockResolvedValue({ kind: 'results', hits: [] });
        catalog = { search: vi.fn(), searchLive } as unknown as FoodCatalogGateway;
        service = new IngredientsService(
            {} as FoodLookupsDal,
            makeFoodClients().clients,
            catalog,
            {} as FoodRefsGateway,
            [],
            makeFakeIngredientResolutionsDal(),
            makeFakeResolutionBandsDal(),
        );
    });

    it('returns the gateway’s hits under this service’s envelope', async () => {
        searchLive.mockResolvedValue({
            kind: 'results',
            hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }, { name: 'Broccoli rabe' }],
        });

        await expect(service.searchLive(CALLER, 'broccoli')).resolves.toEqual({
            hits: [{ name: 'Broccoli, raw', foodId: 'food_1' }, { name: 'Broccoli rabe' }],
        });
    });

    it('returns an EMPTY envelope when the source answered with nothing — NOT an error', async () => {
        searchLive.mockResolvedValue({ kind: 'results', hits: [] });

        // ⛔ The outcome a cook acts on by giving up on the source, as opposed to retrying.
        await expect(service.searchLive(CALLER, 'nosuchfood')).resolves.toEqual({ hits: [] });
    });

    it('raises a 503 SOURCE_BUSY, carrying the retry window, when the rate budget refused', async () => {
        searchLive.mockResolvedValue({ kind: 'busy', retryAfterSeconds: 60 });

        const error = (await service
            .searchLive(CALLER, 'broccoli')
            .catch((thrown: unknown) => thrown)) as HttpException;

        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(error.getResponse()).toMatchObject({ code: 'SOURCE_BUSY', details: { retryAfterSeconds: 60 } });
    });

    it('still raises SOURCE_BUSY when no retry window was reported, without inventing one', async () => {
        searchLive.mockResolvedValue({ kind: 'busy' });

        const error = (await service
            .searchLive(CALLER, 'broccoli')
            .catch((thrown: unknown) => thrown)) as HttpException;

        expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        // A fabricated window would be worse than none: it would tell a cook to come back at a moment
        // nothing here has any basis for.
        expect(error.getResponse()).toEqual({ code: 'SOURCE_BUSY', message: expect.any(String) });
    });

    it('raises a 502 SOURCE_UNAVAILABLE — a DIFFERENT status AND code — when the source did not answer', async () => {
        searchLive.mockResolvedValue({ kind: 'unavailable' });

        const error = (await service
            .searchLive(CALLER, 'broccoli')
            .catch((thrown: unknown) => thrown)) as HttpException;

        // ⛔ Not SOURCE_BUSY. That one promises a retry window; this one cannot, because nothing here knows
        // when an upstream source recovers — and a cook is told two different things.
        expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        expect(error.getResponse()).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    });

    it('trims the query before handing it to the gateway', async () => {
        await service.searchLive(CALLER, '  broccoli  ');

        expect(searchLive).toHaveBeenCalledWith(CALLER, 'broccoli');
    });

    it('refuses a below-minimum query WITHOUT calling out — the lane must not be spent on it', async () => {
        const error = (await service.searchLive(CALLER, 'br').catch((thrown: unknown) => thrown)) as HttpException;

        // 003-FR-010a. Refused here rather than passed through, because every hop past this point costs a
        // request against a SHARED external quota that a query this short can never justify.
        expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(searchLive).not.toHaveBeenCalled();
    });

    it('measures the minimum AFTER trimming, so whitespace cannot buy a search', async () => {
        await expect(service.searchLive(CALLER, '  br  ')).rejects.toThrow();
        expect(searchLive).not.toHaveBeenCalled();
    });
});

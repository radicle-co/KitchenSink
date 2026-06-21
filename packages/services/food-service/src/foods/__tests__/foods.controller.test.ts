/**
 * Unit tests for {@link FoodsController} — the HTTP status-code matrix (mocked service).
 *
 * Requirement → test mapping:
 * - FR-001 (cache hit)         → "getFood sets 200 and returns the food"
 * - FR-003 (miss/pending)      → "getFood sets 202 and returns the pending body"
 * - FR-005/FR-025 (tombstone)  → "getFood throws NotFoundException (404) for a tombstone"
 * - FR-006 (validation)        → "getFood/getStatus throw BadRequestException (400) for bad fdcId"
 * - FR-048 (provenance)        → "getFood reads requestedBy from req.user.sub / x-debug-sub"
 * - FR-007 (status)            → "getStatus maps not-found to 404"
 * - FR-002 (nutrients)         → "getNutrients maps unfetched to 404"
 * - FR-008 (search)            → "search/autocomplete delegate the trimmed query"
 */
import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FoodNotFoundError, FoodPendingError } from '../foods.errors.js';
import { FoodsController } from '../foods.controller.js';
import { FoodsService } from '../foods.service.js';
import { makeFoodRow } from '../__fixtures__/foods.fixtures.js';

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn> } {
    const status = vi.fn();
    const res = { status } as unknown as Response;

    return { res, status };
}

function makeReq(headers: Record<string, string> = {}, user?: { sub: string }): Request {
    return {
        header: (name: string) => headers[name.toLowerCase()],
        user,
    } as unknown as Request & { user?: { sub: string } };
}

function makeController(): { controller: FoodsController; service: Record<string, ReturnType<typeof vi.fn>> } {
    const service = {
        getFood: vi.fn(),
        getStatus: vi.fn(),
        getNutrients: vi.fn(),
        search: vi.fn(),
        autocomplete: vi.fn(),
    };
    const controller = new FoodsController(service as unknown as FoodsService);

    return { controller, service };
}

describe('FoodsController.getFood', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('sets 200 and returns the food on a hit (FR-001)', async () => {
        const food = {
            fdcId: 171688,
            description: 'Apple',
            dataType: 'Foundation',
            nutrients: {},
            fetchStatus: 'fetched',
        };
        ctx.service.getFood.mockResolvedValue(food);
        const { res, status } = makeRes();

        const result = await ctx.controller.getFood('171688', makeReq(), res);

        expect(status).toHaveBeenCalledWith(HttpStatus.OK);
        expect(result).toBe(food);
    });

    it('sets 202 and returns the pending body on a FoodPendingError (FR-003)', async () => {
        ctx.service.getFood.mockRejectedValue(new FoodPendingError(171688, 30));
        const { res, status } = makeRes();

        const result = await ctx.controller.getFood('171688', makeReq(), res);

        expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
        expect(result).toEqual({ fdcId: 171688, status: 'pending', estimatedWaitSeconds: 30 });
    });

    it('throws NotFoundException (404) on a FoodNotFoundError tombstone (FR-005/FR-025)', async () => {
        ctx.service.getFood.mockRejectedValue(new FoodNotFoundError(999999));
        const { res } = makeRes();

        await expect(ctx.controller.getFood('999999', makeReq(), res)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException (400) for a non-numeric fdcId (FR-006)', async () => {
        const { res } = makeRes();

        await expect(ctx.controller.getFood('abc', makeReq(), res)).rejects.toBeInstanceOf(BadRequestException);
        expect(ctx.service.getFood).not.toHaveBeenCalled();
    });

    it('throws BadRequestException (400) for a zero/negative fdcId (FR-006)', async () => {
        const { res } = makeRes();

        await expect(ctx.controller.getFood('0', makeReq(), res)).rejects.toBeInstanceOf(BadRequestException);
        await expect(ctx.controller.getFood('-5', makeReq(), res)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('passes req.user.sub as requestedBy when present (FR-048)', async () => {
        ctx.service.getFood.mockResolvedValue(makeFoodRow());
        const { res } = makeRes();

        await ctx.controller.getFood('171688', makeReq({}, { sub: 'user_real' }), res);

        expect(ctx.service.getFood).toHaveBeenCalledWith(171688, 'user_real');
    });

    it('falls back to the x-debug-sub header when req.user is absent (Phase-7 seam)', async () => {
        ctx.service.getFood.mockResolvedValue(makeFoodRow());
        const { res } = makeRes();

        await ctx.controller.getFood('171688', makeReq({ 'x-debug-sub': 'debug_user' }), res);

        expect(ctx.service.getFood).toHaveBeenCalledWith(171688, 'debug_user');
    });

    it('defaults requestedBy to anonymous when neither is present', async () => {
        ctx.service.getFood.mockResolvedValue(makeFoodRow());
        const { res } = makeRes();

        await ctx.controller.getFood('171688', makeReq(), res);

        expect(ctx.service.getFood).toHaveBeenCalledWith(171688, 'anonymous');
    });
});

describe('FoodsController.getStatus / getNutrients', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('returns the status body on success (FR-007)', async () => {
        const body = { fdcId: 171688, status: 'pending', estimatedWaitSeconds: 20 };
        ctx.service.getStatus.mockResolvedValue(body);

        expect(await ctx.controller.getStatus('171688')).toBe(body);
    });

    it('maps FoodNotFoundError to 404 on status (FR-007)', async () => {
        ctx.service.getStatus.mockRejectedValue(new FoodNotFoundError(171688));

        await expect(ctx.controller.getStatus('171688')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an invalid fdcId on status with 400 (FR-006)', async () => {
        await expect(ctx.controller.getStatus('xyz')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps an unfetched food to 404 on nutrients (FR-002)', async () => {
        ctx.service.getNutrients.mockRejectedValue(new FoodNotFoundError(171688));

        await expect(ctx.controller.getNutrients('171688')).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('FoodsController.search / autocomplete', () => {
    let ctx: ReturnType<typeof makeController>;

    beforeEach(() => {
        ctx = makeController();
    });

    it('delegates the search query (FR-008)', async () => {
        ctx.service.search.mockResolvedValue({ foods: [] });

        await ctx.controller.search('chicken');

        expect(ctx.service.search).toHaveBeenCalledWith('chicken');
    });

    it('delegates an empty string when query is omitted', async () => {
        ctx.service.search.mockResolvedValue({ foods: [] });

        await ctx.controller.search(undefined);

        expect(ctx.service.search).toHaveBeenCalledWith('');
    });

    it('delegates the autocomplete query (FR-008)', async () => {
        ctx.service.autocomplete.mockResolvedValue({ suggestions: [] });

        await ctx.controller.autocomplete('avo');

        expect(ctx.service.autocomplete).toHaveBeenCalledWith('avo');
    });
});

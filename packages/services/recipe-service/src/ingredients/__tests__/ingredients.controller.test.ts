import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import type { AuthenticatedRequest, Principal } from '../../auth/principal.js';
import { IngredientsController } from '../ingredients.controller.js';
import type { IngredientsService } from '../ingredients.service.js';
import { makeIngredient } from '../__fixtures__/ingredients.fixtures.js';

/** A request bearing an authenticated principal. */
function makeReq(overrides: Partial<Principal> = {}): AuthenticatedRequest {
    const principal: Principal = { userId: '01J0USER', sub: 'clerk_sub', scopes: [], permissions: [], ...overrides };

    return { principal } as unknown as AuthenticatedRequest;
}

describe('IngredientsController', () => {
    let controller: IngredientsController;
    let service: IngredientsService;
    let mocks: { search: ReturnType<typeof vi.fn>; createFreeform: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mocks = { search: vi.fn(), createFreeform: vi.fn() };
        service = mocks as unknown as IngredientsService;
        controller = new IngredientsController(service);
    });

    describe('GET /v1/ingredients/search', () => {
        it('reads the principal, trims q, and delegates to the service', async () => {
            const rows = [makeIngredient({ id: 'a' })];
            mocks.search.mockResolvedValue(rows);

            const result = await controller.search(makeReq(), '  flour  ', '5');

            expect(mocks.search).toHaveBeenCalledWith('flour', 5);
            expect(result).toBe(rows);
        });

        it('defaults the limit to undefined (service/DAL default) when omitted', async () => {
            mocks.search.mockResolvedValue([]);

            await controller.search(makeReq(), 'flour');

            expect(mocks.search).toHaveBeenCalledWith('flour', undefined);
        });

        it('rejects a missing/blank q with 400', async () => {
            await expect(controller.search(makeReq(), '   ')).rejects.toBeInstanceOf(BadRequestException);
            await expect(controller.search(makeReq(), undefined)).rejects.toBeInstanceOf(BadRequestException);
            expect(mocks.search).not.toHaveBeenCalled();
        });

        it('rejects a non-numeric limit with 400', async () => {
            await expect(controller.search(makeReq(), 'flour', 'abc')).rejects.toBeInstanceOf(BadRequestException);
        });

        it('fails closed with 401 when the principal is absent', async () => {
            const req = {} as AuthenticatedRequest;

            await expect(controller.search(req, 'flour')).rejects.toBeInstanceOf(UnauthorizedException);
        });
    });

    describe('POST /v1/ingredients', () => {
        it('creates a freeform ingredient from a valid body', async () => {
            const created = makeIngredient({ id: 'f1', isUserEntered: true });
            mocks.createFreeform.mockResolvedValue(created);

            const result = await controller.create(makeReq(), { name: '  Grandma spice  ' });

            expect(mocks.createFreeform).toHaveBeenCalledWith('Grandma spice');
            expect(result).toBe(created);
        });

        it('rejects a missing/blank name with 400', async () => {
            await expect(controller.create(makeReq(), {})).rejects.toBeInstanceOf(BadRequestException);
            await expect(controller.create(makeReq(), { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
            await expect(controller.create(makeReq(), null)).rejects.toBeInstanceOf(BadRequestException);
        });

        it('rejects an over-long name with 400', async () => {
            await expect(controller.create(makeReq(), { name: 'x'.repeat(121) })).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });

        it('fails closed with 401 when the principal is absent', async () => {
            await expect(controller.create({} as AuthenticatedRequest, { name: 'ok' })).rejects.toBeInstanceOf(
                UnauthorizedException,
            );
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { AuthenticatedRequest, Principal } from '../../auth/principal.js';
import { IngredientsController } from '../ingredients.controller.js';
import type { IngredientsService } from '../ingredients.service.js';
import { makeCandidateView, makeIngredient } from '../__fixtures__/ingredients.fixtures.js';

/** A request bearing an authenticated principal. */
function makeReq(overrides: Partial<Principal> = {}): AuthenticatedRequest {
    const principal: Principal = { userId: '01J0USER', sub: 'clerk_sub', scopes: [], permissions: [], ...overrides };

    return { principal } as unknown as AuthenticatedRequest;
}

describe('IngredientsController', () => {
    let controller: IngredientsController;
    let service: IngredientsService;
    let mocks: {
        search: ReturnType<typeof vi.fn>;
        createFreeform: ReturnType<typeof vi.fn>;
        addByName: ReturnType<typeof vi.fn>;
        refreshStatus: ReturnType<typeof vi.fn>;
        getCandidates: ReturnType<typeof vi.fn>;
        resolve: ReturnType<typeof vi.fn>;
    };

    /** A valid UUID for the `:id` path param (the controller pipes it with `ParseUUIDPipe`). */
    const ID = '00000000-0000-4000-8000-000000000001';

    beforeEach(() => {
        mocks = {
            search: vi.fn(),
            createFreeform: vi.fn(),
            addByName: vi.fn(),
            refreshStatus: vi.fn(),
            getCandidates: vi.fn(),
            resolve: vi.fn(),
        };
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

    describe('POST /v1/ingredients/by-name (async food resolution — the vertical entry point)', () => {
        it('adds an unknown food by name (trimmed) and returns its non-terminal ingredient', async () => {
            const added = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            mocks.addByName.mockResolvedValue(added);

            const result = await controller.addByName(makeReq(), { name: '  Quinoa  ' });

            // Mutation guard: the ADD path must delegate to addByName (NOT createFreeform) — a regression that
            // routed this to the plain freeform create would fail here (createFreeform must stay untouched).
            expect(mocks.addByName).toHaveBeenCalledWith('Quinoa');
            expect(mocks.createFreeform).not.toHaveBeenCalled();
            expect(result).toBe(added);
        });

        it('surfaces an UNRESOLVED add (needs disambiguation) unchanged from the service', async () => {
            const unresolved = makeIngredient({
                id: 'i2',
                foodId: 'F2',
                foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
            });
            mocks.addByName.mockResolvedValue(unresolved);

            const result = await controller.addByName(makeReq(), { name: 'Ambiguous thing' });

            expect(result.foodResolutionStatus).toBe(FoodResolutionStatus.UNRESOLVED);
        });

        it('rejects a missing/blank name with 400 and never calls the service', async () => {
            await expect(controller.addByName(makeReq(), {})).rejects.toBeInstanceOf(BadRequestException);
            await expect(controller.addByName(makeReq(), { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
            await expect(controller.addByName(makeReq(), null)).rejects.toBeInstanceOf(BadRequestException);
            expect(mocks.addByName).not.toHaveBeenCalled();
        });

        it('rejects an over-long name with 400', async () => {
            await expect(controller.addByName(makeReq(), { name: 'x'.repeat(121) })).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });

        it('fails closed with 401 when the principal is absent (before any validation or food call)', async () => {
            await expect(controller.addByName({} as AuthenticatedRequest, { name: 'ok' })).rejects.toBeInstanceOf(
                UnauthorizedException,
            );
            expect(mocks.addByName).not.toHaveBeenCalled();
        });
    });

    describe('GET /v1/ingredients/{id}/status (poll)', () => {
        it('reads the principal and delegates the poll to the service', async () => {
            const refreshed = makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED });
            mocks.refreshStatus.mockResolvedValue(refreshed);

            const result = await controller.status(makeReq(), ID);

            expect(mocks.refreshStatus).toHaveBeenCalledWith(ID);
            expect(result).toBe(refreshed);
        });

        it('fails closed with 401 when the principal is absent', async () => {
            await expect(controller.status({} as AuthenticatedRequest, ID)).rejects.toBeInstanceOf(
                UnauthorizedException,
            );
            expect(mocks.refreshStatus).not.toHaveBeenCalled();
        });
    });

    describe('GET /v1/ingredients/{id}/candidates', () => {
        it('reads the principal and delegates to the service', async () => {
            const candidates = [makeCandidateView({ candidateId: 'c1' })];
            mocks.getCandidates.mockResolvedValue(candidates);

            const result = await controller.candidates(makeReq(), ID);

            expect(mocks.getCandidates).toHaveBeenCalledWith(ID);
            expect(result).toBe(candidates);
        });

        it('fails closed with 401 when the principal is absent', async () => {
            await expect(controller.candidates({} as AuthenticatedRequest, ID)).rejects.toBeInstanceOf(
                UnauthorizedException,
            );
            expect(mocks.getCandidates).not.toHaveBeenCalled();
        });
    });

    describe('POST /v1/ingredients/{id}/resolve', () => {
        it('trims + forwards the picked candidate ids and returns the resolved ingredient', async () => {
            const resolved = makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED });
            mocks.resolve.mockResolvedValue(resolved);

            const result = await controller.resolve(makeReq(), ID, { candidateIds: ['  cand-1  ', 'cand-2'] });

            // Mutation guard: the EXACT trimmed picks must reach the service — a wrong/dropped id fails here.
            expect(mocks.resolve).toHaveBeenCalledWith(ID, ['cand-1', 'cand-2']);
            expect(result).toBe(resolved);
        });

        it('rejects a missing/empty/blank candidateIds with 400 and never calls the service', async () => {
            await expect(controller.resolve(makeReq(), ID, {})).rejects.toBeInstanceOf(BadRequestException);
            await expect(controller.resolve(makeReq(), ID, { candidateIds: [] })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            await expect(controller.resolve(makeReq(), ID, { candidateIds: ['  '] })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            await expect(controller.resolve(makeReq(), ID, { candidateIds: [42] })).rejects.toBeInstanceOf(
                BadRequestException,
            );
            await expect(controller.resolve(makeReq(), ID, null)).rejects.toBeInstanceOf(BadRequestException);
            expect(mocks.resolve).not.toHaveBeenCalled();
        });

        it('rejects an oversized candidateIds array with 400', async () => {
            const tooMany = Array.from({ length: 21 }, (_, i) => `c${i}`);

            await expect(controller.resolve(makeReq(), ID, { candidateIds: tooMany })).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });

        it('fails closed with 401 when the principal is absent (before any validation)', async () => {
            await expect(
                controller.resolve({} as AuthenticatedRequest, ID, { candidateIds: ['c1'] }),
            ).rejects.toBeInstanceOf(UnauthorizedException);
            expect(mocks.resolve).not.toHaveBeenCalled();
        });
    });
});

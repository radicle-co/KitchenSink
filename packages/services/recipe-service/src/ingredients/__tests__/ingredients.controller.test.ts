/**
 * T029 — unit tests for {@link IngredientsController} over a fake {@link IngredientsService}.
 *
 * The controller is thin (house convention): the `@OwnerId()` decorator resolves the verified caller and
 * fails closed with `401` when absent — that path lives on the decorator and is tested in
 * `auth/__tests__/current-principal.decorator.test.ts`, NOT here (a direct method call does not run
 * param decorators). Body validation lives on the class-validator DTOs under the controller-scoped
 * `ValidationPipe`; its outcomes are pinned in `dto/__tests__/ingredient-dtos.test.ts` (run through the
 * SAME pipe) and end-to-end in the assembled-app e2e spec. What remains for the controller itself is the
 * query-param logic it still owns (search `q` required + `limit` parsing) and that each route forwards the
 * validated inputs to the right service method verbatim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { IngredientsController } from '../ingredients.controller.js';
import type { IngredientsService } from '../ingredients.service.js';
import type { CreateIngredientDto } from '../dto/create-ingredient.dto.js';
import type { ResolveIngredientDto } from '../dto/resolve-ingredient.dto.js';
import { makeCandidateView, makeIngredient } from '../__fixtures__/ingredients.fixtures.js';

/** The verified caller ULID the `@OwnerId()` decorator would inject (an auth assertion; unused downstream). */
const CALLER = '01J0USER';

describe('IngredientsController', () => {
    let controller: IngredientsController;
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
        controller = new IngredientsController(mocks as unknown as IngredientsService);
    });

    describe('GET /v1/ingredients/search', () => {
        it('trims q, parses limit, and delegates to the service', async () => {
            const rows = [makeIngredient({ id: 'a' })];
            mocks.search.mockResolvedValue(rows);

            const result = await controller.search(CALLER, '  flour  ', '5');

            expect(mocks.search).toHaveBeenCalledWith('flour', 5);
            expect(result).toBe(rows);
        });

        it('defaults the limit to undefined (service/DAL default) when omitted', async () => {
            mocks.search.mockResolvedValue([]);

            await controller.search(CALLER, 'flour');

            expect(mocks.search).toHaveBeenCalledWith('flour', undefined);
        });

        it('rejects a missing/blank q with 400', async () => {
            await expect(controller.search(CALLER, '   ')).rejects.toBeInstanceOf(BadRequestException);
            await expect(controller.search(CALLER, undefined)).rejects.toBeInstanceOf(BadRequestException);
            expect(mocks.search).not.toHaveBeenCalled();
        });

        it('rejects a non-numeric limit with 400', async () => {
            await expect(controller.search(CALLER, 'flour', 'abc')).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('POST /v1/ingredients', () => {
        it('forwards the (DTO-validated) name to createFreeform', async () => {
            const created = makeIngredient({ id: 'f1', isUserEntered: true });
            mocks.createFreeform.mockResolvedValue(created);

            const result = await controller.create(CALLER, { name: 'Grandma spice' } as CreateIngredientDto);

            expect(mocks.createFreeform).toHaveBeenCalledWith('Grandma spice');
            expect(result).toBe(created);
        });
    });

    describe('POST /v1/ingredients/by-name (async food resolution — the vertical entry point)', () => {
        it('routes to addByName (NOT createFreeform) and returns the non-terminal ingredient', async () => {
            const added = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            mocks.addByName.mockResolvedValue(added);

            const result = await controller.addByName(CALLER, { name: 'Quinoa' } as CreateIngredientDto);

            // Mutation guard: the ADD path must delegate to addByName — a regression routing it to the plain
            // freeform create would fail here (createFreeform must stay untouched).
            expect(mocks.addByName).toHaveBeenCalledWith('Quinoa');
            expect(mocks.createFreeform).not.toHaveBeenCalled();
            expect(result).toBe(added);
        });
    });

    describe('GET /v1/ingredients/{id}/status (poll)', () => {
        it('delegates the poll to the service', async () => {
            const refreshed = makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED });
            mocks.refreshStatus.mockResolvedValue(refreshed);

            const result = await controller.status(CALLER, ID);

            expect(mocks.refreshStatus).toHaveBeenCalledWith(ID);
            expect(result).toBe(refreshed);
        });
    });

    describe('GET /v1/ingredients/{id}/candidates', () => {
        it('delegates to the service', async () => {
            const candidates = [makeCandidateView({ candidateId: 'c1' })];
            mocks.getCandidates.mockResolvedValue(candidates);

            const result = await controller.candidates(CALLER, ID);

            expect(mocks.getCandidates).toHaveBeenCalledWith(ID);
            expect(result).toBe(candidates);
        });
    });

    describe('POST /v1/ingredients/{id}/resolve', () => {
        it('forwards the (DTO-validated) picked candidate ids and returns the resolved ingredient', async () => {
            const resolved = makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED });
            mocks.resolve.mockResolvedValue(resolved);

            const result = await controller.resolve(CALLER, ID, {
                candidateIds: ['cand-1', 'cand-2'],
            } as ResolveIngredientDto);

            // Mutation guard: the EXACT picks must reach the service — a wrong/dropped id fails here.
            expect(mocks.resolve).toHaveBeenCalledWith(ID, ['cand-1', 'cand-2']);
            expect(result).toBe(resolved);
        });
    });
});

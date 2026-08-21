/**
 * T029 — unit tests for {@link IngredientsController} over a fake {@link IngredientsService}.
 *
 * The controller is thin (house convention): the `@OwnerId()` decorator resolves the verified caller and
 * fails closed with `401` when absent — that path lives on the decorator and is tested in
 * `auth/__tests__/currentPrincipal.decorator.test.ts`, NOT here (a direct method call does not run
 * param decorators). Body validation lives on the class-validator DTOs under the controller-scoped
 * `ValidationPipe`; its outcomes are pinned in `dto/__tests__/ingredientDtos.test.ts` (run through the
 * SAME pipe) and end-to-end in the assembled-app e2e spec. What remains for the controller itself is the
 * query-param logic it still owns (search `q` required + `limit` parsing) and that each route forwards the
 * validated inputs to the right service method verbatim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, HttpStatus } from '@nestjs/common';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { IngredientsController } from '../ingredients.controller.js';
import type { IngredientsService } from '../ingredients.service.js';
import type { AddIngredientByFoodDto } from '../dto/addIngredientByFood.dto.js';
import type { CreateIngredientDto } from '../dto/createIngredient.dto.js';
import type { ResolveIngredientDto } from '../dto/resolveIngredient.dto.js';
import { CALLER_TOKEN as TOKEN, makeCandidateView, makeIngredient } from '../__fixtures__/ingredients.fixtures.js';

/** The verified caller ULID the `@OwnerId()` decorator would inject (an auth assertion; unused downstream). */
const CALLER = '01J0USER';

/**
 * U+200B ZERO WIDTH SPACE, U+00A0 NO-BREAK SPACE and U+FEFF BOM — escapes rather than pasted characters,
 * because a reviewer cannot check a case they cannot see.
 */
const ZWSP = '\u200B';
const NBSP = '\u00A0';
const BOM = '\uFEFF';

describe('IngredientsController', () => {
    let controller: IngredientsController;
    let mocks: {
        search: ReturnType<typeof vi.fn>;
        suggest: ReturnType<typeof vi.fn>;
        createFreeform: ReturnType<typeof vi.fn>;
        addByName: ReturnType<typeof vi.fn>;
        addByFoodId: ReturnType<typeof vi.fn>;
        refreshStatus: ReturnType<typeof vi.fn>;
        getCandidates: ReturnType<typeof vi.fn>;
        resolve: ReturnType<typeof vi.fn>;
    };

    /** A valid UUID for the `:id` path param (the controller pipes it with `ParseUUIDPipe`). */
    const ID = '00000000-0000-4000-8000-000000000001';

    beforeEach(() => {
        mocks = {
            search: vi.fn(),
            suggest: vi.fn(),
            createFreeform: vi.fn(),
            addByName: vi.fn(),
            addByFoodId: vi.fn(),
            refreshStatus: vi.fn(),
            getCandidates: vi.fn(),
            resolve: vi.fn(),
        };
        controller = new IngredientsController(mocks as unknown as IngredientsService);
    });

    describe('GET /api/v1/ingredients/search', () => {
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

    describe('GET /api/v1/ingredients/suggest (Stage 2 — the blended typeahead)', () => {
        it('trims q, parses limit, and delegates to suggest — NOT to the local-only search', async () => {
            const envelope = { suggestions: [], catalogAvailability: 'ok' as const };
            mocks.suggest.mockResolvedValue(envelope);

            const result = await controller.suggest(CALLER, TOKEN, '  chicken  ', '5');

            expect(mocks.suggest).toHaveBeenCalledWith(TOKEN, 'chicken', 5);
            // Mutation guard: routing /suggest at the local-only search would silently un-blend the typeahead.
            expect(mocks.search).not.toHaveBeenCalled();
            expect(result).toBe(envelope);
        });

        it('defaults the limit to undefined (service default) when omitted', async () => {
            mocks.suggest.mockResolvedValue({ suggestions: [], catalogAvailability: 'ok' });

            await controller.suggest(CALLER, TOKEN, 'chicken');

            expect(mocks.suggest).toHaveBeenCalledWith(TOKEN, 'chicken', undefined);
        });

        it('rejects a missing/blank q with 400', async () => {
            await expect(controller.suggest(CALLER, TOKEN, '   ')).rejects.toBeInstanceOf(BadRequestException);
            await expect(controller.suggest(CALLER, TOKEN, undefined)).rejects.toBeInstanceOf(BadRequestException);
            expect(mocks.suggest).not.toHaveBeenCalled();
        });

        it('rejects a non-numeric limit with 400', async () => {
            await expect(controller.suggest(CALLER, TOKEN, 'chicken', 'abc')).rejects.toBeInstanceOf(
                BadRequestException,
            );
        });
    });

    describe('POST /api/v1/ingredients/by-food (Stage 2 — the catalog pick)', () => {
        it('forwards the (DTO-validated) foodId to addByFoodId and returns the nourished ingredient', async () => {
            const admitted = makeIngredient({
                id: 'i9',
                foodId: '01J0FOOD',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                caloriesPer100g: 165,
            });
            mocks.addByFoodId.mockResolvedValue(admitted);

            const result = await controller.addByFood(CALLER, TOKEN, { foodId: '01J0FOOD' } as AddIngredientByFoodDto);

            expect(mocks.addByFoodId).toHaveBeenCalledWith(TOKEN, '01J0FOOD');
            // Mutation guards: the pick must not fall through to the by-name or freeform paths.
            expect(mocks.addByName).not.toHaveBeenCalled();
            expect(mocks.createFreeform).not.toHaveBeenCalled();
            expect(result).toBe(admitted);
        });
    });

    describe('forwarded caller credential (issue #120)', () => {
        it('hands the caller credential to every food-touching route, as the FIRST service argument', async () => {
            mocks.suggest.mockResolvedValue({ suggestions: [], catalogAvailability: 'ok' });
            mocks.addByName.mockResolvedValue(makeIngredient({ id: 'i1' }));
            mocks.addByFoodId.mockResolvedValue(makeIngredient({ id: 'i2' }));
            mocks.refreshStatus.mockResolvedValue(makeIngredient({ id: ID }));
            mocks.getCandidates.mockResolvedValue([]);
            mocks.resolve.mockResolvedValue(makeIngredient({ id: ID }));

            await controller.suggest(CALLER, TOKEN, 'chicken');
            await controller.addByName(CALLER, TOKEN, { name: 'Quinoa' } as CreateIngredientDto);
            await controller.addByFood(CALLER, TOKEN, { foodId: 'F1' } as AddIngredientByFoodDto);
            await controller.status(CALLER, TOKEN, ID);
            await controller.candidates(CALLER, TOKEN, ID);
            await controller.resolve(CALLER, TOKEN, ID, { candidateIds: ['c1'] } as ResolveIngredientDto);

            for (const spy of [
                mocks.suggest,
                mocks.addByName,
                mocks.addByFoodId,
                mocks.refreshStatus,
                mocks.getCandidates,
                mocks.resolve,
            ]) {
                expect(spy.mock.calls[0]?.[0]).toBe(TOKEN);
            }
        });

        it('passes an ABSENT credential through unchanged — the service decides how to degrade', async () => {
            mocks.suggest.mockResolvedValue({ suggestions: [], catalogAvailability: 'unavailable' });

            await controller.suggest(CALLER, undefined, 'chicken');

            // Not a 401 here and not a substituted credential: the controller forwards what the request had.
            expect(mocks.suggest).toHaveBeenCalledWith(undefined, 'chicken', undefined);
        });

        it('does NOT take a credential on the local-only routes (no cross-service call to authorize)', async () => {
            mocks.search.mockResolvedValue([]);
            mocks.createFreeform.mockResolvedValue(makeIngredient({ id: 'f1' }));

            await controller.search(CALLER, 'flour');
            await controller.create(CALLER, { name: 'Grandma spice' } as CreateIngredientDto);

            expect(mocks.search).toHaveBeenCalledWith('flour', undefined);
            expect(mocks.createFreeform).toHaveBeenCalledWith('Grandma spice');
        });
    });

    describe('POST /api/v1/ingredients', () => {
        it('forwards the (DTO-validated) name to createFreeform', async () => {
            const created = makeIngredient({ id: 'f1', isUserEntered: true });
            mocks.createFreeform.mockResolvedValue(created);

            const result = await controller.create(CALLER, { name: 'Grandma spice' } as CreateIngredientDto);

            expect(mocks.createFreeform).toHaveBeenCalledWith('Grandma spice');
            expect(result).toBe(created);
        });
    });

    /**
     * ⛔ THE PARSE BOUNDARY (plan U3). `visibleName` is the ONE place a caller's string becomes a name the
     * shared, ownerless `ingredients` catalog will store and display, and it lives here rather than in the
     * published request schema — see the method's own docstring for the three reasons. These cases are what
     * make that placement safe rather than merely defensible.
     */
    describe('the canonical-name parse boundary', () => {
        it('canonicalizes before delegating, on BOTH name-taking routes', async () => {
            mocks.createFreeform.mockResolvedValue(makeIngredient({ id: 'f1' }));
            mocks.addByName.mockResolvedValue(makeIngredient({ id: 'i1' }));

            // `String#trim` leaves every one of these in place: `Cf` format characters are not ECMAScript
            // whitespace, and NBSP survives NFKC as a separator rather than being folded by trim.
            await controller.create(CALLER, { name: `Bro${ZWSP}wn${NBSP} sugar${BOM}` } as CreateIngredientDto);
            await controller.addByName(CALLER, TOKEN, {
                name: `Bro${ZWSP}wn${NBSP} sugar${BOM}`,
            } as CreateIngredientDto);

            expect(mocks.createFreeform).toHaveBeenCalledWith('Brown sugar');
            expect(mocks.addByName).toHaveBeenCalledWith(TOKEN, 'Brown sugar');
        });

        it.each([
            ['create', (dto: CreateIngredientDto) => controller.create(CALLER, dto)],
            ['addByName', (dto: CreateIngredientDto) => controller.addByName(CALLER, TOKEN, dto)],
        ])(
            'rejects an invisible-only name on %s with the pipe`s own VALIDATION_FAILED envelope',
            async (_route, invoke) => {
                // The DTO's `min(1)` PASSES this — a lone U+200B survives `String#trim`, length 1 — so before U3 it
                // reached the DAL and stored a row named nothing at all, in a catalog every user searches. The
                // envelope must be the SAME shape the pipe raises for `""`, because it is the same condition
                // written in characters the caller cannot see.
                const rejected = invoke({ name: `${ZWSP}${BOM}` } as CreateIngredientDto);

                await expect(rejected).rejects.toMatchObject({
                    response: { code: 'VALIDATION_FAILED' },
                    status: HttpStatus.BAD_REQUEST,
                });
                expect(mocks.createFreeform).not.toHaveBeenCalled();
                expect(mocks.addByName).not.toHaveBeenCalled();
            },
        );
    });

    describe('POST /api/v1/ingredients/by-name (async food resolution — the vertical entry point)', () => {
        it('routes to addByName (NOT createFreeform) and returns the non-terminal ingredient', async () => {
            const added = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            mocks.addByName.mockResolvedValue(added);

            const result = await controller.addByName(CALLER, TOKEN, { name: 'Quinoa' } as CreateIngredientDto);

            // Mutation guard: the ADD path must delegate to addByName — a regression routing it to the plain
            // freeform create would fail here (createFreeform must stay untouched).
            expect(mocks.addByName).toHaveBeenCalledWith(TOKEN, 'Quinoa');
            expect(mocks.createFreeform).not.toHaveBeenCalled();
            expect(result).toBe(added);
        });
    });

    describe('GET /api/v1/ingredients/{id}/status (poll)', () => {
        it('delegates the poll to the service', async () => {
            const refreshed = makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED });
            mocks.refreshStatus.mockResolvedValue(refreshed);

            const result = await controller.status(CALLER, TOKEN, ID);

            expect(mocks.refreshStatus).toHaveBeenCalledWith(TOKEN, ID);
            expect(result).toBe(refreshed);
        });
    });

    describe('GET /api/v1/ingredients/{id}/candidates', () => {
        it('delegates to the service', async () => {
            const candidates = [makeCandidateView({ candidateId: 'c1' })];
            mocks.getCandidates.mockResolvedValue(candidates);

            const result = await controller.candidates(CALLER, TOKEN, ID);

            expect(mocks.getCandidates).toHaveBeenCalledWith(TOKEN, ID);
            expect(result).toBe(candidates);
        });
    });

    describe('POST /api/v1/ingredients/{id}/resolve', () => {
        it('forwards the (DTO-validated) picked candidate ids and returns the resolved ingredient', async () => {
            const resolved = makeIngredient({ id: ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED });
            mocks.resolve.mockResolvedValue(resolved);

            const result = await controller.resolve(CALLER, TOKEN, ID, {
                candidateIds: ['cand-1', 'cand-2'],
            } as ResolveIngredientDto);

            // Mutation guard: the EXACT picks must reach the service — a wrong/dropped id fails here.
            expect(mocks.resolve).toHaveBeenCalledWith(TOKEN, ID, ['cand-1', 'cand-2']);
            expect(result).toBe(resolved);
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FoodResolutionStatus, RecipeErrorCode, isRecipeError } from '@kitchensink/recipe-core';
import { NotFoundError } from '@kitchensink/food-service-client';

import type { FoodCatalogGateway } from '../foodCatalog.gateway.js';
import type { FoodServiceClients } from '../FoodServiceClients.factory.js';
import type { IngredientsDal } from '../dal/ingredients.dal.js';
import { IngredientsService } from '../ingredients.service.js';
import {
    CALLER_TOKEN as CALLER,
    makeAddResult,
    makeCanonicalName,
    makeCandidateView,
    makeFoodClients,
    makeFoodView,
    makeIngredient,
    makeStatusResult,
} from '../__fixtures__/ingredients.fixtures.js';

/** A fully mocked `IngredientsDal`. */
function makeDal(): { dal: IngredientsDal; mocks: Record<string, ReturnType<typeof vi.fn>> } {
    const mocks = {
        search: vi.fn(),
        findById: vi.fn(),
        findByFoodId: vi.fn(),
        findFreeformByName: vi.fn(),
        createFreeform: vi.fn(),
        createFoodBacked: vi.fn(),
        updateResolution: vi.fn(),
    };

    return { dal: mocks as unknown as IngredientsDal, mocks };
}

/** A no-op catalog gateway — these suites cover the paths that never blend (see the Stage-2 suite for those). */
function makeCatalogGateway(): FoodCatalogGateway {
    return { search: vi.fn().mockResolvedValue({ hits: [], availability: 'ok' }) } as unknown as FoodCatalogGateway;
}

describe('IngredientsService', () => {
    let service: IngredientsService;
    let dal: IngredientsDal;
    let dalMocks: Record<string, ReturnType<typeof vi.fn>>;
    let clients: FoodServiceClients;
    let clientMocks: Record<string, ReturnType<typeof vi.fn>>;
    let standard: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        ({ dal, mocks: dalMocks } = makeDal());
        ({ clients, mocks: clientMocks, standard } = makeFoodClients());
        service = new IngredientsService(dal, clients, makeCatalogGateway());
    });

    describe('createAuthoredFood — the U16 picker create-and-attach vertical', () => {
        it('creates through food under the CALLER credential, then admits by-food with the privacy capture', async () => {
            clientMocks['createAuthoredFood']!.mockResolvedValue({
                kind: 'created',
                food: makeFoodView({ id: 'F_new', name: 'My Blend', visibility: 'private' }),
            });
            clientMocks['getStatus']!.mockResolvedValue(
                makeStatusResult({
                    id: 'F_new',
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: 'F_new', name: 'My Blend', visibility: 'private' }),
                }),
            );
            dalMocks['findByFoodId']!.mockResolvedValue(undefined);
            dalMocks['createFoodBacked']!.mockResolvedValue(makeIngredient({ id: 'i9', foodId: 'F_new' }));
            dalMocks['updateResolution']!.mockResolvedValue(makeIngredient({ id: 'i9', foodId: 'F_new' }));

            const result = await service.createAuthoredFood(CALLER, '01J0USERAUTHOR', {
                name: 'My Blend',
                macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
            });

            expect(standard).toHaveBeenCalledWith(CALLER);
            expect(result.kind).toBe('created');

            if (result.kind === 'created') {
                expect(result.ingredient.id).toBe('i9');
            }

            // U11/R20: the admission carries the author ULID, so `food_owner_id` is captured on the row.
            expect(dalMocks['createFoodBacked']).toHaveBeenCalledWith(
                expect.objectContaining({ foodId: 'F_new', foodOwnerId: '01J0USERAUTHOR' }),
            );
        });

        it('surfaces the per-author dedup collision as the duplicate arm with the EXISTING food id', async () => {
            clientMocks['createAuthoredFood']!.mockResolvedValue({ kind: 'duplicate', existingId: 'F_prior' });

            const result = await service.createAuthoredFood(CALLER, '01J0USERAUTHOR', {
                name: 'My Blend',
                macros: { calories: 100, proteinG: 10, carbsG: 20, fatG: 5 },
            });

            expect(result).toEqual({ kind: 'duplicate', existingFoodId: 'F_prior' });
            // Nothing was admitted — the reuse decision belongs to the cook, not to this fallthrough.
            expect(dalMocks['createFoodBacked']).not.toHaveBeenCalled();
        });
    });

    describe('caller-credential forwarding (issue #120)', () => {
        it('mints the 8s standard client for THIS caller on every food-touching path', async () => {
            clientMocks['addByName']!.mockResolvedValue(makeAddResult({ id: 'F1' }));
            dalMocks['findByFoodId']!.mockResolvedValue(undefined);
            dalMocks['createFoodBacked']!.mockResolvedValue(makeIngredient({ id: 'i1', foodId: 'F1' }));

            await service.addByName(CALLER, makeCanonicalName('Quinoa'));

            // The credential the user presented is the one the food call is made under — not a service token,
            // and not an ambient value: the factory is asked for a client for exactly this caller.
            expect(standard).toHaveBeenCalledWith(CALLER);
        });

        it('does NOT reach the food service at all on the local-only paths (no credential use)', async () => {
            dalMocks['search']!.mockResolvedValue([]);
            dalMocks['createFreeform']!.mockResolvedValue(makeIngredient({ id: 'f1' }));

            await service.search('flour');
            await service.createFreeform(makeCanonicalName('Grandma spice'));

            expect(standard).not.toHaveBeenCalled();
        });
    });

    describe('search (local catalog)', () => {
        it('delegates a trimmed query to the DAL and returns its rows', async () => {
            const rows = [makeIngredient({ id: 'a' })];
            dalMocks['search']!.mockResolvedValue(rows);

            const results = await service.search('  flour  ', undefined, 5);

            expect(dalMocks['search']).toHaveBeenCalledWith('flour', undefined, 5);
            expect(results).toBe(rows);
        });
    });

    // Stage 2 replaced the dead `suggestFoods` proxy with `suggest` (the blended typeahead) + `addByFoodId`
    // (the pick). Both are covered in `ingredientsSuggest.service.test.ts`.

    describe('addByName', () => {
        it('adds an unknown food (202 PENDING) and persists a new food-backed ingredient', async () => {
            clientMocks['addByName']!.mockResolvedValue(
                makeAddResult({ id: 'F1', status: FoodResolutionStatus.PENDING }),
            );
            dalMocks['findByFoodId']!.mockResolvedValue(undefined);
            const created = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            dalMocks['createFoodBacked']!.mockResolvedValue(created);

            const result = await service.addByName(CALLER, makeCanonicalName('  Quinoa  '));

            expect(clientMocks['addByName']).toHaveBeenCalledWith('Quinoa');
            expect(dalMocks['createFoodBacked']).toHaveBeenCalledWith({
                name: 'Quinoa',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            expect(result).toBe(created);
        });

        it('dedups on food_id: returns the existing ingredient without re-inserting', async () => {
            clientMocks['addByName']!.mockResolvedValue(makeAddResult({ id: 'F1' }));
            const existing = makeIngredient({ id: 'dup', foodId: 'F1' });
            dalMocks['findByFoodId']!.mockResolvedValue(existing);

            const result = await service.addByName(CALLER, makeCanonicalName('Quinoa'));

            expect(result).toBe(existing);
            expect(dalMocks['createFoodBacked']).not.toHaveBeenCalled();
        });

        it('surfaces UNRESOLVED (needs disambiguation) as the persisted status', async () => {
            clientMocks['addByName']!.mockResolvedValue(
                makeAddResult({ id: 'F2', status: FoodResolutionStatus.UNRESOLVED }),
            );
            dalMocks['findByFoodId']!.mockResolvedValue(undefined);
            dalMocks['createFoodBacked']!.mockImplementation((input: unknown) =>
                Promise.resolve(makeIngredient(input as object)),
            );

            const result = await service.addByName(CALLER, makeCanonicalName('Ambiguous thing'));

            expect(result.foodResolutionStatus).toBe(FoodResolutionStatus.UNRESOLVED);
        });

        /**
         * ⛔ THE BRANCH THAT MADE CALLER PROSE PERMANENT, and the one that is easiest to believe cannot happen.
         *
         * `addResponseSchema.status` is the FULL six-value lifecycle, not the two pending states — `202` is
         * about the ASYNC contract, not about the status — and `FoodsService.addByName` enqueues only when it
         * CREATES or REACTIVATES a row, returning the food's real status otherwise. So a name food already
         * holds comes back `RESOLVED` on the very first add, and the row minted here would be born terminal
         * with the caller's own text as its permanent label: `refreshStatus` is only reached by a client
         * polling a NON-terminal row, the importer's settle pass re-reads only `PENDING`/`UNRESOLVED`,
         * `addByFoodId` short-circuits on `RESOLVED`, and `resolve` is converge-only. Nothing would ever
         * rename it — and this is the DOMINANT branch once the catalog is warm, which is exactly the state
         * U12's reseed leaves for U15's re-import to run against.
         */
        describe('a food the catalog ALREADY holds comes back RESOLVED on the add itself', () => {
            beforeEach(() => {
                dalMocks['findByFoodId']!.mockResolvedValue(undefined);
                dalMocks['createFoodBacked']!.mockImplementation((input: unknown) =>
                    Promise.resolve(makeIngredient(input as object)),
                );
            });

            it('spends ONE more read to name the row from the catalog, not from the caller', async () => {
                clientMocks['addByName']!.mockResolvedValue(
                    makeAddResult({ id: 'F3', status: FoodResolutionStatus.RESOLVED }),
                );
                clientMocks['getStatus']!.mockResolvedValue(
                    makeStatusResult({
                        id: 'F3',
                        status: FoodResolutionStatus.RESOLVED,
                        food: makeFoodView({ id: 'F3', name: 'Sugars, granulated' }),
                    }),
                );

                const result = await service.addByName(
                    CALLER,
                    makeCanonicalName('two heaping teaspoonfuls of powdered white sugar'),
                );

                expect(clientMocks['getStatus']).toHaveBeenCalledWith('F3');
                expect(dalMocks['createFoodBacked']).toHaveBeenCalledWith({
                    name: 'Sugars, granulated',
                    foodId: 'F3',
                    foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                });
                expect(result.name).toBe('Sugars, granulated');
            });

            it('⛔ does NOT spend that read on a non-terminal add (the common path stays one round-trip)', async () => {
                clientMocks['addByName']!.mockResolvedValue(
                    makeAddResult({ id: 'F4', status: FoodResolutionStatus.PENDING }),
                );

                await service.addByName(CALLER, makeCanonicalName('sweet herbs, a small bunch'));

                // A `PENDING` food has no golden record to name it from, so a read here would buy nothing and
                // put a second cross-service round-trip on the picker's primary action.
                expect(clientMocks['getStatus']).not.toHaveBeenCalled();
                expect(dalMocks['createFoodBacked']).toHaveBeenCalledWith({
                    name: 'sweet herbs, a small bunch',
                    foodId: 'F4',
                    foodResolutionStatus: FoodResolutionStatus.PENDING,
                });
            });

            it('falls back to the caller`s name if the food goes terminal between the add and the read', async () => {
                // A narrow race, and NOT a failure of the add: the row is legitimate and the caller's own name
                // is a valid placeholder for it. Naming is a quality improvement on a path whose job is to
                // persist the ingredient, so it degrades rather than propagating a 404 to the user.
                clientMocks['addByName']!.mockResolvedValue(
                    makeAddResult({ id: 'F5', status: FoodResolutionStatus.RESOLVED }),
                );
                clientMocks['getStatus']!.mockRejectedValue(new NotFoundError('F5', FoodResolutionStatus.NOT_FOUND));

                const result = await service.addByName(CALLER, makeCanonicalName('a nameless thing'));

                expect(result.name).toBe('a nameless thing');
                expect(dalMocks['createFoodBacked']).toHaveBeenCalledWith({
                    name: 'a nameless thing',
                    foodId: 'F5',
                    foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                });
            });
        });
    });

    describe('refreshStatus (poll)', () => {
        /**
         * ⚠️ REWRITTEN for plan U3, not weakened. It asserted "STATUS ONLY", which was the whole truth under
         * U10 and is no longer: the resolution now also adopts the golden record's canonical NAME, because the
         * caller's own text — a fragment of recipe prose when the caller is the importer — was otherwise the
         * permanent label of a row in an ownerless catalog every user searches. The U10 half it was written to
         * protect is still asserted, and more strictly: the call is matched EXACTLY, so nutrition creeping back
         * into this table still fails here.
         */
        it('persists the RESOLVED status AND adopts food`s canonical name — never nutrition (U3 + U10)', async () => {
            dalMocks['findById']!.mockResolvedValue(
                makeIngredient({
                    id: 'i1',
                    name: '1 cup of sifted pastry flour',
                    foodId: 'F1',
                    foodResolutionStatus: FoodResolutionStatus.PENDING,
                }),
            );
            clientMocks['getStatus']!.mockResolvedValue(
                makeStatusResult({
                    id: 'F1',
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ name: 'Flour, wheat, all-purpose' }),
                }),
            );
            const resolved = makeIngredient({
                id: 'i1',
                name: 'Flour, wheat, all-purpose',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
            dalMocks['updateResolution']!.mockResolvedValue(resolved);

            const result = await service.refreshStatus(CALLER, 'i1');

            // ⛔ STATUS + NAME, and NOTHING ELSE. Copying the golden record's nutrition into this table is
            // exactly what U10 deleted: a snapshot with no invalidation, so a food corrected upstream left
            // every recipe quoting the old number. The numbers are read live from food now.
            expect(dalMocks['updateResolution']).toHaveBeenCalledWith('i1', {
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                canonicalName: 'Flour, wheat, all-purpose',
                // U11 (0040): the refresh SAW the food body (no private visibility), so the fact CLEARS.
                foodOwnerId: null,
            });
            expect(result).toBe(resolved);
        });

        it('⛔ does NOT rename when a RESOLVED food carries no usable name (the column is NOT NULL)', async () => {
            // The three ways the wire contract permits a nameless resolution are enumerated against the pure
            // decision in `canonicalNameFrom.test.ts`; this asserts the SERVICE honours it — a rename request
            // must not reach the DAL at all, or `COALESCE` would still be asked to blank a `NOT NULL` column.
            dalMocks['findById']!.mockResolvedValue(
                makeIngredient({ id: 'i1', name: 'butter the size of a walnut', foodId: 'F1' }),
            );
            clientMocks['getStatus']!.mockResolvedValue(
                makeStatusResult({
                    id: 'F1',
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ name: null }),
                }),
            );
            dalMocks['updateResolution']!.mockResolvedValue(
                makeIngredient({ id: 'i1', name: 'butter the size of a walnut', foodId: 'F1' }),
            );

            await service.refreshStatus(CALLER, 'i1');

            expect(dalMocks['updateResolution']).toHaveBeenCalledWith('i1', {
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                // U11 (0040): same re-capture — a non-private body clears the privacy fact.
                foodOwnerId: null,
            });
        });

        it('advances a still-PENDING status with no nutrition write', async () => {
            dalMocks['findById']!.mockResolvedValue(makeIngredient({ id: 'i1', foodId: 'F1' }));
            clientMocks['getStatus']!.mockResolvedValue(
                makeStatusResult({ id: 'F1', status: FoodResolutionStatus.PENDING }),
            );
            dalMocks['updateResolution']!.mockResolvedValue(
                makeIngredient({ id: 'i1', foodId: 'F1', foodResolutionStatus: FoodResolutionStatus.PENDING }),
            );

            await service.refreshStatus(CALLER, 'i1');

            expect(dalMocks['updateResolution']).toHaveBeenCalledWith('i1', {
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
        });

        it('records a terminal NOT_FOUND (client NotFoundError) instead of throwing', async () => {
            dalMocks['findById']!.mockResolvedValue(makeIngredient({ id: 'i1', foodId: 'F1' }));
            clientMocks['getStatus']!.mockRejectedValue(new NotFoundError('F1', FoodResolutionStatus.NOT_FOUND));
            dalMocks['updateResolution']!.mockResolvedValue(
                makeIngredient({ id: 'i1', foodId: 'F1', foodResolutionStatus: FoodResolutionStatus.NOT_FOUND }),
            );

            const result = await service.refreshStatus(CALLER, 'i1');

            expect(dalMocks['updateResolution']).toHaveBeenCalledWith('i1', {
                foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
            });
            expect(result.foodResolutionStatus).toBe(FoodResolutionStatus.NOT_FOUND);
        });

        it('is a no-op for a freeform ingredient (no food reference)', async () => {
            const freeform = makeIngredient({ id: 'f1', isUserEntered: true });
            dalMocks['findById']!.mockResolvedValue(freeform);

            const result = await service.refreshStatus(CALLER, 'f1');

            expect(result).toBe(freeform);
            expect(clientMocks['getStatus']).not.toHaveBeenCalled();
        });

        it('throws RECIPE_NOT_FOUND (as a real Error) for an unknown ingredient id', async () => {
            dalMocks['findById']!.mockResolvedValue(undefined);

            // Must be a real stack-bearing Error carrying the domain code (not a bare object literal),
            // so it egresses the shared `{ code, message, details }` envelope with a usable stack.
            await expect(service.refreshStatus(CALLER, 'missing')).rejects.toSatisfy(
                (e: unknown) => e instanceof Error && isRecipeError(e) && e.code === RecipeErrorCode.RECIPE_NOT_FOUND,
            );
        });
    });

    describe('disambiguation', () => {
        it('getCandidates proxies the food client for a food-backed ingredient', async () => {
            dalMocks['findById']!.mockResolvedValue(
                makeIngredient({ id: 'i1', foodId: 'F1', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED }),
            );
            const candidate = makeCandidateView();
            clientMocks['getCandidates']!.mockResolvedValue({ id: 'F1', candidates: [candidate] });

            const result = await service.getCandidates(CALLER, 'i1');

            expect(clientMocks['getCandidates']).toHaveBeenCalledWith('F1');
            expect(result).toEqual([candidate]);
        });

        it('getCandidates returns empty for a freeform ingredient', async () => {
            dalMocks['findById']!.mockResolvedValue(makeIngredient({ id: 'f1', isUserEntered: true }));

            expect(await service.getCandidates(CALLER, 'f1')).toEqual([]);
            expect(clientMocks['getCandidates']).not.toHaveBeenCalled();
        });

        it('resolve picks candidates then re-polls to persist resolved nutrition', async () => {
            dalMocks['findById']!.mockResolvedValue(
                makeIngredient({ id: 'i1', foodId: 'F1', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED }),
            );
            clientMocks['resolve']!.mockResolvedValue({ id: 'F1', status: FoodResolutionStatus.RESOLVED });
            clientMocks['getStatus']!.mockResolvedValue(
                makeStatusResult({ id: 'F1', status: FoodResolutionStatus.RESOLVED, food: makeFoodView() }),
            );
            const resolved = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
            dalMocks['updateResolution']!.mockResolvedValue(resolved);

            const result = await service.resolve(CALLER, 'i1', ['cand-1']);

            expect(clientMocks['resolve']).toHaveBeenCalledWith('F1', ['cand-1']);
            expect(result).toBe(resolved);
        });

        it('resolve is a converge-only NO-OP on an already-RESOLVED ingredient (never re-points it)', async () => {
            // The catalog is ownerless + shared (R5): re-resolving a settled row would let one caller
            // overwrite the food link/nutrition another caller's resolution produced. An already-RESOLVED
            // ingredient must be returned unchanged WITHOUT any food-service call or DB write. Removing the
            // converge-only guard makes the food client + updateResolution fire again → this test fails.
            const alreadyResolved = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
            dalMocks['findById']!.mockResolvedValue(alreadyResolved);

            const result = await service.resolve(CALLER, 'i1', ['a-different-candidate']);

            expect(result).toBe(alreadyResolved);
            expect(clientMocks['resolve']).not.toHaveBeenCalled();
            expect(clientMocks['getStatus']).not.toHaveBeenCalled();
            expect(dalMocks['updateResolution']).not.toHaveBeenCalled();
        });
    });

    describe('createFreeform', () => {
        it('delegates a trimmed name to the DAL freeform creation', async () => {
            const created = makeIngredient({ id: 'f1', isUserEntered: true });
            dalMocks['createFreeform']!.mockResolvedValue(created);

            const result = await service.createFreeform(makeCanonicalName('  Grandma spice  '));

            expect(dalMocks['createFreeform']).toHaveBeenCalledWith('Grandma spice');
            expect(result).toBe(created);
        });
    });
});

/*
 * ⛔ The `extractNutrition` / `extractPortions` / `parsePortion` suites were REMOVED, not deleted-and-lost:
 * those functions moved into the FOOD service with plan U10, because they were the recipe service
 * interpreting food's data. Their coverage now lives — expanded, and with the kcal/kJ and per-serving traps
 * pinned — in `packages/services/food-service/src/foods/nutrition/__tests__/`.
 */

describe('addByFoodId — the U5 prior CAPTURE (ADR-0006 forbids a cross-database join)', () => {
    it("copies the golden record's priorFraction into BOTH cache writes", async () => {
        const { dal, mocks } = makeDal();
        mocks['createFoodBacked'].mockResolvedValue(makeIngredient({ foodId: 'F-PRIOR' }));
        mocks['updateResolution'].mockResolvedValue(makeIngredient({ foodId: 'F-PRIOR' }));
        const { clients, mocks: client } = makeFoodClients();
        client.getStatus.mockResolvedValue(
            makeStatusResult({
                id: 'F-PRIOR',
                status: 'RESOLVED',
                food: makeFoodView({ name: 'Wheat flour', priorFraction: 0.42 }),
            }),
        );
        const service = new IngredientsService(dal, clients, {} as never);

        await service.addByFoodId(CALLER, 'F-PRIOR');

        expect(mocks['createFoodBacked']).toHaveBeenCalledWith(expect.objectContaining({ priorFraction: 0.42 }));
        expect(mocks['updateResolution']).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ priorFraction: 0.42 }),
        );
    });

    it('an absent prior writes NOTHING for it — absent must not clobber a captured value with null', async () => {
        const { dal, mocks } = makeDal();
        mocks['createFoodBacked'].mockResolvedValue(makeIngredient({ foodId: 'F-NOPRIOR' }));
        mocks['updateResolution'].mockResolvedValue(makeIngredient({ foodId: 'F-NOPRIOR' }));
        const { clients, mocks: client } = makeFoodClients();
        client.getStatus.mockResolvedValue(
            makeStatusResult({ id: 'F-NOPRIOR', status: 'RESOLVED', food: makeFoodView({ name: 'Obscure herb' }) }),
        );
        const service = new IngredientsService(dal, clients, {} as never);

        await service.addByFoodId(CALLER, 'F-NOPRIOR');

        expect(mocks['createFoodBacked']).toHaveBeenCalledWith(
            expect.not.objectContaining({ priorFraction: expect.anything() }),
        );
    });
});

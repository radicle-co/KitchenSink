/**
 * Unit tests for the public-foods rule on every `RecipesService` write that can leave a recipe published and public
 * (ADR-0029 §4; owner rulings 2026-11-08): create, update (which the rebind and the version restore both go through) and
 * set-visibility. The DAL, the bindings and food are doubled; the database's own copy of the rule is the LOCAL e2e's.
 *
 * What a mutant must not survive:
 *
 *  1. The refusal names EVERY private line by position, and writes nothing.
 *  2. A private food in a PRIVATE or DRAFT recipe is allowed, and costs no call to food.
 *  3. RECAPTURE: before deciding, the write asks food, as the caller, whether a captured-private food is still private.
 *     A food now public clears its captured owner INSIDE the write's transaction, before the recipe is written.
 *  4. FAIL CLOSED: food unreachable, or answering absent, means the captured value stands and the write is refused.
 *  5. The last statement of the transaction asks the database for the private lines; any row aborts the write.
 */
import { describe, expect, it, vi } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import type { Principal } from '../../auth/principal.js';
import type { FoodLookupArm } from '../../database/schema/foodLookupArm.js';
import type { FoodLookupsDal } from '../../ingredients/dal/foodLookups.dal.js';
import type { FoodRefsGateway } from '../../ingredients/foodRefs.gateway.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import type { RecipeAggregate, RecipesDal } from '../dal/recipes.dal.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import type { UpdateRecipeDto } from '../dto/updateRecipe.dto.js';
import { fakeRecipesDal, FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import { makeRecipesService } from '../__fixtures__/recipesService.fixture.js';
import { isRecipeDomainError, type RecipeDomainError } from '../recipe.error.js';

const OWNER = '01J00000000000000000AUTHOR';
const PRIVATE_LOOKUP = '00000000-0000-4000-8000-0000000000a1';
const SHARED_LOOKUP = '00000000-0000-4000-8000-0000000000a2';
const PRIVATE_FOOD = 'food-grandma-blend';
const SHARED_FOOD = 'food-catalog-flour';

const nutritionGatewayDouble = {
    lookup: async (_caller: unknown, ids: readonly string[]) => ({ byFoodId: new Map(), unansweredIds: new Set(ids) }),
} as never;

const principal: Principal = {
    userId: OWNER,
    sub: 'user_clerk_author',
    scopes: [],
    permissions: [],
    roles: ['premium'],
    principalKind: 'real',
    containment: 'enforce',
};

/** The bindings: one root bound to the author's private food, one to a shared food. */
function lookupsDouble(): FoodLookupsDal {
    const arms = new Map<string, FoodLookupArm>([
        [
            PRIVATE_LOOKUP,
            {
                kind: 'root',
                lookupId: PRIVATE_LOOKUP,
                foodId: PRIVATE_FOOD,
                foodOwnerId: OWNER,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ],
        [
            SHARED_LOOKUP,
            {
                kind: 'root',
                lookupId: SHARED_LOOKUP,
                foodId: SHARED_FOOD,
                foodOwnerId: null,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ],
    ]);

    return {
        findByIds: vi.fn(
            async (ids: readonly string[]) => new Map(ids.flatMap((id) => (arms.has(id) ? [[id, arms.get(id)!]] : []))),
        ),
    } as unknown as FoodLookupsDal;
}

type FoodSays = 'private' | 'public' | 'absent' | 'unreachable';

/** Food, answering per food id. A shared food is always public. */
function refsDouble(says: Partial<Record<string, FoodSays>> = {}): FoodRefsGateway {
    const answerFor = (id: string): FoodRefAnswer => {
        const verdict = says[id] ?? (id === PRIVATE_FOOD ? 'private' : 'public');

        if (verdict === 'absent' || verdict === 'unreachable') {
            return { outcome: verdict };
        }

        return { outcome: 'found', name: undefined, status: 'RESOLVED', isPrivate: verdict === 'private', rootId: id };
    };

    return {
        resolve: vi.fn(async (_caller: unknown, refs: readonly { kind: string; id: string }[]) => ({
            answers: new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, answerFor(ref.id)])),
            degraded: false,
        })),
    } as unknown as FoodRefsGateway;
}

const CREATE: CreateRecipeDto = {
    title: 'Soup',
    cuisine: 'Thai',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [
        { ingredientId: SHARED_LOOKUP, quantity: { kind: 'exact', value: 1 } },
        { ingredientId: PRIVATE_LOOKUP, quantity: { kind: 'exact', value: 1 } },
    ],
    steps: [{ instruction: 'Mix' }],
};

function aggregate(
    overrides: Partial<Parameters<typeof makeRecipeRow>[0]> = {},
    lookups = [SHARED_LOOKUP],
): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, cuisine: 'Thai', ...overrides });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: lookups.map((foodLookupId, sortOrder) =>
            makeIngredientLineRow({ recipeId: recipe.id, foodLookupId, sortOrder }),
        ),
    };
}

async function refusalOf(promise: Promise<unknown>): Promise<RecipeDomainError> {
    try {
        await promise;
    } catch (error) {
        if (isRecipeDomainError(error)) {
            return error;
        }

        throw error;
    }

    throw new Error('Expected a refusal, but the call resolved.');
}

function serviceOver(dal: RecipesDal, says: Partial<Record<string, FoodSays>> = {}) {
    const refs = refsDouble(says);

    return {
        service: makeRecipesService({ dal, lookups: lookupsDouble(), refs, foodNutrition: nutritionGatewayDouble }),
        refs,
    };
}

describe('RecipesService.create - public recipes hold no private food', () => {
    it('refuses a published public recipe with a private line: 409, naming the line, nothing written', async () => {
        const create = vi.fn();
        const { service } = serviceOver(fakeRecipesDal({ create }));

        const error = await refusalOf(service.create(principal, { ...CREATE, visibility: 'public' }, undefined));

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_FOODS_ON_PUBLIC_RECIPE);
        expect(error.details).toEqual({ lines: [{ sortOrder: 1, foodId: PRIVATE_FOOD }] });
        expect(create).not.toHaveBeenCalled();
    });

    it('allows the same lines in a PRIVATE recipe, and recaptures nothing even if food says the food is public', async () => {
        const create = vi.fn().mockResolvedValue(aggregate({ visibility: 'private' }, [SHARED_LOOKUP, PRIVATE_LOOKUP]));
        const clearPublicFoodOwners = vi.fn(async () => undefined);
        const { service } = serviceOver(fakeRecipesDal({ create, clearPublicFoodOwners }), {
            [PRIVATE_FOOD]: 'public',
        });

        await service.create(principal, { ...CREATE, visibility: 'private' }, undefined);

        expect(create).toHaveBeenCalledTimes(1);
        // The recapture runs only for a recipe the rule binds: a private recipe keeps the captured owner.
        expect(clearPublicFoodOwners).not.toHaveBeenCalled();
    });

    it('allows the same lines in a DRAFT, public or not', async () => {
        const create = vi.fn().mockResolvedValue(aggregate({ status: 'draft' }, [SHARED_LOOKUP, PRIVATE_LOOKUP]));
        const { service } = serviceOver(fakeRecipesDal({ create }));

        await service.create(principal, { ...CREATE, visibility: 'public', status: 'draft' }, undefined);

        expect(create).toHaveBeenCalledTimes(1);
    });

    it('RECAPTURE: a food that food now reports public clears its captured owner in the transaction, BEFORE the write', async () => {
        const create = vi.fn().mockResolvedValue(aggregate({}, [SHARED_LOOKUP, PRIVATE_LOOKUP]));
        const clearPublicFoodOwners = vi.fn(async () => undefined);
        const { service } = serviceOver(fakeRecipesDal({ create, clearPublicFoodOwners }), {
            [PRIVATE_FOOD]: 'public',
        });

        await service.create(principal, { ...CREATE, visibility: 'public' }, undefined);

        expect(clearPublicFoodOwners).toHaveBeenCalledWith(FAKE_TX, [PRIVATE_FOOD]);
        expect(clearPublicFoodOwners.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
    });

    it.each(['absent', 'unreachable', 'private'] as const)(
        'FAIL CLOSED: food answering %s keeps the captured value and refuses',
        async (says) => {
            const create = vi.fn();
            const clearPublicFoodOwners = vi.fn();
            const { service } = serviceOver(fakeRecipesDal({ create, clearPublicFoodOwners }), {
                [PRIVATE_FOOD]: says,
            });

            const error = await refusalOf(service.create(principal, { ...CREATE, visibility: 'public' }, undefined));

            expect(error.code).toBe(RecipeErrorCode.PRIVATE_FOODS_ON_PUBLIC_RECIPE);
            expect(clearPublicFoodOwners).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
        },
    );

    it('asks the database LAST: a private line it finds aborts the write even when the policy passed', async () => {
        const create = vi.fn().mockResolvedValue(aggregate({}, [SHARED_LOOKUP]));
        const privateFoodLines = vi.fn(async () => [{ sortOrder: 0, foodId: 'raced-in' }]);
        const { service } = serviceOver(fakeRecipesDal({ create, privateFoodLines }));

        const error = await refusalOf(
            service.create(
                principal,
                { ...CREATE, ingredients: [CREATE.ingredients[0]!], visibility: 'public' },
                undefined,
            ),
        );

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_FOODS_ON_PUBLIC_RECIPE);
        expect(error.details).toEqual({ lines: [{ sortOrder: 0, foodId: 'raced-in' }] });
        expect(privateFoodLines).toHaveBeenCalledWith(FAKE_TX, 'r-1');
        expect(privateFoodLines.mock.invocationCallOrder[0]).toBeGreaterThan(create.mock.invocationCallOrder[0]!);
    });

    it('does not ask the database for a private recipe', async () => {
        const create = vi.fn().mockResolvedValue(aggregate({ visibility: 'private' }, [PRIVATE_LOOKUP]));
        const privateFoodLines = vi.fn(async () => []);
        const { service } = serviceOver(fakeRecipesDal({ create, privateFoodLines }));

        await service.create(principal, { ...CREATE, visibility: 'private' }, undefined);

        expect(privateFoodLines).not.toHaveBeenCalled();
    });
});

describe('RecipesService.update - public recipes hold no private food (rebind and restore go through it)', () => {
    const patch = (overrides: Partial<UpdateRecipeDto> = {}): UpdateRecipeDto => ({ expectedVersion: 1, ...overrides });

    it('refuses replacement lines that bind a private food on a published public recipe', async () => {
        const update = vi.fn();
        const findById = vi.fn().mockResolvedValue(aggregate());
        const { service } = serviceOver(fakeRecipesDal({ findById, update }));

        const error = await refusalOf(
            service.update(
                principal,
                'r-1',
                patch({ ingredients: [{ ingredientId: PRIVATE_LOOKUP, quantity: { kind: 'exact', value: 1 } }] }),
                undefined,
            ),
        );

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_FOODS_ON_PUBLIC_RECIPE);
        expect(error.details).toEqual({ lines: [{ sortOrder: 0, foodId: PRIVATE_FOOD }] });
        expect(update).not.toHaveBeenCalled();
    });

    it('refuses PUBLISHING a draft whose stored lines hold a private food', async () => {
        const update = vi.fn();
        const findById = vi.fn().mockResolvedValue(aggregate({ status: 'draft' }, [PRIVATE_LOOKUP]));
        const { service } = serviceOver(fakeRecipesDal({ findById, update }));

        const error = await refusalOf(service.update(principal, 'r-1', patch({ status: 'published' }), undefined));

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_FOODS_ON_PUBLIC_RECIPE);
        expect(update).not.toHaveBeenCalled();
    });

    it('allows the same lines on a published PRIVATE recipe', async () => {
        const update = vi.fn().mockResolvedValue(aggregate({ visibility: 'private' }, [PRIVATE_LOOKUP]));
        const findById = vi.fn().mockResolvedValue(aggregate({ visibility: 'private' }));
        const { service } = serviceOver(fakeRecipesDal({ findById, update }));

        await service.update(
            principal,
            'r-1',
            patch({ ingredients: [{ ingredientId: PRIVATE_LOOKUP, quantity: { kind: 'exact', value: 1 } }] }),
            undefined,
        );

        expect(update).toHaveBeenCalledTimes(1);
    });

    it('RECAPTURE on update clears the owner before the recipe is written', async () => {
        const update = vi.fn().mockResolvedValue(aggregate({}, [PRIVATE_LOOKUP]));
        const findById = vi.fn().mockResolvedValue(aggregate());
        const clearPublicFoodOwners = vi.fn(async () => undefined);
        const { service } = serviceOver(fakeRecipesDal({ findById, update, clearPublicFoodOwners }), {
            [PRIVATE_FOOD]: 'public',
        });

        await service.update(
            principal,
            'r-1',
            patch({ ingredients: [{ ingredientId: PRIVATE_LOOKUP, quantity: { kind: 'exact', value: 1 } }] }),
            undefined,
        );

        expect(clearPublicFoodOwners).toHaveBeenCalledWith(FAKE_TX, [PRIVATE_FOOD]);
        expect(clearPublicFoodOwners.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]!);
    });
});

describe('RecipesService.setVisibility - public recipes hold no private food', () => {
    it('refuses making a published recipe public while it holds a private line, writing nothing', async () => {
        const setVisibility = vi.fn();
        const findById = vi
            .fn()
            .mockResolvedValue(aggregate({ visibility: 'private' }, [SHARED_LOOKUP, PRIVATE_LOOKUP]));
        const { service } = serviceOver(fakeRecipesDal({ findById, setVisibility }));

        const error = await refusalOf(service.setVisibility(principal, 'r-1', 'public' as never, undefined));

        expect(error.code).toBe(RecipeErrorCode.PRIVATE_FOODS_ON_PUBLIC_RECIPE);
        expect(error.details).toEqual({ lines: [{ sortOrder: 1, foodId: PRIVATE_FOOD }] });
        expect(setVisibility).not.toHaveBeenCalled();
    });

    it('allows making it private, and recaptures nothing', async () => {
        const setVisibility = vi.fn().mockResolvedValue(aggregate({ visibility: 'private' }, [PRIVATE_LOOKUP]));
        const findById = vi.fn().mockResolvedValue(aggregate({ visibility: 'public' }, [PRIVATE_LOOKUP]));
        const clearPublicFoodOwners = vi.fn(async () => undefined);
        const { service } = serviceOver(fakeRecipesDal({ findById, setVisibility, clearPublicFoodOwners }), {
            [PRIVATE_FOOD]: 'public',
        });

        await service.setVisibility(principal, 'r-1', 'private' as never, undefined);

        expect(setVisibility).toHaveBeenCalledTimes(1);
        expect(clearPublicFoodOwners).not.toHaveBeenCalled();
    });

    it('makes a draft public even with a private line: a draft is not bound', async () => {
        const setVisibility = vi.fn().mockResolvedValue(aggregate({ status: 'draft' }, [PRIVATE_LOOKUP]));
        const findById = vi
            .fn()
            .mockResolvedValue(aggregate({ status: 'draft', visibility: 'private' }, [PRIVATE_LOOKUP]));
        const { service } = serviceOver(fakeRecipesDal({ findById, setVisibility }));

        await service.setVisibility(principal, 'r-1', 'public' as never, undefined);

        expect(setVisibility).toHaveBeenCalledTimes(1);
    });
});

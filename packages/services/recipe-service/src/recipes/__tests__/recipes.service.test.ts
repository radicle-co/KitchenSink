/**
 * T025-test / T033-test — unit tests for {@link RecipesService} over a fake {@link RecipesDal}.
 *
 * Pins the domain rules the DAL delegates upward: response shaping (persistence row → `Recipe` wire
 * contract), owner-only mutation authorization (`NOT_OWNER`), public-read allowance, tombstone →
 * `RECIPE_NOT_FOUND`, pagination `hasMore`, and the T033 optimistic-concurrency check
 * (`VERSION_CONFLICT` with `details.currentVersion`). No database is involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { RecipesService } from '../recipes.service.js';
import type { RecipesDal, RecipeAggregate } from '../dal/recipes.dal.js';
import { isRecipeDomainError } from '../recipe.error.js';
import { makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import type { CreateRecipeDto } from '../dto/create-recipe.dto.js';
import type { UpdateRecipeDto } from '../dto/update-recipe.dto.js';

const OWNER = '01J000000000000000000FREE0';
const OTHER = '01J00000000000000000OTHER0';

function aggregate(overrides: Partial<Parameters<typeof makeRecipeRow>[0]> = {}): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, ...overrides });

    return { recipe, steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })] };
}

function fakeDal(overrides: Partial<RecipesDal> = {}): RecipesDal {
    return {
        create: vi.fn(),
        findById: vi.fn(),
        findAll: vi.fn(),
        update: vi.fn(),
        softDelete: vi.fn(),
        ...overrides,
    } as unknown as RecipesDal;
}

/** Capture the error a rejected promise throws, or fail if it resolves. */
async function catchError(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error('Expected the promise to reject, but it resolved.');
}

const CREATE_DTO: CreateRecipeDto = {
    title: 'Soup',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000ff', name: 'Onion', quantity: 1 }],
    steps: [{ instruction: 'Mix' }],
};

describe('RecipesService.create', () => {
    it('delegates to the DAL with the derived ingredientNamesText and maps the wire response', async () => {
        const created = aggregate();
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(created) });
        const service = new RecipesService(dal);

        const response = await service.create(OWNER, CREATE_DTO);

        expect(dal.create).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerId: OWNER,
                title: 'Soup',
                ingredientNamesText: 'Onion',
                visibility: 'public',
            }),
        );
        expect(response).toMatchObject({
            id: 'r-1',
            ownerId: OWNER,
            version: created.recipe.currentVersion,
            ingredients: [],
            steps: [{ stepNumber: 1, instruction: 'Mix' }],
        });
        expect(typeof response.createdAt).toBe('string');
    });
});

describe('RecipesService.getById', () => {
    it('throws RECIPE_NOT_FOUND when the recipe does not exist', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(new RecipesService(dal).getById(OWNER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER when a non-owner reads a private recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'private' })) });
        const error = await catchError(new RecipesService(dal).getById(OTHER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('allows a non-owner to read a public recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'public' })) });

        const response = await new RecipesService(dal).getById(OTHER, 'r-1');

        expect(response.id).toBe('r-1');
    });
});

describe('RecipesService.list', () => {
    it('maps rows and computes hasMore from page/pageSize/total', async () => {
        const dal = fakeDal({ findAll: vi.fn().mockResolvedValue({ rows: [aggregate()], total: 5 }) });

        const response = await new RecipesService(dal).list(OWNER, { page: 1, pageSize: 2, sortBy: 'updatedAt' });

        expect(response.total).toBe(5);
        expect(response.hasMore).toBe(true); // 1*2 < 5
        expect(response.data).toHaveLength(1);
    });

    it('reports hasMore=false on the last page', async () => {
        const dal = fakeDal({ findAll: vi.fn().mockResolvedValue({ rows: [aggregate()], total: 2 }) });

        const response = await new RecipesService(dal).list(OWNER, { page: 1, pageSize: 2, sortBy: 'updatedAt' });

        expect(response.hasMore).toBe(false);
    });
});

describe('RecipesService.update', () => {
    const patch: UpdateRecipeDto = { expectedVersion: 1, title: 'Renamed' };

    it('throws RECIPE_NOT_FOUND when the recipe is absent', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(new RecipesService(dal).update(OWNER, 'r-1', patch));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER when the caller does not own the recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()) });
        const error = await catchError(new RecipesService(dal).update(OTHER, 'r-1', patch));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('throws VERSION_CONFLICT with the current version when expectedVersion is stale (T033)', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 5 })) });
        const error = await catchError(
            new RecipesService(dal).update(OWNER, 'r-1', { expectedVersion: 3, title: 'x' }),
        );

        expect(isRecipeDomainError(error)).toBe(true);
        if (isRecipeDomainError(error)) {
            expect(error.code).toBe(RecipeErrorCode.VERSION_CONFLICT);
            expect(error.details).toEqual({ currentVersion: 5, conflictingVersion: 3 });
        }
    });

    it('updates when the version matches and returns the bumped recipe', async () => {
        const updated = aggregate({ currentVersion: 2 });
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })),
            update: vi.fn().mockResolvedValue(updated),
        });
        const service = new RecipesService(dal);

        const response = await service.update(OWNER, 'r-1', patch);

        expect(dal.update).toHaveBeenCalledWith('r-1', expect.objectContaining({ title: 'Renamed' }));
        expect(response.version).toBe(2);
    });
});

describe('RecipesService.delete', () => {
    it('throws RECIPE_NOT_FOUND when the recipe is absent', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(new RecipesService(dal).delete(OWNER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER for a non-owner', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()) });
        const error = await catchError(new RecipesService(dal).delete(OTHER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('soft-deletes when the caller owns the recipe', async () => {
        const softDelete = vi.fn().mockResolvedValue(true);
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()), softDelete });

        await new RecipesService(dal).delete(OWNER, 'r-1');

        expect(softDelete).toHaveBeenCalledWith('r-1');
    });
});

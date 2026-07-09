/**
 * T025-test / T033-test — unit tests for {@link RecipesService} over a fake {@link RecipesDal}.
 *
 * Pins the domain rules the DAL delegates upward: response shaping (persistence row → `Recipe` wire
 * contract), owner-only mutation authorization (`NOT_OWNER`), public-read allowance, tombstone →
 * `RECIPE_NOT_FOUND`, pagination `hasMore`, and the T033 optimistic-concurrency check
 * (`VERSION_CONFLICT` with `details.currentVersion`). No database is involved.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { PREMIUM_PERMISSION, RecipesService } from '../recipes.service.js';
import type { RecipesDal, RecipeAggregate } from '../dal/recipes.dal.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import { isRecipeDomainError } from '../recipe.error.js';
import { makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import { makeFakeVersionsService } from '../__fixtures__/versions.fixture.js';
import type { CreateRecipeDto } from '../dto/create-recipe.dto.js';
import type { UpdateRecipeDto } from '../dto/update-recipe.dto.js';
import type { Principal } from '../../auth/principal.js';

const OWNER = '01J000000000000000000FREE0';
const OTHER = '01J00000000000000000OTHER0';

/** A verified principal keyed on `userId` (the owner key). `permissions: ['premium']` marks premium-tier. */
function principal(overrides: Partial<Principal> = {}): Principal {
    return {
        userId: OWNER,
        sub: 'user_clerk_free',
        scopes: [],
        permissions: [],
        ...overrides,
    };
}

/** A premium principal — carries the `premium` permission the C-004 policy keys on. */
function premiumPrincipal(overrides: Partial<Principal> = {}): Principal {
    return principal({ permissions: [PREMIUM_PERMISSION], ...overrides });
}

function aggregate(overrides: Partial<Parameters<typeof makeRecipeRow>[0]> = {}): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, ...overrides });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: [],
    };
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

/** A catalog DAL whose `findById` resolves every line to a freeform ingredient (composition off-path). */
function fakeIngredientsDal(): IngredientsDal {
    return {
        findById: vi
            .fn()
            .mockResolvedValue(makeIngredient({ id: '00000000-0000-4000-8000-0000000000ff', name: 'Onion' })),
    } as unknown as IngredientsDal;
}

/** Construct the service with a permissive catalog DAL (overridable per test via the DAL arg). */
function newService(dal: RecipesDal): RecipesService {
    return new RecipesService(dal, fakeIngredientsDal(), makeFakeVersionsService());
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
        const service = newService(dal);

        const response = await service.create(principal(), CREATE_DTO);

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

    it('defaults visibility to public when the DTO omits it (free-tier)', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate()) });

        // CREATE_DTO carries no `visibility`.
        await newService(dal).create(principal(), CREATE_DTO);

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'public' }));
    });

    it('records a version snapshot of the created recipe (FR-007b history populates)', async () => {
        const created = aggregate({ currentVersion: 1 });
        const versions = makeFakeVersionsService();
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(created) });
        const service = new RecipesService(dal, fakeIngredientsDal(), versions);

        await service.create(principal(), CREATE_DTO);

        expect(versions.createSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                recipeId: created.recipe.id,
                versionNumber: created.recipe.currentVersion,
                createdBy: OWNER,
                snapshot: expect.objectContaining({
                    version: created.recipe.currentVersion,
                    title: created.recipe.title,
                }),
            }),
        );
    });

    // C-004 / FR-003 (ADV-3): a create is a `user_created` recipe with no substantive edit, so the
    // requested visibility MUST pass evaluateVisibility. Removing that gate (the mutation) lets a
    // free-tier caller persist `private`, which these two tests forbid.
    it('rejects a free-tier caller requesting private with INVALID_VISIBILITY and never touches the DAL', async () => {
        const dal = fakeDal({ create: vi.fn() });

        const error = await catchError(
            newService(dal).create(principal(), { ...CREATE_DTO, visibility: 'private' }),
        );

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        // The gate runs BEFORE any persistence — no private row is ever written.
        expect(dal.create).not.toHaveBeenCalled();
    });

    it('lets a premium caller create a private recipe', async () => {
        const dal = fakeDal({ create: vi.fn().mockResolvedValue(aggregate({ visibility: 'private' })) });

        const response = await newService(dal).create(premiumPrincipal(), {
            ...CREATE_DTO,
            visibility: 'private',
        });

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
        expect(response.visibility).toBe('private');
    });

    it('marks premium off the permissions claim, not scopes (a premium scope must not unlock private)', async () => {
        const dal = fakeDal({ create: vi.fn() });

        // `premium` sits in scopes, not permissions — the policy keys on permissions, so this is free-tier.
        const error = await catchError(
            newService(dal).create(principal({ scopes: [PREMIUM_PERMISSION] }), {
                ...CREATE_DTO,
                visibility: 'private',
            }),
        );

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(dal.create).not.toHaveBeenCalled();
    });
});

describe('RecipesService.getById', () => {
    it('throws RECIPE_NOT_FOUND when the recipe does not exist', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).getById(OWNER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER when a non-owner reads a private recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'private' })) });
        const error = await catchError(newService(dal).getById(OTHER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('allows a non-owner to read a public recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ visibility: 'public' })) });

        const response = await newService(dal).getById(OTHER, 'r-1');

        expect(response.id).toBe('r-1');
    });
});

describe('RecipesService.list', () => {
    it('maps rows and computes hasMore from page/pageSize/total', async () => {
        const dal = fakeDal({ findAll: vi.fn().mockResolvedValue({ rows: [aggregate()], total: 5 }) });

        const response = await newService(dal).list(OWNER, { page: 1, pageSize: 2, sortBy: 'updatedAt' });

        expect(response.total).toBe(5);
        expect(response.hasMore).toBe(true); // 1*2 < 5
        expect(response.data).toHaveLength(1);
    });

    it('reports hasMore=false on the last page', async () => {
        const dal = fakeDal({ findAll: vi.fn().mockResolvedValue({ rows: [aggregate()], total: 2 }) });

        const response = await newService(dal).list(OWNER, { page: 1, pageSize: 2, sortBy: 'updatedAt' });

        expect(response.hasMore).toBe(false);
    });
});

describe('RecipesService.update', () => {
    const patch: UpdateRecipeDto = { expectedVersion: 1, title: 'Renamed' };

    it('throws RECIPE_NOT_FOUND when the recipe is absent', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).update(OWNER, 'r-1', patch));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER when the caller does not own the recipe', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()) });
        const error = await catchError(newService(dal).update(OTHER, 'r-1', patch));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('throws VERSION_CONFLICT with the current version when expectedVersion is stale (T033)', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 5 })) });
        const error = await catchError(newService(dal).update(OWNER, 'r-1', { expectedVersion: 3, title: 'x' }));

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
        const service = newService(dal);

        const response = await service.update(OWNER, 'r-1', patch);

        expect(dal.update).toHaveBeenCalledWith('r-1', expect.objectContaining({ title: 'Renamed' }));
        expect(response.version).toBe(2);
    });

    it('records a version snapshot after a successful update', async () => {
        const versions = makeFakeVersionsService();
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });
        const service = new RecipesService(dal, fakeIngredientsDal(), versions);

        await service.update(OWNER, 'r-1', patch);

        expect(versions.createSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({ recipeId: 'r-1', versionNumber: 2, createdBy: OWNER }),
        );
    });

    it('does NOT record a snapshot when the caller opts out (restore path avoids a double version)', async () => {
        const versions = makeFakeVersionsService();
        const dal = fakeDal({
            findById: vi.fn().mockResolvedValue(aggregate({ currentVersion: 1 })),
            update: vi.fn().mockResolvedValue(aggregate({ currentVersion: 2 })),
        });
        const service = new RecipesService(dal, fakeIngredientsDal(), versions);

        await service.update(OWNER, 'r-1', patch, { recordSnapshot: false });

        expect(versions.createSnapshot).not.toHaveBeenCalled();
    });
});

describe('RecipesService.delete', () => {
    it('throws RECIPE_NOT_FOUND when the recipe is absent', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const error = await catchError(newService(dal).delete(OWNER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
    });

    it('throws NOT_OWNER for a non-owner', async () => {
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()) });
        const error = await catchError(newService(dal).delete(OTHER, 'r-1'));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.NOT_OWNER);
    });

    it('soft-deletes when the caller owns the recipe', async () => {
        const softDelete = vi.fn().mockResolvedValue(true);
        const dal = fakeDal({ findById: vi.fn().mockResolvedValue(aggregate()), softDelete });

        await newService(dal).delete(OWNER, 'r-1');

        expect(softDelete).toHaveBeenCalledWith('r-1');
    });
});

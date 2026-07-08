/**
 * T026-test — unit tests for {@link RecipesController} over a fake {@link RecipesService}.
 *
 * Asserts the thin controller's only responsibilities: it reads the owner key from
 * `req.principal.userId`, delegates to the service with the right arguments, returns the service's
 * result verbatim, and rejects (401) when no principal is present. HTTP status codes (`201`/`204`) are
 * declared with framework decorators and verified by the controller integration/e2e specs.
 */
import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { RecipesController } from '../recipes.controller.js';
import type { RecipesService } from '../recipes.service.js';
import type { AuthenticatedRequest } from '../../auth/principal.js';
import type { CreateRecipeDto } from '../dto/create-recipe.dto.js';
import type { UpdateRecipeDto } from '../dto/update-recipe.dto.js';
import type { ListRecipesQueryDto } from '../dto/list-recipes.query.dto.js';
import type { RecipeResponse } from '../dto/recipe-response.dto.js';

const OWNER = '01J000000000000000000FREE0';

function reqWith(userId?: string): AuthenticatedRequest {
    return { principal: userId ? { userId } : undefined } as unknown as AuthenticatedRequest;
}

function fakeService(overrides: Partial<RecipesService> = {}): RecipesService {
    return {
        create: vi.fn(),
        getById: vi.fn(),
        list: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        ...overrides,
    } as unknown as RecipesService;
}

const RESPONSE = { id: 'r-1', ownerId: OWNER } as unknown as RecipeResponse;

describe('RecipesController', () => {
    it('create delegates the owner key + body and returns the service result', async () => {
        const create = vi.fn().mockResolvedValue(RESPONSE);
        const controller = new RecipesController(fakeService({ create }));
        const body = { title: 'Soup' } as CreateRecipeDto;

        const result = await controller.create(reqWith(OWNER), body);

        expect(create).toHaveBeenCalledWith(OWNER, body);
        expect(result).toBe(RESPONSE);
    });

    it('list delegates the owner key + query', async () => {
        const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false });
        const controller = new RecipesController(fakeService({ list }));
        const query = { page: 1, pageSize: 20, sortBy: 'updatedAt' } as ListRecipesQueryDto;

        await controller.list(reqWith(OWNER), query);

        expect(list).toHaveBeenCalledWith(OWNER, query);
    });

    it('getById delegates the owner key + id', async () => {
        const getById = vi.fn().mockResolvedValue(RESPONSE);
        const controller = new RecipesController(fakeService({ getById }));

        const result = await controller.getById(reqWith(OWNER), 'r-1');

        expect(getById).toHaveBeenCalledWith(OWNER, 'r-1');
        expect(result).toBe(RESPONSE);
    });

    it('update delegates the owner key, id, and body', async () => {
        const update = vi.fn().mockResolvedValue(RESPONSE);
        const controller = new RecipesController(fakeService({ update }));
        const body = { expectedVersion: 1, title: 'Renamed' } as UpdateRecipeDto;

        await controller.update(reqWith(OWNER), 'r-1', body);

        expect(update).toHaveBeenCalledWith(OWNER, 'r-1', body);
    });

    it('remove delegates the owner key + id and resolves void', async () => {
        const deleteFn = vi.fn().mockResolvedValue(undefined);
        const controller = new RecipesController(fakeService({ delete: deleteFn }));

        await expect(controller.remove(reqWith(OWNER), 'r-1')).resolves.toBeUndefined();
        expect(deleteFn).toHaveBeenCalledWith(OWNER, 'r-1');
    });

    it('rejects with 401 when no principal is present', async () => {
        const create = vi.fn();
        const controller = new RecipesController(fakeService({ create }));

        await expect(controller.create(reqWith(undefined), {} as CreateRecipeDto)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        expect(create).not.toHaveBeenCalled();
    });
});

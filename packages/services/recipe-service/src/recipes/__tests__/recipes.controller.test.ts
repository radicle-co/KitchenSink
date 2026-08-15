/**
 * T026-test — unit tests for {@link RecipesController} over a fake {@link RecipesService}.
 *
 * Asserts the thin controller's only responsibilities: it receives the owner key / principal already
 * resolved by the `@OwnerId()` / `@CurrentPrincipal()` decorators, delegates to the service with the
 * right arguments, and returns the service's result verbatim. The "missing principal → 401" path now
 * lives on the decorators and is covered by `auth/__tests__/currentPrincipal.decorator.test.ts`. HTTP
 * status codes (`201`/`204`) are declared with framework decorators and verified by the integration/e2e
 * specs.
 */
import { describe, it, expect, vi } from 'vitest';

import { RecipesController } from '../recipes.controller.js';
import type { RecipesService } from '../recipes.service.js';
import type { Principal } from '../../auth/principal.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import type { UpdateRecipeDto } from '../dto/updateRecipe.dto.js';
import type { ListRecipesQueryDto } from '../dto/listRecipes.query.dto.js';
import type { RecipeResponse } from '../dto/recipeResponse.dto.js';
import type { CloneRecipeDto } from '../dto/cloneRecipe.dto.js';
import type { SetVisibilityDto } from '../dto/setVisibility.dto.js';

const OWNER = '01J000000000000000000FREE0';
const PRINCIPAL = { userId: OWNER, sub: 'clerk_sub', scopes: [], permissions: ['premium'] } as Principal;

function fakeService(overrides: Partial<RecipesService> = {}): RecipesService {
    return {
        create: vi.fn(),
        getById: vi.fn(),
        list: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        clone: vi.fn(),
        setVisibility: vi.fn(),
        ...overrides,
    } as unknown as RecipesService;
}

const RESPONSE = { id: 'r-1', ownerId: OWNER } as unknown as RecipeResponse;

describe('RecipesController', () => {
    it('create delegates the full principal + body and returns the service result', async () => {
        const create = vi.fn().mockResolvedValue(RESPONSE);
        const controller = new RecipesController(fakeService({ create }));
        const body = { title: 'Soup' } as CreateRecipeDto;

        // Create needs the whole principal (not just the owner key) so the service can derive premium
        // for the C-004 visibility gate — assert the verified principal is forwarded verbatim.
        const result = await controller.create(PRINCIPAL, body);

        expect(create).toHaveBeenCalledWith(PRINCIPAL, body);
        expect(result).toBe(RESPONSE);
    });

    it('list delegates the owner key + query', async () => {
        const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false });
        const controller = new RecipesController(fakeService({ list }));
        const query = { page: 1, pageSize: 20, sortBy: 'updatedAt' } as ListRecipesQueryDto;

        await controller.list(OWNER, query);

        expect(list).toHaveBeenCalledWith(OWNER, query);
    });

    it('getById delegates the owner key + id', async () => {
        const getById = vi.fn().mockResolvedValue(RESPONSE);
        const controller = new RecipesController(fakeService({ getById }));

        const result = await controller.getById(OWNER, 'r-1');

        expect(getById).toHaveBeenCalledWith(OWNER, 'r-1');
        expect(result).toBe(RESPONSE);
    });

    it('update delegates the verified principal, id, and body', async () => {
        const update = vi.fn().mockResolvedValue(RESPONSE);
        const controller = new RecipesController(fakeService({ update }));
        const body = { expectedVersion: 1, title: 'Renamed' } as UpdateRecipeDto;

        // Update needs the whole principal (not just the owner key) so the service can derive the editor
        // handle for the version snapshot — assert the verified principal is forwarded verbatim.
        await controller.update(PRINCIPAL, 'r-1', body);

        expect(update).toHaveBeenCalledWith(PRINCIPAL, 'r-1', body);
    });

    it('remove delegates the owner key + id and resolves void', async () => {
        const deleteFn = vi.fn().mockResolvedValue(undefined);
        const controller = new RecipesController(fakeService({ delete: deleteFn }));

        await expect(controller.remove(OWNER, 'r-1')).resolves.toBeUndefined();
        expect(deleteFn).toHaveBeenCalledWith(OWNER, 'r-1');
    });

    it('clone delegates the verified principal + id and returns the service result', async () => {
        const clone = vi.fn().mockResolvedValue(RESPONSE);
        const controller = new RecipesController(fakeService({ clone }));

        const result = await controller.clone(PRINCIPAL, 'r-1', {} as CloneRecipeDto);

        expect(clone).toHaveBeenCalledWith(PRINCIPAL, 'r-1');
        expect(result).toBe(RESPONSE);
    });

    it('setVisibility delegates the principal, id, and requested visibility', async () => {
        const setVisibility = vi.fn().mockResolvedValue(RESPONSE);
        const controller = new RecipesController(fakeService({ setVisibility }));

        const result = await controller.setVisibility(PRINCIPAL, 'r-1', { visibility: 'private' } as SetVisibilityDto);

        expect(setVisibility).toHaveBeenCalledWith(PRINCIPAL, 'r-1', 'private');
        expect(result).toBe(RESPONSE);
    });
});

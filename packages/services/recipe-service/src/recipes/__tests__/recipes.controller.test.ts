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
import type { AnalyticsService } from '../../analytics/analytics.service.js';
import type { Principal } from '../../auth/principal.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import type { UpdateRecipeDto } from '../dto/updateRecipe.dto.js';
import type { ListRecipesQueryDto } from '../dto/listRecipes.query.dto.js';
import type { RecipeResponse } from '../dto/recipeResponse.dto.js';
import type { CloneRecipeDto } from '../dto/cloneRecipe.dto.js';
import type { SetVisibilityDto } from '../dto/setVisibility.dto.js';

/** The caller's opaque bearer, forwarded to the food service for the nutrition read (U10). */
const CALLER = { kind: 'caller-token' } as never;

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

/** U3: the view-capture collaborator — `capture` is sync-void fire-and-forget, so one mock suffices. */
function fakeAnalytics(): { capture: ReturnType<typeof vi.fn> } {
    return { capture: vi.fn() };
}

function makeController(
    service: RecipesService,
    analytics: { capture: ReturnType<typeof vi.fn> } = fakeAnalytics(),
): RecipesController {
    return new RecipesController(service, analytics as unknown as AnalyticsService);
}

describe('RecipesController', () => {
    it('create delegates the full principal + body and returns the service result', async () => {
        const create = vi.fn().mockResolvedValue(RESPONSE);
        const controller = makeController(fakeService({ create }));
        const body = { title: 'Soup' } as CreateRecipeDto;

        // Create needs the whole principal (not just the owner key) so the service can derive premium
        // for the C-004 visibility gate — assert the verified principal is forwarded verbatim.
        const result = await controller.create(PRINCIPAL, CALLER, body);

        // The caller's bearer is forwarded too (U10): the food service authorizes the nutrition read AS
        // this user, and a dropped credential degrades every recipe to nutrition-absent.
        expect(create).toHaveBeenCalledWith(PRINCIPAL, body, CALLER);
        expect(result).toBe(RESPONSE);
    });

    it('list delegates the owner key + query', async () => {
        const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false });
        const controller = makeController(fakeService({ list }));
        const query = { page: 1, pageSize: 20, sortBy: 'updatedAt' } as ListRecipesQueryDto;

        await controller.list(OWNER, query);

        expect(list).toHaveBeenCalledWith(OWNER, query);
    });

    it('getById delegates the owner key + id', async () => {
        const getById = vi.fn().mockResolvedValue(RESPONSE);
        const controller = makeController(fakeService({ getById }));

        const result = await controller.getById(OWNER, 'r-1', CALLER);

        expect(getById).toHaveBeenCalledWith(OWNER, 'r-1', CALLER);
        expect(result).toBe(RESPONSE);
    });

    it('update delegates the verified principal, id, and body', async () => {
        const update = vi.fn().mockResolvedValue(RESPONSE);
        const controller = makeController(fakeService({ update }));
        const body = { expectedVersion: 1, title: 'Renamed' } as UpdateRecipeDto;

        // Update needs the whole principal (not just the owner key) so the service can derive the editor
        // handle for the version snapshot — assert the verified principal is forwarded verbatim.
        await controller.update(PRINCIPAL, 'r-1', body);

        expect(update).toHaveBeenCalledWith(PRINCIPAL, 'r-1', body);
    });

    it('remove delegates the owner key + id and resolves void', async () => {
        const deleteFn = vi.fn().mockResolvedValue(undefined);
        const controller = makeController(fakeService({ delete: deleteFn }));

        await expect(controller.remove(OWNER, 'r-1')).resolves.toBeUndefined();
        expect(deleteFn).toHaveBeenCalledWith(OWNER, 'r-1');
    });

    it('clone delegates the verified principal + id and returns the service result', async () => {
        const clone = vi.fn().mockResolvedValue(RESPONSE);
        const controller = makeController(fakeService({ clone }));

        const result = await controller.clone(PRINCIPAL, 'r-1', {} as CloneRecipeDto);

        expect(clone).toHaveBeenCalledWith(PRINCIPAL, 'r-1');
        expect(result).toBe(RESPONSE);
    });

    it('setVisibility delegates the principal, id, and requested visibility', async () => {
        const setVisibility = vi.fn().mockResolvedValue(RESPONSE);
        const controller = makeController(fakeService({ setVisibility }));

        const result = await controller.setVisibility(PRINCIPAL, 'r-1', { visibility: 'private' } as SetVisibilityDto);

        expect(setVisibility).toHaveBeenCalledWith(PRINCIPAL, 'r-1', 'private');
        expect(result).toBe(RESPONSE);
    });

    // ── U3: view capture at the DETAIL handler, deliberately not RecipesService.getById ──────────
    // The service method is also an internal authorization helper (photos ×2, versions ×3, ratings ×1);
    // capturing there would count every photo upload and version restore as a view, permanently
    // inflating the lifetime counts 015 will consume. The controller handler observes exactly the
    // detail READS — so capture lives here, and the integration suite's zero-view scenarios pin the
    // other routes.

    it('getById captures ONE recipe_viewed event for the verified caller after a successful read (U3)', async () => {
        const getById = vi.fn().mockResolvedValue(RESPONSE);
        const analytics = fakeAnalytics();
        const controller = makeController(fakeService({ getById }), analytics);

        await controller.getById(OWNER, 'r-1', CALLER);

        expect(analytics.capture).toHaveBeenCalledTimes(1);
        expect(analytics.capture).toHaveBeenCalledWith({ type: 'recipe_viewed', userId: OWNER, recipeId: 'r-1' });
    });

    it('getById captures NOTHING when the read fails — a 404/403 is not a view', async () => {
        const getById = vi.fn().mockRejectedValue(new Error('RECIPE_NOT_FOUND'));
        const analytics = fakeAnalytics();
        const controller = makeController(fakeService({ getById }), analytics);

        await expect(controller.getById(OWNER, 'gone', CALLER)).rejects.toThrow();

        expect(analytics.capture).not.toHaveBeenCalled();
    });

    it('no OTHER handler captures a view — create, list, update, delete, clone are not reads of a detail', async () => {
        const analytics = fakeAnalytics();
        const service = fakeService({
            create: vi.fn().mockResolvedValue(RESPONSE),
            list: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false }),
            update: vi.fn().mockResolvedValue(RESPONSE),
            delete: vi.fn().mockResolvedValue(undefined),
            clone: vi.fn().mockResolvedValue(RESPONSE),
        });
        const controller = makeController(service, analytics);

        await controller.create(PRINCIPAL, CALLER, { title: 'Soup' } as CreateRecipeDto);
        await controller.list(OWNER, { page: 1, pageSize: 20, sortBy: 'updatedAt' } as ListRecipesQueryDto);
        await controller.update(PRINCIPAL, 'r-1', { expectedVersion: 1 } as UpdateRecipeDto);
        await controller.remove(OWNER, 'r-1');
        await controller.clone(PRINCIPAL, 'r-1', {} as CloneRecipeDto);

        expect(analytics.capture).not.toHaveBeenCalled();
    });
});

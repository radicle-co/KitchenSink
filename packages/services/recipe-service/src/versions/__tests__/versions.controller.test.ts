/**
 * T032-test — unit tests for {@link VersionsController} over a fake {@link VersionsService}.
 *
 * Asserts the thin controller's only responsibilities: it reads the owner key from
 * `req.principal.userId`, delegates to the service with the right arguments, returns the service's
 * result verbatim, and rejects (401) when no principal is present. HTTP status codes are declared with
 * framework decorators and verified by the integration/e2e specs.
 */
import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { VersionsController } from '../versions.controller.js';
import type { VersionsService } from '../versions.service.js';
import type { AuthenticatedRequest } from '../../auth/principal.js';
import type { RecipeVersion } from '@kitchensink/recipe-core';

const OWNER = '01J000000000000000000FREE0';
const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
const VERSION_ID = '00000000-0000-4000-8000-00000000c001';

function reqWith(userId?: string): AuthenticatedRequest {
    return { principal: userId ? { userId } : undefined } as unknown as AuthenticatedRequest;
}

function fakeService(overrides: Partial<VersionsService> = {}): VersionsService {
    return {
        createSnapshot: vi.fn(),
        list: vi.fn(),
        get: vi.fn(),
        restore: vi.fn(),
        ...overrides,
    } as unknown as VersionsService;
}

const VERSION = { id: VERSION_ID, recipeId: RECIPE_ID, versionNumber: 1 } as unknown as RecipeVersion;

describe('VersionsController', () => {
    it('list delegates the owner key + recipe id and returns the service result', async () => {
        const list = vi.fn().mockResolvedValue([VERSION]);
        const controller = new VersionsController(fakeService({ list }));

        const result = await controller.list(reqWith(OWNER), RECIPE_ID);

        expect(list).toHaveBeenCalledWith(OWNER, RECIPE_ID);
        expect(result).toEqual([VERSION]);
    });

    it('getById delegates the owner key + recipe id + version id', async () => {
        const get = vi.fn().mockResolvedValue(VERSION);
        const controller = new VersionsController(fakeService({ get }));

        const result = await controller.getById(reqWith(OWNER), RECIPE_ID, VERSION_ID);

        expect(get).toHaveBeenCalledWith(OWNER, RECIPE_ID, VERSION_ID);
        expect(result).toBe(VERSION);
    });

    it('restore delegates the owner key + recipe id + version id', async () => {
        const restore = vi.fn().mockResolvedValue(VERSION);
        const controller = new VersionsController(fakeService({ restore }));

        const result = await controller.restore(reqWith(OWNER), RECIPE_ID, VERSION_ID);

        expect(restore).toHaveBeenCalledWith(OWNER, RECIPE_ID, VERSION_ID);
        expect(result).toBe(VERSION);
    });

    it('rejects with 401 when no principal is present', async () => {
        const list = vi.fn();
        const controller = new VersionsController(fakeService({ list }));

        await expect(controller.list(reqWith(undefined), RECIPE_ID)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(list).not.toHaveBeenCalled();
    });
});

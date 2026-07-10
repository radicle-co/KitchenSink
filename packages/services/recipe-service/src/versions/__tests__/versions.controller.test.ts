/**
 * T032-test — unit tests for {@link VersionsController} over a fake {@link VersionsService}.
 *
 * Asserts the thin controller's only responsibilities: it receives the owner key already resolved by
 * the `@OwnerId()` decorator, delegates to the service with the right arguments, and returns the
 * service's result verbatim. The "missing principal → 401" path lives on the decorator and is covered
 * by `auth/__tests__/current-principal.decorator.test.ts`. HTTP status codes are declared with
 * framework decorators and verified by the integration/e2e specs.
 */
import { describe, it, expect, vi } from 'vitest';

import { VersionsController } from '../versions.controller.js';
import type { VersionsService } from '../versions.service.js';
import type { RecipeVersion } from '@kitchensink/recipe-core';

const OWNER = '01J000000000000000000FREE0';
const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
const VERSION_NUMBER = 1;

function fakeService(overrides: Partial<VersionsService> = {}): VersionsService {
    return {
        createSnapshot: vi.fn(),
        list: vi.fn(),
        get: vi.fn(),
        restore: vi.fn(),
        ...overrides,
    } as unknown as VersionsService;
}

const VERSION = { id: 'v-1', recipeId: RECIPE_ID, versionNumber: 1 } as unknown as RecipeVersion;

describe('VersionsController', () => {
    it('list delegates the owner key + recipe id and returns the service result', async () => {
        const list = vi.fn().mockResolvedValue([VERSION]);
        const controller = new VersionsController(fakeService({ list }));

        const result = await controller.list(OWNER, RECIPE_ID);

        expect(list).toHaveBeenCalledWith(OWNER, RECIPE_ID);
        expect(result).toEqual([VERSION]);
    });

    it('getByVersionNumber delegates the owner key + recipe id + integer versionNumber', async () => {
        const get = vi.fn().mockResolvedValue(VERSION);
        const controller = new VersionsController(fakeService({ get }));

        const result = await controller.getByVersionNumber(OWNER, RECIPE_ID, VERSION_NUMBER);

        expect(get).toHaveBeenCalledWith(OWNER, RECIPE_ID, VERSION_NUMBER);
        expect(result).toBe(VERSION);
    });

    it('restore delegates the owner key + recipe id + integer versionNumber and returns the envelope', async () => {
        const envelope = { recipe: { id: RECIPE_ID }, restoredFromVersion: 1, currentVersion: 3 };
        const restore = vi.fn().mockResolvedValue(envelope);
        const controller = new VersionsController(fakeService({ restore }));

        const result = await controller.restore(OWNER, RECIPE_ID, VERSION_NUMBER);

        expect(restore).toHaveBeenCalledWith(OWNER, RECIPE_ID, VERSION_NUMBER);
        expect(result).toBe(envelope);
    });
});

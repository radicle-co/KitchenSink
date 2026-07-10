/**
 * T036-test — unit tests for {@link PhotosController} over a fake {@link PhotosService}.
 *
 * Mirrors the recipes controller suite: the thin controller receives the owner key already resolved by
 * the `@OwnerId()` decorator, delegates to the service with the path `recipeId` + body, and returns the
 * service result verbatim. The "missing principal → 401" path lives on the decorator and is covered by
 * `auth/__tests__/current-principal.decorator.test.ts`. HTTP status codes are declared with framework
 * decorators and verified by the integration/e2e specs.
 */
import { describe, it, expect, vi } from 'vitest';

import { PhotosController } from '../photos.controller.js';
import type { PhotosService } from '../photos.service.js';
import type { CreatePhotoUploadDto } from '../dto/create-photo-upload.dto.js';
import type { ConfirmPhotoDto } from '../dto/confirm-photo.dto.js';
import type { ReorderPhotosDto } from '../dto/reorder-photos.dto.js';
import type { RecipePhoto } from '@kitchensink/recipe-core';

const OWNER = '01J000000000000000000FREE0';
const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';

function fakeService(overrides: Partial<PhotosService> = {}): PhotosService {
    return {
        createUploadUrl: vi.fn(),
        confirm: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        reorder: vi.fn(),
        ...overrides,
    } as unknown as PhotosService;
}

const PHOTO = { id: 'p-1', recipeId: RECIPE_ID } as unknown as RecipePhoto;

describe('PhotosController', () => {
    it('createUploadUrl delegates owner + recipeId + the request body and returns the result', async () => {
        const response = { uploadUrl: 'u', key: 'k', expiresIn: 900, maxBytes: 1 };
        const createUploadUrl = vi.fn().mockResolvedValue(response);
        const controller = new PhotosController(fakeService({ createUploadUrl }));
        const body = { contentType: 'image/jpeg', fileName: 'dish.jpg', fileSize: 1024 } as CreatePhotoUploadDto;

        const result = await controller.createUploadUrl(OWNER, RECIPE_ID, body);

        expect(createUploadUrl).toHaveBeenCalledWith(OWNER, RECIPE_ID, body);
        expect(result).toEqual(response);
    });

    it('confirm delegates owner + recipeId + the object key and returns the created photo', async () => {
        const confirm = vi.fn().mockResolvedValue(PHOTO);
        const controller = new PhotosController(fakeService({ confirm }));
        const body = { key: 'recipes/o/r/photos/x', contentType: 'image/jpeg' } as ConfirmPhotoDto;

        const result = await controller.confirm(OWNER, RECIPE_ID, body);

        expect(confirm).toHaveBeenCalledWith(OWNER, RECIPE_ID, 'recipes/o/r/photos/x');
        expect(result).toBe(PHOTO);
    });

    it('list delegates the recipeId and returns the photos', async () => {
        const list = vi.fn().mockResolvedValue([PHOTO]);
        const controller = new PhotosController(fakeService({ list }));

        const result = await controller.list(OWNER, RECIPE_ID);

        expect(list).toHaveBeenCalledWith(OWNER, RECIPE_ID);
        expect(result).toEqual([PHOTO]);
    });

    it('remove delegates recipeId + photoId and resolves void', async () => {
        const deleteFn = vi.fn().mockResolvedValue(undefined);
        const controller = new PhotosController(fakeService({ delete: deleteFn }));

        await expect(controller.remove(OWNER, RECIPE_ID, 'p-1')).resolves.toBeUndefined();
        expect(deleteFn).toHaveBeenCalledWith(OWNER, RECIPE_ID, 'p-1');
    });

    it('reorder delegates recipeId + photoIds and returns the reordered photos', async () => {
        const reorder = vi.fn().mockResolvedValue([PHOTO]);
        const controller = new PhotosController(fakeService({ reorder }));
        const body = { photoIds: ['p-2', 'p-1'] } as ReorderPhotosDto;

        const result = await controller.reorder(OWNER, RECIPE_ID, body);

        expect(reorder).toHaveBeenCalledWith(OWNER, RECIPE_ID, ['p-2', 'p-1']);
        expect(result).toEqual([PHOTO]);
    });
});

/**
 * T036-test — unit tests for {@link PhotosController} over a fake {@link PhotosService}.
 *
 * Mirrors the recipes controller suite: the thin controller reads the owner key from
 * `req.principal.userId`, delegates to the service with the path `recipeId` + body, returns the
 * service result verbatim, and rejects (401) when no principal is present. HTTP status codes are
 * declared with framework decorators and verified by the integration/e2e specs.
 */
import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { PhotosController } from '../photos.controller.js';
import type { PhotosService } from '../photos.service.js';
import type { AuthenticatedRequest } from '../../auth/principal.js';
import type { CreatePhotoUploadDto } from '../dto/create-photo-upload.dto.js';
import type { ConfirmPhotoDto } from '../dto/confirm-photo.dto.js';
import type { ReorderPhotosDto } from '../dto/reorder-photos.dto.js';
import type { RecipePhoto } from '@kitchensink/recipe-core';

const OWNER = '01J000000000000000000FREE0';
const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';

function reqWith(userId?: string): AuthenticatedRequest {
    return { principal: userId ? { userId } : undefined } as unknown as AuthenticatedRequest;
}

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
    it('createUploadUrl delegates owner + recipeId + contentType and returns the result', async () => {
        const createUploadUrl = vi.fn().mockResolvedValue({ uploadUrl: 'u', s3Key: 'k', maxBytes: 1 });
        const controller = new PhotosController(fakeService({ createUploadUrl }));
        const body = { contentType: 'image/jpeg' } as CreatePhotoUploadDto;

        const result = await controller.createUploadUrl(reqWith(OWNER), RECIPE_ID, body);

        expect(createUploadUrl).toHaveBeenCalledWith(OWNER, RECIPE_ID, 'image/jpeg');
        expect(result).toEqual({ uploadUrl: 'u', s3Key: 'k', maxBytes: 1 });
    });

    it('confirm delegates owner + recipeId + s3Key and returns the created photo', async () => {
        const confirm = vi.fn().mockResolvedValue(PHOTO);
        const controller = new PhotosController(fakeService({ confirm }));
        const body = { s3Key: 'recipes/o/r/photos/x' } as ConfirmPhotoDto;

        const result = await controller.confirm(reqWith(OWNER), RECIPE_ID, body);

        expect(confirm).toHaveBeenCalledWith(OWNER, RECIPE_ID, 'recipes/o/r/photos/x');
        expect(result).toBe(PHOTO);
    });

    it('list delegates the recipeId and returns the photos', async () => {
        const list = vi.fn().mockResolvedValue([PHOTO]);
        const controller = new PhotosController(fakeService({ list }));

        const result = await controller.list(reqWith(OWNER), RECIPE_ID);

        expect(list).toHaveBeenCalledWith(OWNER, RECIPE_ID);
        expect(result).toEqual([PHOTO]);
    });

    it('remove delegates recipeId + photoId and resolves void', async () => {
        const deleteFn = vi.fn().mockResolvedValue(undefined);
        const controller = new PhotosController(fakeService({ delete: deleteFn }));

        await expect(controller.remove(reqWith(OWNER), RECIPE_ID, 'p-1')).resolves.toBeUndefined();
        expect(deleteFn).toHaveBeenCalledWith(OWNER, RECIPE_ID, 'p-1');
    });

    it('reorder delegates recipeId + photoIds and returns the reordered photos', async () => {
        const reorder = vi.fn().mockResolvedValue([PHOTO]);
        const controller = new PhotosController(fakeService({ reorder }));
        const body = { photoIds: ['p-2', 'p-1'] } as ReorderPhotosDto;

        const result = await controller.reorder(reqWith(OWNER), RECIPE_ID, body);

        expect(reorder).toHaveBeenCalledWith(OWNER, RECIPE_ID, ['p-2', 'p-1']);
        expect(result).toEqual([PHOTO]);
    });

    it('rejects with 401 when no principal is present', async () => {
        const createUploadUrl = vi.fn();
        const controller = new PhotosController(fakeService({ createUploadUrl }));

        await expect(
            controller.createUploadUrl(reqWith(undefined), RECIPE_ID, {} as CreatePhotoUploadDto),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(createUploadUrl).not.toHaveBeenCalled();
    });
});

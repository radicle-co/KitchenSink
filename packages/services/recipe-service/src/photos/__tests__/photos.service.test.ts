/**
 * T035-test — unit tests for {@link PhotosService} over a fake {@link PhotosDal} and a mocked S3 storage
 * port (presigner + object reads).
 *
 * Pins the vertical's domain rules with NO network and NO database:
 * - `upload-url` presigns a PUT only for an allowlisted `ContentType` (jpeg/png/webp), passing the
 *   5 MB `maxBytes` bound and a recipe-scoped object key to the presigner; a disallowed type is rejected.
 * - `confirm` validates the uploaded object by MAGIC-BYTE signature (accepting jpeg/png/webp ONLY, NOT
 *   the client-sent Content-Type) AND an S3 HEAD size ≤ 5 MB, then inserts the row with the DETECTED
 *   content type. Bad magic bytes, HEIC/HEIF, and oversize objects are all rejected without an insert.
 * - `list` / `delete` / `reorder` delegate to the DAL and shape rows into the `RecipePhoto` contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recipePhotoSchema } from '@kitchensink/recipe-core';
import { PayloadTooLargeException, UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';

import { MAX_UPLOAD_BYTES, PhotosService, type PhotoStoragePort, type PhotosConfig } from '../photos.service.js';
import type { PhotosDal } from '../dal/photos.dal.js';
import type { RecipesService } from '../../recipes/recipes.service.js';
import { isRecipeDomainError, notOwner, recipeNotFound } from '../../recipes/recipe.error.js';
import { makeRecipePhotoRow } from '../../__fixtures__/index.js';

const OWNER = '01J000000000000000000FREE0';
const OTHER = '01J00000000000000000OTHER0';
const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
const CONFIG: PhotosConfig = { cloudfrontUrl: 'https://cdn.example.com' };

/**
 * A recipes service whose `getById` resolves to a recipe owned by the caller (default happy path).
 * Override `getById` to simulate a public-but-not-owned recipe (resolves with a different `ownerId`),
 * another owner's private recipe (throws NOT_OWNER), or a missing one (throws RECIPE_NOT_FOUND).
 */
function fakeRecipes(getById = vi.fn().mockResolvedValue({ ownerId: OWNER })): RecipesService {
    return { getById } as unknown as RecipesService;
}

// Magic-byte signatures (only the leading bytes matter to the detector).
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const HEIC = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
const GARBAGE = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

function fakeDal(overrides: Partial<PhotosDal> = {}): PhotosDal {
    return {
        create: vi.fn(),
        findByRecipe: vi.fn(),
        findById: vi.fn(),
        delete: vi.fn(),
        reorder: vi.fn(),
        countByRecipe: vi.fn(),
        ...overrides,
    } as unknown as PhotosDal;
}

function fakeStorage(overrides: Partial<PhotoStoragePort> = {}): PhotoStoragePort {
    return {
        presignUpload: vi.fn().mockResolvedValue('https://s3.example.com/put?sig=abc'),
        readMagicBytes: vi.fn().mockResolvedValue(JPEG),
        headSize: vi.fn().mockResolvedValue(1024),
        ...overrides,
    } as unknown as PhotoStoragePort;
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

/** An s3 key with the owner+recipe-scoped prefix `confirm` requires. */
function keyFor(suffix = 'photo-1'): string {
    return `recipes/${OWNER}/${RECIPE_ID}/photos/${suffix}`;
}

describe('PhotosService.createUploadUrl', () => {
    let storage: PhotoStoragePort;
    let service: PhotosService;

    beforeEach(() => {
        storage = fakeStorage();
        service = new PhotosService(fakeDal(), storage, CONFIG, fakeRecipes());
    });

    it.each(['image/jpeg', 'image/png', 'image/webp'])('presigns a PUT for the allowlisted type %s', async (type) => {
        const result = await service.createUploadUrl(OWNER, RECIPE_ID, type);

        expect(result.uploadUrl).toBe('https://s3.example.com/put?sig=abc');
        expect(result.maxBytes).toBe(MAX_UPLOAD_BYTES); // 5 MB ContentLengthRange bound
        expect(result.s3Key).toContain(RECIPE_ID);
        expect(storage.presignUpload).toHaveBeenCalledWith(
            expect.objectContaining({ contentType: type, maxBytes: MAX_UPLOAD_BYTES, s3Key: result.s3Key }),
        );
    });

    it('scopes the generated object key to the owner and recipe', async () => {
        const result = await service.createUploadUrl(OWNER, RECIPE_ID, 'image/jpeg');

        expect(result.s3Key.startsWith(`recipes/${OWNER}/${RECIPE_ID}/photos/`)).toBe(true);
    });

    it.each(['image/heic', 'image/heif', 'image/gif', 'application/pdf', 'text/plain'])(
        'rejects the disallowed content type %s without presigning',
        async (type) => {
            const error = await catchError(service.createUploadUrl(OWNER, RECIPE_ID, type));

            expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
            expect(storage.presignUpload).not.toHaveBeenCalled();
        },
    );
});

describe('PhotosService.confirm', () => {
    it.each([
        ['image/jpeg', JPEG],
        ['image/png', PNG],
        ['image/webp', WEBP],
    ])('validates %s magic bytes + HEAD size, then inserts the DETECTED content type', async (detected, bytes) => {
        const row = makeRecipePhotoRow({ recipeId: RECIPE_ID, contentType: detected, sizeBytes: 2048 });
        const create = vi.fn().mockResolvedValue(row);
        const storage = fakeStorage({
            readMagicBytes: vi.fn().mockResolvedValue(bytes),
            headSize: vi.fn().mockResolvedValue(2048),
        });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes());

        const response = await service.confirm(OWNER, RECIPE_ID, keyFor());

        // The stored content type comes from the SNIFFED bytes, never a client-sent header.
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ recipeId: RECIPE_ID, s3Key: keyFor(), contentType: detected, sizeBytes: 2048 }),
        );
        expect(recipePhotoSchema.safeParse(response).success).toBe(true);
        expect(response.processingStatus).toBe('complete'); // served as-is, no processing pipeline
        expect(response.s3KeyOrig).toBe(row.s3Key);
    });

    it('rejects an object whose magic bytes are not a supported image (no insert)', async () => {
        const create = vi.fn();
        const storage = fakeStorage({ readMagicBytes: vi.fn().mockResolvedValue(GARBAGE) });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, keyFor()));

        expect(error).toBeInstanceOf(UnprocessableEntityException);
        expect(create).not.toHaveBeenCalled();
    });

    it('rejects HEIC/HEIF by magic bytes even though the wrapper resembles an image (no insert)', async () => {
        const create = vi.fn();
        const storage = fakeStorage({ readMagicBytes: vi.fn().mockResolvedValue(HEIC) });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, keyFor()));

        expect(error).toBeInstanceOf(UnprocessableEntityException);
        expect(create).not.toHaveBeenCalled();
    });

    it('rejects an object larger than 5 MB by its S3 HEAD size (no insert)', async () => {
        const create = vi.fn();
        const storage = fakeStorage({
            readMagicBytes: vi.fn().mockResolvedValue(JPEG),
            headSize: vi.fn().mockResolvedValue(MAX_UPLOAD_BYTES + 1),
        });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, keyFor()));

        expect(error).toBeInstanceOf(PayloadTooLargeException);
        expect(create).not.toHaveBeenCalled();
    });

    it('accepts an object exactly at the 5 MB boundary', async () => {
        const row = makeRecipePhotoRow({ recipeId: RECIPE_ID, sizeBytes: MAX_UPLOAD_BYTES });
        const create = vi.fn().mockResolvedValue(row);
        const storage = fakeStorage({ headSize: vi.fn().mockResolvedValue(MAX_UPLOAD_BYTES) });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes());

        await expect(service.confirm(OWNER, RECIPE_ID, keyFor())).resolves.toBeDefined();
        expect(create).toHaveBeenCalledOnce();
    });

    it('rejects a key that is not scoped to the owner+recipe prefix (no reads, no insert)', async () => {
        const create = vi.fn();
        const storage = fakeStorage();
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, 'recipes/someone-else/r/photos/x'));

        expect(error).toBeDefined();
        expect(storage.readMagicBytes).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });
});

describe('PhotosService.list', () => {
    it('returns the recipe photos shaped into the RecipePhoto contract', async () => {
        const rows = [
            makeRecipePhotoRow({ id: 'p-1', recipeId: RECIPE_ID, sortOrder: 0 }),
            makeRecipePhotoRow({ id: 'p-2', recipeId: RECIPE_ID, sortOrder: 1 }),
        ];
        const dal = fakeDal({ findByRecipe: vi.fn().mockResolvedValue(rows) });
        const service = new PhotosService(dal, fakeStorage(), CONFIG, fakeRecipes());

        const response = await service.list(OWNER, RECIPE_ID);

        expect(dal.findByRecipe).toHaveBeenCalledWith(RECIPE_ID);
        expect(response).toHaveLength(2);
        expect(response.every((photo) => recipePhotoSchema.safeParse(photo).success)).toBe(true);
        expect(response[0]?.cdnUrlBase).toBe(CONFIG.cloudfrontUrl);
    });
});

describe('PhotosService.delete', () => {
    it('delegates to the DAL and resolves when a row was removed', async () => {
        const del = vi.fn().mockResolvedValue(true);
        const service = new PhotosService(fakeDal({ delete: del }), fakeStorage(), CONFIG, fakeRecipes());

        await expect(service.delete(OWNER, RECIPE_ID, 'p-1')).resolves.toBeUndefined();
        expect(del).toHaveBeenCalledWith(RECIPE_ID, 'p-1');
    });

    it('throws NotFound when nothing matched', async () => {
        const del = vi.fn().mockResolvedValue(false);
        const service = new PhotosService(fakeDal({ delete: del }), fakeStorage(), CONFIG, fakeRecipes());

        await expect(service.delete(OWNER, RECIPE_ID, 'missing')).rejects.toBeDefined();
    });
});

describe('PhotosService.reorder', () => {
    it('delegates the ordered ids to the DAL and shapes the reordered rows', async () => {
        const rows = [makeRecipePhotoRow({ id: 'p-2', sortOrder: 0 }), makeRecipePhotoRow({ id: 'p-1', sortOrder: 1 })];
        const reorder = vi.fn().mockResolvedValue(rows);
        const service = new PhotosService(fakeDal({ reorder }), fakeStorage(), CONFIG, fakeRecipes());

        const response = await service.reorder(OWNER, RECIPE_ID, ['p-2', 'p-1']);

        expect(reorder).toHaveBeenCalledWith(RECIPE_ID, ['p-2', 'p-1']);
        expect(response.map((photo) => photo.id)).toEqual(['p-2', 'p-1']);
        expect(response.every((photo) => recipePhotoSchema.safeParse(photo).success)).toBe(true);
    });
});

describe('PhotosService recipe-ownership authorization', () => {
    // A PUBLIC recipe owned by OWNER; getById resolves (read allowed for anyone) with ownerId=OWNER, so a
    // caller of OTHER is a non-owner. Drives the mutation-rejection + public-read-allowed cases.
    const publicOwnedByOwner = (): RecipesService => fakeRecipes(vi.fn().mockResolvedValue({ ownerId: OWNER }));
    // A private recipe of another owner: getById itself throws NOT_OWNER (read denied).
    const privateOtherOwner = (): RecipesService => fakeRecipes(vi.fn().mockRejectedValue(notOwner(RECIPE_ID)));
    // A missing recipe: getById throws RECIPE_NOT_FOUND.
    const missingRecipe = (): RecipesService => fakeRecipes(vi.fn().mockRejectedValue(recipeNotFound(RECIPE_ID)));

    it('createUploadUrl rejects a non-owner before presigning', async () => {
        const storage = fakeStorage();
        const service = new PhotosService(fakeDal(), storage, CONFIG, publicOwnedByOwner());

        const error = await catchError(service.createUploadUrl(OTHER, RECIPE_ID, 'image/jpeg'));

        expect(isRecipeDomainError(error)).toBe(true);
        expect(storage.presignUpload).not.toHaveBeenCalled();
    });

    it('confirm rejects a non-owner before reading the object or inserting', async () => {
        const create = vi.fn();
        const storage = fakeStorage();
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, publicOwnedByOwner());

        await catchError(service.confirm(OTHER, RECIPE_ID, `recipes/${OTHER}/${RECIPE_ID}/photos/x`));

        expect(storage.readMagicBytes).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('delete rejects a non-owner without touching the DAL', async () => {
        const del = vi.fn();
        const service = new PhotosService(fakeDal({ delete: del }), fakeStorage(), CONFIG, publicOwnedByOwner());

        await catchError(service.delete(OTHER, RECIPE_ID, 'p-1'));

        expect(del).not.toHaveBeenCalled();
    });

    it('reorder rejects a non-owner without touching the DAL', async () => {
        const reorder = vi.fn();
        const service = new PhotosService(fakeDal({ reorder }), fakeStorage(), CONFIG, publicOwnedByOwner());

        await catchError(service.reorder(OTHER, RECIPE_ID, ['p-1']));

        expect(reorder).not.toHaveBeenCalled();
    });

    it('propagates NOT_OWNER when the recipe is private and owned by someone else', async () => {
        const service = new PhotosService(fakeDal(), fakeStorage(), CONFIG, privateOtherOwner());

        const error = await catchError(service.list(OTHER, RECIPE_ID));

        expect(isRecipeDomainError(error) && error.code).toBe('NOT_OWNER');
    });

    it('propagates RECIPE_NOT_FOUND for a missing recipe', async () => {
        const service = new PhotosService(fakeDal(), fakeStorage(), CONFIG, missingRecipe());

        const error = await catchError(service.list(OWNER, RECIPE_ID));

        expect(isRecipeDomainError(error) && error.code).toBe('RECIPE_NOT_FOUND');
    });

    it('allows listing a PUBLIC recipe owned by someone else (read is owner-or-public)', async () => {
        const rows = [makeRecipePhotoRow({ recipeId: RECIPE_ID })];
        const dal = fakeDal({ findByRecipe: vi.fn().mockResolvedValue(rows) });
        const service = new PhotosService(dal, fakeStorage(), CONFIG, publicOwnedByOwner());

        await expect(service.list(OTHER, RECIPE_ID)).resolves.toHaveLength(1);
    });
});

describe('PhotosService.confirm S3 error handling', () => {
    it('translates a thrown readMagicBytes (missing object) into 422, not a 500', async () => {
        const storage = fakeStorage({ readMagicBytes: vi.fn().mockRejectedValue(new Error('NoSuchKey')) });
        const service = new PhotosService(fakeDal(), storage, CONFIG, fakeRecipes());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, keyFor()));

        expect(error).toBeInstanceOf(UnprocessableEntityException);
    });

    it('translates a thrown headSize into 422, not a 500', async () => {
        const storage = fakeStorage({ headSize: vi.fn().mockRejectedValue(new Error('NotFound')) });
        const service = new PhotosService(fakeDal(), storage, CONFIG, fakeRecipes());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, keyFor()));

        expect(error).toBeInstanceOf(UnprocessableEntityException);
    });
});

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
import {
    ownerMediaPrefix,
    recipePhotoKeyPrefix,
    recipePhotoSchema,
    recipePhotoThumbnailKey,
} from '@kitchensink/recipe-core';
import {
    BadRequestException,
    NotFoundException,
    PayloadTooLargeException,
    UnprocessableEntityException,
    UnsupportedMediaTypeException,
} from '@nestjs/common';

import {
    MAX_UPLOAD_BYTES,
    PhotosService,
    type CdnInvalidationPort,
    type PhotoStoragePort,
    type PhotosConfig,
} from '../photos.service.js';
import type { PhotosDal } from '../dal/photos.dal.js';
import type { RecipesService } from '../../recipes/recipes.service.js';
import { isRecipeDomainError, notOwner, recipeNotFound } from '../../recipes/recipe.error.js';
import { makeRecipePhotoRow } from '../../__fixtures__/index.js';

const OWNER = '01J000000000000000000FREE0';
const OTHER = '01J00000000000000000OTHER0';
const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
const CONFIG: PhotosConfig = { cloudfrontUrl: 'https://cdn.example.com', thumbnailMaxPx: 400, thumbnailQuality: 80 };

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
// A REAL minimal 1×1 PNG (base64). file-type parses the IHDR chunk, so the bare 8-byte signature is not
// enough — a legitimate, complete image is the honest fixture (and not hand-crafted bytes).
//
// ⚠️ AND IT MUST ACTUALLY DECODE, not merely claim to. This slot previously held a 70-byte string whose
// IDAT chunk carried a WRONG CRC over a TRUNCATED zlib stream. sharp 0.34's libpng was lenient enough to
// read it; libvips 8.18.6 (sharp 0.35) is not, and answers `vipspng: libpng read error`. The confirm path
// treats a thumbnail failure as non-fatal, so the only symptom was `putObject` silently never being called
// — the malformed fixture had been asserting the DEGRADE path while the comment above claimed otherwise.
// Two malformed variants were in use across 7 files. Verify any replacement end-to-end, not by eye:
// every chunk CRC must match and the IDAT must inflate.
const PNG = new Uint8Array(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
    ),
);
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

/** A presigned-URL TTL the fake storage reports back so the service can echo `expiresIn`. */
const PRESIGN_TTL_SECONDS = 900;

function fakeStorage(overrides: Partial<PhotoStoragePort> = {}): PhotoStoragePort {
    return {
        presignUpload: vi
            .fn()
            .mockResolvedValue({ uploadUrl: 'https://s3.example.com/put?sig=abc', expiresIn: PRESIGN_TTL_SECONDS }),
        readMagicBytes: vi.fn().mockResolvedValue(JPEG),
        headSize: vi.fn().mockResolvedValue(1024),
        // `getObject` returns a REAL, decodable 1×1 PNG by default so the confirm path's thumbnail
        // generation (sharp) succeeds; `putObject` stores the rendition. Override `getObject` with
        // non-decodable bytes (or a rejection) to exercise the degrade-to-no-thumbnail path.
        getObject: vi.fn().mockResolvedValue(PNG),
        putObject: vi.fn().mockResolvedValue(undefined),
        deleteObject: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as PhotoStoragePort;
}

/** A fake {@link CdnInvalidationPort} whose `invalidate` resolves cleanly by default. */
function fakeCdn(overrides: Partial<CdnInvalidationPort> = {}): CdnInvalidationPort {
    return {
        invalidate: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as CdnInvalidationPort;
}

/** A valid `upload-url` request body for a small image of the given content type. */
function uploadRequest(
    contentType: string,
    fileSize = 1024,
): { contentType: string; fileName: string; fileSize: number } {
    return { contentType, fileName: 'dish.jpg', fileSize };
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
        service = new PhotosService(fakeDal(), storage, CONFIG, fakeRecipes(), fakeCdn());
    });

    it.each(['image/jpeg', 'image/png', 'image/webp'])('presigns a PUT for the allowlisted type %s', async (type) => {
        const result = await service.createUploadUrl(OWNER, RECIPE_ID, uploadRequest(type));

        expect(result.uploadUrl).toBe('https://s3.example.com/put?sig=abc');
        expect(result.maxBytes).toBe(MAX_UPLOAD_BYTES); // 5 MB ContentLengthRange bound
        expect(result.expiresIn).toBe(PRESIGN_TTL_SECONDS); // echoed from the presigner's TTL
        expect(result.key).toContain(RECIPE_ID);
        expect(storage.presignUpload).toHaveBeenCalledWith(
            expect.objectContaining({ contentType: type, maxBytes: MAX_UPLOAD_BYTES, s3Key: result.key }),
        );
    });

    it('scopes the generated object key to the owner and recipe (never the client fileName)', async () => {
        const result = await service.createUploadUrl(OWNER, RECIPE_ID, {
            contentType: 'image/jpeg',
            fileName: '../../etc/passwd',
            fileSize: 1024,
        });

        expect(result.key.startsWith(`recipes/${OWNER}/${RECIPE_ID}/photos/`)).toBe(true);
        expect(result.key).not.toContain('passwd'); // the client-supplied name never shapes the key
    });

    it.each(['image/heic', 'image/heif', 'image/gif', 'application/pdf', 'text/plain'])(
        'rejects the disallowed content type %s without presigning',
        async (type) => {
            const error = await catchError(service.createUploadUrl(OWNER, RECIPE_ID, uploadRequest(type)));

            expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
            expect(storage.presignUpload).not.toHaveBeenCalled();
        },
    );

    it('rejects a declared fileSize over the 5 MB limit BEFORE presigning (413)', async () => {
        const error = await catchError(
            service.createUploadUrl(OWNER, RECIPE_ID, uploadRequest('image/jpeg', MAX_UPLOAD_BYTES + 1)),
        );

        expect(error).toBeInstanceOf(PayloadTooLargeException);
        expect(storage.presignUpload).not.toHaveBeenCalled();
    });

    it('presigns a declared fileSize exactly at the 5 MB boundary', async () => {
        const result = await service.createUploadUrl(OWNER, RECIPE_ID, uploadRequest('image/jpeg', MAX_UPLOAD_BYTES));

        expect(result.uploadUrl).toBe('https://s3.example.com/put?sig=abc');
        expect(storage.presignUpload).toHaveBeenCalledOnce();
    });
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
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes(), fakeCdn());

        const response = await service.confirm(OWNER, RECIPE_ID, keyFor());

        // The stored content type comes from the SNIFFED bytes, never a client-sent header.
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ recipeId: RECIPE_ID, s3Key: keyFor(), contentType: detected, sizeBytes: 2048 }),
        );
        expect(recipePhotoSchema.safeParse(response).success).toBe(true);
        expect(response.key).toBe(row.s3Key);
        expect(response.contentType).toBe(detected); // the sniffed type, surfaced on the wire
        expect(response.order).toBe(row.sortOrder + 1); // 1-based display position
        expect(response.url).toBe(`${CONFIG.cloudfrontUrl}/${row.s3Key}`); // server-resolved CDN url
    });

    it('rejects an object whose magic bytes are not a supported image (no insert)', async () => {
        const create = vi.fn();
        const storage = fakeStorage({ readMagicBytes: vi.fn().mockResolvedValue(GARBAGE) });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes(), fakeCdn());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, keyFor()));

        expect(error).toBeInstanceOf(UnprocessableEntityException);
        expect(create).not.toHaveBeenCalled();
    });

    it('rejects HEIC/HEIF by magic bytes even though the wrapper resembles an image (no insert)', async () => {
        const create = vi.fn();
        const storage = fakeStorage({ readMagicBytes: vi.fn().mockResolvedValue(HEIC) });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes(), fakeCdn());

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
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes(), fakeCdn());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, keyFor()));

        expect(error).toBeInstanceOf(PayloadTooLargeException);
        expect(create).not.toHaveBeenCalled();
    });

    it('accepts an object exactly at the 5 MB boundary', async () => {
        const row = makeRecipePhotoRow({ recipeId: RECIPE_ID, sizeBytes: MAX_UPLOAD_BYTES });
        const create = vi.fn().mockResolvedValue(row);
        const storage = fakeStorage({ headSize: vi.fn().mockResolvedValue(MAX_UPLOAD_BYTES) });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes(), fakeCdn());

        // `create` resolves the fixed boundary-sized row regardless of input, so the response is exactly
        // `resolvePhotoView(row, CONFIG.cloudfrontUrl)` — confirm the boundary size (5 MB) was accepted
        // by pinning the whole shaped `RecipePhoto`, not just that a value came back.
        await expect(service.confirm(OWNER, RECIPE_ID, keyFor())).resolves.toEqual({
            id: row.id,
            recipeId: row.recipeId,
            key: row.s3Key,
            url: `${CONFIG.cloudfrontUrl}/${row.s3Key}`,
            contentType: row.contentType,
            order: row.sortOrder + 1,
            createdAt: row.createdAt.toISOString(),
        });
        expect(create).toHaveBeenCalledOnce();
    });

    it('persists a key UNDER the token owner prefix even for a traversal-crafted recipeId (verticals-8)', async () => {
        // Adversarial: a caller supplies a recipeId containing `../` in an attempt to escape its own media
        // space (e.g. reach into another owner's prefix). S3 keys are LITERAL strings — `../` is not path
        // normalization — and the confirm-time prefix is always TOKEN-OWNER-prefixed, so the persisted key
        // is necessarily under ownerMediaPrefix(tokenOwner) regardless of the recipeId's contents. That is
        // the verticals-8 containment guarantee at the photos layer: a right-to-erasure sweep of the token
        // owner's prefix still reaches this object, and it never lands under a DIFFERENT owner's prefix.
        const craftedRecipeId = `../${OTHER}/hijack`;
        // The client echoes back a key that matches the (token-owner-scoped) prefix so the startsWith
        // re-check passes — this is the strongest case: the guard passed, yet containment must still hold.
        const craftedKey = `${recipePhotoKeyPrefix(OWNER, craftedRecipeId)}object-1`;
        const row = makeRecipePhotoRow({ recipeId: craftedRecipeId, s3Key: craftedKey });
        const create = vi.fn().mockResolvedValue(row);
        // getById resolves to OWNER, so the OWNER caller passes the owner check for this (crafted) recipeId.
        const service = new PhotosService(fakeDal({ create }), fakeStorage(), CONFIG, fakeRecipes(), fakeCdn());

        await service.confirm(OWNER, craftedRecipeId, craftedKey);

        const persisted = create.mock.calls[0]?.[0] as { s3Key: string };
        // Contained under the TOKEN owner's erasure prefix...
        expect(persisted.s3Key.startsWith(ownerMediaPrefix(OWNER))).toBe(true);
        // ...and never under the impersonated owner's prefix, despite the `../{OTHER}` in the path.
        expect(persisted.s3Key.startsWith(ownerMediaPrefix(OTHER))).toBe(false);
    });

    it('rejects a key that is not scoped to the owner+recipe prefix (no reads, no insert)', async () => {
        const create = vi.fn();
        const storage = fakeStorage();
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes(), fakeCdn());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, 'recipes/someone-else/r/photos/x'));

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toBe('The upload key is not scoped to this recipe.');
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
        const service = new PhotosService(dal, fakeStorage(), CONFIG, fakeRecipes(), fakeCdn());

        const response = await service.list(OWNER, RECIPE_ID);

        expect(dal.findByRecipe).toHaveBeenCalledWith(RECIPE_ID);
        expect(response).toHaveLength(2);
        expect(response.every((photo) => recipePhotoSchema.safeParse(photo).success)).toBe(true);
        expect(response[0]?.url.startsWith(CONFIG.cloudfrontUrl)).toBe(true);
        expect(response.map((photo) => photo.order)).toEqual([1, 2]); // 1-based, in stored order
    });
});

describe('PhotosService.delete (HAZ-051/067/039 — S3 delete + CDN invalidation)', () => {
    it('delegates to the DAL and resolves when a row was removed', async () => {
        const row = makeRecipePhotoRow({ id: 'p-1', recipeId: RECIPE_ID });
        const del = vi.fn().mockResolvedValue(row);
        const service = new PhotosService(fakeDal({ delete: del }), fakeStorage(), CONFIG, fakeRecipes(), fakeCdn());

        await expect(service.delete(OWNER, RECIPE_ID, 'p-1')).resolves.toBeUndefined();
        expect(del).toHaveBeenCalledWith(RECIPE_ID, 'p-1');
    });

    it('throws NotFound when nothing matched, and never touches S3 or the CDN', async () => {
        const del = vi.fn().mockResolvedValue(undefined);
        const storage = fakeStorage();
        const cdn = fakeCdn();
        const service = new PhotosService(fakeDal({ delete: del }), storage, CONFIG, fakeRecipes(), cdn);

        await expect(service.delete(OWNER, RECIPE_ID, 'missing')).rejects.toThrow(
            new NotFoundException(`Photo missing not found on recipe ${RECIPE_ID}.`),
        );
        expect(storage.deleteObject).not.toHaveBeenCalled();
        expect(cdn.invalidate).not.toHaveBeenCalled();
    });

    it('deletes the S3 original and invalidates its CDN path when the photo has no thumbnail', async () => {
        const row = makeRecipePhotoRow({ id: 'p-1', recipeId: RECIPE_ID, s3Key: keyFor('orig'), thumbnailKey: null });
        const del = vi.fn().mockResolvedValue(row);
        const storage = fakeStorage();
        const cdn = fakeCdn();
        const service = new PhotosService(fakeDal({ delete: del }), storage, CONFIG, fakeRecipes(), cdn);

        await service.delete(OWNER, RECIPE_ID, 'p-1');

        expect(storage.deleteObject).toHaveBeenCalledTimes(1);
        expect(storage.deleteObject).toHaveBeenCalledWith(row.s3Key);
        expect(cdn.invalidate).toHaveBeenCalledTimes(1);
        expect(cdn.invalidate).toHaveBeenCalledWith([`/${row.s3Key}`]);
    });

    it('deletes BOTH the original and the thumbnail rendition, and invalidates BOTH CDN paths', async () => {
        const s3Key = keyFor('orig');
        const thumbnailKey = recipePhotoThumbnailKey(s3Key);
        const row = makeRecipePhotoRow({ id: 'p-1', recipeId: RECIPE_ID, s3Key, thumbnailKey });
        const del = vi.fn().mockResolvedValue(row);
        const storage = fakeStorage();
        const cdn = fakeCdn();
        const service = new PhotosService(fakeDal({ delete: del }), storage, CONFIG, fakeRecipes(), cdn);

        await service.delete(OWNER, RECIPE_ID, 'p-1');

        // Both stored objects removed from S3...
        expect(storage.deleteObject).toHaveBeenCalledTimes(2);
        expect(storage.deleteObject).toHaveBeenCalledWith(s3Key);
        expect(storage.deleteObject).toHaveBeenCalledWith(thumbnailKey);
        // ...and BOTH their CDN edge paths purged in the SAME invalidation request (not two separate
        // requests — CloudFront bills/rate-limits per invalidation call, not per path).
        expect(cdn.invalidate).toHaveBeenCalledTimes(1);
        expect(cdn.invalidate).toHaveBeenCalledWith(expect.arrayContaining([`/${s3Key}`, `/${thumbnailKey}`]));
        expect((cdn.invalidate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2);
    });

    it('does NOT invalidate the CDN when the S3 delete fails — the origin object is still live', async () => {
        const row = makeRecipePhotoRow({ id: 'p-1', recipeId: RECIPE_ID, s3Key: keyFor('orig'), thumbnailKey: null });
        const del = vi.fn().mockResolvedValue(row);
        const storage = fakeStorage({ deleteObject: vi.fn().mockRejectedValue(new Error('S3 5xx')) });
        const cdn = fakeCdn();
        const service = new PhotosService(fakeDal({ delete: del }), storage, CONFIG, fakeRecipes(), cdn);

        // The DB row is already gone (the user-visible delete succeeded) and the failure is a residual-
        // cleanup concern, not a request failure — invalidating a CDN cache for an object that is STILL
        // present at origin would be worse than a no-op (CloudFront would just re-cache it on the next
        // fetch), so a failed S3 delete must short-circuit before invalidation is even attempted.
        await expect(service.delete(OWNER, RECIPE_ID, 'p-1')).resolves.toBeUndefined();
        expect(cdn.invalidate).not.toHaveBeenCalled();
    });

    it('does not fail the request when CDN invalidation fails after a successful S3 delete', async () => {
        const row = makeRecipePhotoRow({ id: 'p-1', recipeId: RECIPE_ID, s3Key: keyFor('orig'), thumbnailKey: null });
        const del = vi.fn().mockResolvedValue(row);
        const storage = fakeStorage();
        const cdn = fakeCdn({ invalidate: vi.fn().mockRejectedValue(new Error('CloudFront throttled')) });
        const service = new PhotosService(fakeDal({ delete: del }), storage, CONFIG, fakeRecipes(), cdn);

        // The origin object is genuinely gone; only the CDN edge cache may still serve it until TTL expiry
        // (the accepted HAZ-039 residual) — that must not surface as a failed delete request to the caller.
        await expect(service.delete(OWNER, RECIPE_ID, 'p-1')).resolves.toBeUndefined();
        expect(storage.deleteObject).toHaveBeenCalledTimes(1);
        expect(cdn.invalidate).toHaveBeenCalledTimes(1);
    });
});

describe('PhotosService.reorder', () => {
    it('delegates the ordered ids to the DAL and shapes the reordered rows', async () => {
        const rows = [makeRecipePhotoRow({ id: 'p-2', sortOrder: 0 }), makeRecipePhotoRow({ id: 'p-1', sortOrder: 1 })];
        const reorder = vi.fn().mockResolvedValue(rows);
        const service = new PhotosService(fakeDal({ reorder }), fakeStorage(), CONFIG, fakeRecipes(), fakeCdn());

        const response = await service.reorder(OWNER, RECIPE_ID, ['p-2', 'p-1']);

        expect(reorder).toHaveBeenCalledWith(RECIPE_ID, ['p-2', 'p-1']);
        expect(response.map((photo) => photo.id)).toEqual(['p-2', 'p-1']);
        expect(response.every((photo) => recipePhotoSchema.safeParse(photo).success)).toBe(true);
    });

    // The DAL returns null when the request is not an exact permutation of the current photos (validated
    // atomically in-tx); the service must surface that as a 400, not pass null through to row shaping.
    it('rejects a non-permutation reorder (DAL null) with 400 BadRequest', async () => {
        const reorder = vi.fn().mockResolvedValue(null);
        const service = new PhotosService(fakeDal({ reorder }), fakeStorage(), CONFIG, fakeRecipes(), fakeCdn());

        await expect(service.reorder(OWNER, RECIPE_ID, ['p-1'])).rejects.toBeInstanceOf(BadRequestException);
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
        const service = new PhotosService(fakeDal(), storage, CONFIG, publicOwnedByOwner(), fakeCdn());

        const error = await catchError(service.createUploadUrl(OTHER, RECIPE_ID, uploadRequest('image/jpeg')));

        expect(isRecipeDomainError(error)).toBe(true);
        expect(storage.presignUpload).not.toHaveBeenCalled();
    });

    it('confirm rejects a non-owner before reading the object or inserting', async () => {
        const create = vi.fn();
        const storage = fakeStorage();
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, publicOwnedByOwner(), fakeCdn());

        await catchError(service.confirm(OTHER, RECIPE_ID, `recipes/${OTHER}/${RECIPE_ID}/photos/x`));

        expect(storage.readMagicBytes).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('delete rejects a non-owner without touching the DAL', async () => {
        const del = vi.fn();
        const service = new PhotosService(
            fakeDal({ delete: del }),
            fakeStorage(),
            CONFIG,
            publicOwnedByOwner(),
            fakeCdn(),
        );

        await catchError(service.delete(OTHER, RECIPE_ID, 'p-1'));

        expect(del).not.toHaveBeenCalled();
    });

    it('reorder rejects a non-owner without touching the DAL', async () => {
        const reorder = vi.fn();
        const service = new PhotosService(fakeDal({ reorder }), fakeStorage(), CONFIG, publicOwnedByOwner(), fakeCdn());

        await catchError(service.reorder(OTHER, RECIPE_ID, ['p-1']));

        expect(reorder).not.toHaveBeenCalled();
    });

    it('propagates NOT_OWNER when the recipe is private and owned by someone else', async () => {
        const service = new PhotosService(fakeDal(), fakeStorage(), CONFIG, privateOtherOwner(), fakeCdn());

        const error = await catchError(service.list(OTHER, RECIPE_ID));

        expect(isRecipeDomainError(error) && error.code).toBe('NOT_OWNER');
    });

    it('propagates RECIPE_NOT_FOUND for a missing recipe', async () => {
        const service = new PhotosService(fakeDal(), fakeStorage(), CONFIG, missingRecipe(), fakeCdn());

        const error = await catchError(service.list(OWNER, RECIPE_ID));

        expect(isRecipeDomainError(error) && error.code).toBe('RECIPE_NOT_FOUND');
    });

    it('allows listing a PUBLIC recipe owned by someone else (read is owner-or-public)', async () => {
        const rows = [makeRecipePhotoRow({ recipeId: RECIPE_ID })];
        const dal = fakeDal({ findByRecipe: vi.fn().mockResolvedValue(rows) });
        const service = new PhotosService(dal, fakeStorage(), CONFIG, publicOwnedByOwner(), fakeCdn());

        await expect(service.list(OTHER, RECIPE_ID)).resolves.toHaveLength(1);
    });
});

describe('PhotosService.confirm S3 error handling', () => {
    it('translates a thrown readMagicBytes (missing object) into 422, not a 500', async () => {
        const storage = fakeStorage({ readMagicBytes: vi.fn().mockRejectedValue(new Error('NoSuchKey')) });
        const service = new PhotosService(fakeDal(), storage, CONFIG, fakeRecipes(), fakeCdn());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, keyFor()));

        expect(error).toBeInstanceOf(UnprocessableEntityException);
    });

    it('translates a thrown headSize into 422, not a 500', async () => {
        const storage = fakeStorage({ headSize: vi.fn().mockRejectedValue(new Error('NotFound')) });
        const service = new PhotosService(fakeDal(), storage, CONFIG, fakeRecipes(), fakeCdn());

        const error = await catchError(service.confirm(OWNER, RECIPE_ID, keyFor()));

        expect(error).toBeInstanceOf(UnprocessableEntityException);
    });
});

describe('PhotosService.confirm cover-thumbnail rendition (FOLLOW-UP-CR-001-A)', () => {
    it('generates a thumbnail, stores it BESIDE the original under the owner prefix, and persists its key', async () => {
        const key = keyFor();
        const thumbnailKey = recipePhotoThumbnailKey(key);
        const row = makeRecipePhotoRow({ recipeId: RECIPE_ID, s3Key: key, thumbnailKey });
        const create = vi.fn().mockResolvedValue(row);
        const putObject = vi.fn().mockResolvedValue(undefined);
        // A real decodable JPEG for the ORIGINAL read, so sharp produces a genuine rendition.
        const getObject = vi.fn().mockResolvedValue(PNG);
        const storage = fakeStorage({ getObject, putObject });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes(), fakeCdn());

        await service.confirm(OWNER, RECIPE_ID, key);

        // The rendition is written to the DETERMINISTIC variant key from recipe-core — under the SAME owner
        // erasure prefix as the original, which is what keeps GDPR erasure containment structural.
        expect(getObject).toHaveBeenCalledWith(key);
        expect(putObject).toHaveBeenCalledTimes(1);
        const put = putObject.mock.calls[0]?.[0] as { s3Key: string; body: Uint8Array; contentType: string };
        expect(put.s3Key).toBe(thumbnailKey);
        expect(put.s3Key.startsWith(`recipes/${OWNER}/`)).toBe(true);
        expect(put.contentType).toBe('image/jpeg');
        expect(put.body.byteLength).toBeGreaterThan(0);

        // ...and the persisted row carries the thumbnail key so the cover projection can serve it.
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ s3Key: key, thumbnailKey }));
    });

    it('DEGRADES when the image cannot be resized: no thumbnail key persisted, upload still confirmed', async () => {
        const key = keyFor();
        const row = makeRecipePhotoRow({ recipeId: RECIPE_ID, s3Key: key, thumbnailKey: null });
        const create = vi.fn().mockResolvedValue(row);
        const putObject = vi.fn().mockResolvedValue(undefined);
        // The object passed magic-byte validation but is not a decodable image → sharp throws.
        const getObject = vi.fn().mockResolvedValue(GARBAGE);
        const storage = fakeStorage({ getObject, putObject });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes(), fakeCdn());

        // The confirm still succeeds — a thumbnail is an optimisation, not a save-blocking requirement.
        // `create` resolves the fixed row regardless of input, so pin the whole shaped response (not just
        // that it resolved) — the degrade path must still return a normal, fully-formed `RecipePhoto`.
        await expect(service.confirm(OWNER, RECIPE_ID, key)).resolves.toEqual({
            id: row.id,
            recipeId: row.recipeId,
            key: row.s3Key,
            url: `${CONFIG.cloudfrontUrl}/${row.s3Key}`,
            contentType: row.contentType,
            order: row.sortOrder + 1,
            createdAt: row.createdAt.toISOString(),
        });

        // No rendition stored, and NO thumbnailKey persisted → the cover falls back to the original.
        expect(putObject).not.toHaveBeenCalled();
        const createdInput = create.mock.calls[0]?.[0] as { thumbnailKey?: string };
        expect(createdInput.thumbnailKey).toBeUndefined();
    });

    it('DEGRADES when storing the thumbnail fails, without failing the confirmed upload', async () => {
        const key = keyFor();
        const row = makeRecipePhotoRow({ s3Key: key, thumbnailKey: null });
        const create = vi.fn().mockResolvedValue(row);
        const putObject = vi.fn().mockRejectedValue(new Error('S3 5xx'));
        const storage = fakeStorage({ getObject: vi.fn().mockResolvedValue(PNG), putObject });
        const service = new PhotosService(fakeDal({ create }), storage, CONFIG, fakeRecipes(), fakeCdn());

        // Same degrade contract as above (this time the S3 PUT for the rendition fails, not the decode) —
        // the confirmed upload still returns the normal shaped response.
        await expect(service.confirm(OWNER, RECIPE_ID, key)).resolves.toEqual({
            id: row.id,
            recipeId: row.recipeId,
            key: row.s3Key,
            url: `${CONFIG.cloudfrontUrl}/${row.s3Key}`,
            contentType: row.contentType,
            order: row.sortOrder + 1,
            createdAt: row.createdAt.toISOString(),
        });

        const createdInput = create.mock.calls[0]?.[0] as { thumbnailKey?: string };
        expect(createdInput.thumbnailKey).toBeUndefined();
    });
});

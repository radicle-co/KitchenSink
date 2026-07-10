/**
 * T035 — recipe-photo orchestration for the presign → upload → confirm flow.
 *
 * Sits between the controller (which supplies the authenticated owner key) and the {@link PhotosDal} +
 * an injected {@link PhotoStoragePort} (the S3 presigner + object reads). It owns the rules the DAL and
 * the storage layer do not:
 * - **`upload-url`** — presigns an S3 PUT for an ALLOWLISTED `ContentType` only (jpeg/png/webp),
 *   passing the 5 MB {@link MAX_UPLOAD_BYTES} bound and a generated owner+recipe-scoped object key.
 * - **`confirm`** — validates the uploaded object by MAGIC-BYTE signature (accepting jpeg/png/webp
 *   ONLY, NOT the client-sent Content-Type — HEIC/HEIF and everything else are rejected) AND an S3 HEAD
 *   size ≤ 5 MB, then inserts the row with the DETECTED content type. The object is served as-is via
 *   CloudFront — there is no resizing, no variants, and no processing state.
 * - **response shaping** — persistence rows → the shared `RecipePhoto` wire contract (single stored
 *   `s3KeyOrig`, `cdnUrlBase`, `processingStatus: 'complete'`).
 *
 * Input-validation failures surface as framework `HttpException`s (415/422/413/404); the 10-photo cap
 * is a domain `MAX_PHOTOS_EXCEEDED` thrown by the DAL.
 */
import { randomUUID } from 'node:crypto';

import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
    PayloadTooLargeException,
    UnprocessableEntityException,
    UnsupportedMediaTypeException,
} from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { PhotoProcessingStatus, type RecipePhoto } from '@kitchensink/recipe-core';

import { PhotosDal, type CreatePhotoInput } from './dal/photos.dal.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { notOwner } from '../recipes/recipe.error.js';
import type { RecipePhotoRow } from '../database/schema/index.js';

/** DI token for the photo DAL — provided by `PhotosModule` via `useFactory` over the Drizzle client. */
export const PHOTOS_DAL = 'PHOTOS_DAL';

/** DI token for the S3 storage port (presigner + object reads) — adapted from the real `S3Client`. */
export const PHOTOS_STORAGE = 'PHOTOS_STORAGE';

/** DI token for the photos runtime config (CloudFront base URL for response shaping). */
export const PHOTOS_CONFIG = 'PHOTOS_CONFIG';

/** The hard upload size limit: 5 MB, enforced at presign (bound) and at confirm (HEAD, authoritative). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The only accepted upload content types (also the only signatures `detectImageContentType` accepts). */
export const ALLOWED_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** How many leading bytes to read from S3 for magic-byte sniffing (enough for the WebP `RIFF….WEBP`). */
// file-type parses structure beyond the bare magic signature (e.g. PNG's IHDR chunk), so give it a
// comfortable sniff window — its recommended read size — rather than the ~12 bytes of the raw signature.
// A single small range-read per confirm; keeps a legitimately-formatted upload from being sniffed short.
const MAGIC_BYTE_READ_LENGTH = 4100;

/** Runtime configuration the photos vertical needs (the CloudFront base for the `RecipePhoto` cdn url). */
export interface PhotosConfig {
    /** CloudFront distribution base URL that fronts the photo bucket. */
    readonly cloudfrontUrl: string;
}

/** The presign inputs the storage port signs into the PUT URL. */
export interface PresignUploadInput {
    /** The object key the client PUTs to (and echoes back on confirm). */
    readonly s3Key: string;
    /** The allowlisted content type to sign into the URL. */
    readonly contentType: string;
    /** The 5 MB size bound to associate with the upload. */
    readonly maxBytes: number;
}

/**
 * The narrow S3 surface the service depends on — the real adapter wraps `S3Client` + `getSignedUrl`
 * (`s3-request-presigner`); unit tests inject a mock. This is the "S3 + presigner" seam.
 */
export interface PhotoStoragePort {
    /** Presign an S3 PUT for a new photo object and return the upload URL. */
    presignUpload(input: PresignUploadInput): Promise<string>;
    /** Read the first `byteCount` bytes of an object (for magic-byte sniffing). */
    readMagicBytes(s3Key: string, byteCount: number): Promise<Uint8Array>;
    /** HEAD an object → its `ContentLength` in bytes (`undefined` when S3 omits it). */
    headSize(s3Key: string): Promise<number | undefined>;
}

/** The `upload-url` response: the presigned target the client uploads to, plus the size bound. */
export interface UploadUrlResponse {
    /** The presigned S3 PUT URL. */
    readonly uploadUrl: string;
    /** The object key the client MUST echo back on confirm. */
    readonly s3Key: string;
    /** The content type signed into the URL. */
    readonly contentType: string;
    /** The maximum object size (bytes) the client must respect. */
    readonly maxBytes: number;
}

/**
 * Detect the upload's content type from its leading bytes and accept it ONLY if it is a served-as-is
 * format (JPEG/PNG/WebP). Detection is delegated to the maintained `file-type` library — it recognizes
 * these three (and hundreds of other formats, with the edge cases a hand-rolled signature check gets
 * wrong); this function's job is the SECURITY allowlist gate: a format `file-type` recognizes but that
 * is NOT served — notably HEIC/HEIF — returns `undefined` so the caller rejects it.
 *
 * @sideEffect None — reads the in-memory buffer only. Async because `file-type` parses the buffer.
 */
export async function detectImageContentType(
    bytes: Uint8Array,
): Promise<(typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number] | undefined> {
    let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;

    try {
        detected = await fileTypeFromBuffer(bytes);
    } catch {
        // file-type throws (EndOfStream) on a truncated/malformed buffer — treat that as "not a
        // determinable valid image", i.e. reject (→ 422), never let it escape as a 500.
        return undefined;
    }

    if (detected === undefined) {
        return undefined;
    }

    return (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(detected.mime)
        ? (detected.mime as (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number])
        : undefined;
}

@Injectable()
export class PhotosService {
    public constructor(
        @Inject(PHOTOS_DAL) private readonly dal: PhotosDal,
        @Inject(PHOTOS_STORAGE) private readonly storage: PhotoStoragePort,
        @Inject(PHOTOS_CONFIG) private readonly config: PhotosConfig,
        private readonly recipes: RecipesService,
    ) {}

    /**
     * Read-authorize access to a recipe's photos: allowed for the owner OR any `public` recipe. Delegates
     * to {@link RecipesService.getById}, which throws `RECIPE_NOT_FOUND` (404) for a missing/tombstoned
     * recipe and `NOT_OWNER` (403) for another owner's private recipe. Mirrors the versions vertical.
     */
    private async assertCanRead(ownerId: string, recipeId: string): Promise<void> {
        await this.recipes.getById(ownerId, recipeId);
    }

    /**
     * Owner-only authorize a mutation on a recipe's photos. A public recipe owned by someone else passes
     * the read check but is rejected here with `NOT_OWNER` — only the recipe owner may attach, reorder,
     * or delete photos.
     */
    private async assertOwner(ownerId: string, recipeId: string): Promise<void> {
        const recipe = await this.recipes.getById(ownerId, recipeId);

        if (recipe.ownerId !== ownerId) {
            throw notOwner(recipeId);
        }
    }

    /**
     * Presign an S3 PUT for a new photo. Rejects any content type outside the allowlist BEFORE
     * presigning, and scopes the generated object key to the owner + recipe.
     *
     * @throws `UnsupportedMediaTypeException` (415) when `contentType` is not jpeg/png/webp.
     */
    public async createUploadUrl(ownerId: string, recipeId: string, contentType: string): Promise<UploadUrlResponse> {
        await this.assertOwner(ownerId, recipeId);

        if (!isAllowedContentType(contentType)) {
            throw new UnsupportedMediaTypeException(
                `Unsupported photo content type '${contentType}'. Allowed: ${ALLOWED_UPLOAD_CONTENT_TYPES.join(', ')}.`,
            );
        }

        const s3Key = `${photoKeyPrefix(ownerId, recipeId)}${randomUUID()}`;
        const uploadUrl = await this.storage.presignUpload({ s3Key, contentType, maxBytes: MAX_UPLOAD_BYTES });

        return { uploadUrl, s3Key, contentType, maxBytes: MAX_UPLOAD_BYTES };
    }

    /**
     * Confirm an uploaded object: validate it by magic-byte signature (jpeg/png/webp ONLY) and by an S3
     * HEAD size ≤ 5 MB, then persist the metadata row with the DETECTED content type.
     *
     * @throws `BadRequestException` when the key is not scoped to this owner+recipe.
     * @throws `UnprocessableEntityException` (422) when the bytes are not a supported image (incl. HEIC).
     * @throws `PayloadTooLargeException` (413) when the object exceeds 5 MB.
     */
    public async confirm(ownerId: string, recipeId: string, s3Key: string): Promise<RecipePhoto> {
        await this.assertOwner(ownerId, recipeId);

        if (!s3Key.startsWith(photoKeyPrefix(ownerId, recipeId))) {
            throw new BadRequestException('The upload key is not scoped to this recipe.');
        }

        // A missing object (never uploaded, or deleted between PUT and confirm) makes the S3 SDK throw a
        // raw `NoSuchKey`/`NotFound` the global filter can't classify — it would surface as a 500. Treat
        // an unreadable/unsizable object as an unprocessable upload (422) instead.
        const bytes = await this.readMagicBytesOrThrow(s3Key);
        const detected = await detectImageContentType(bytes);

        if (detected === undefined) {
            throw new UnprocessableEntityException(
                'The uploaded object is not a supported image (accepted: JPEG, PNG, WebP).',
            );
        }

        const size = await this.headSizeOrThrow(s3Key);

        if (size === undefined) {
            throw new UnprocessableEntityException('The uploaded object could not be sized.');
        }

        if (size > MAX_UPLOAD_BYTES) {
            throw new PayloadTooLargeException(`The uploaded object exceeds the ${MAX_UPLOAD_BYTES}-byte limit.`);
        }

        const input: CreatePhotoInput = { recipeId, s3Key, contentType: detected, sizeBytes: size };
        const row = await this.dal.create(input);

        return this.toPhotoResponse(row);
    }

    /** List a recipe's photos, ordered, shaped into the `RecipePhoto` contract. Read-authorized. */
    public async list(ownerId: string, recipeId: string): Promise<RecipePhoto[]> {
        await this.assertCanRead(ownerId, recipeId);

        const rows = await this.dal.findByRecipe(recipeId);

        return rows.map((row) => this.toPhotoResponse(row));
    }

    /**
     * Delete a recipe's photo. Owner-only.
     *
     * @throws `NotFoundException` when no such photo exists on the recipe.
     */
    public async delete(ownerId: string, recipeId: string, photoId: string): Promise<void> {
        await this.assertOwner(ownerId, recipeId);

        const removed = await this.dal.delete(recipeId, photoId);

        if (!removed) {
            throw new NotFoundException(`Photo ${photoId} not found on recipe ${recipeId}.`);
        }
    }

    /**
     * Reorder a recipe's photos to the given id order and return the reordered objects. Owner-only.
     * `photoIds` must be an exact reordering of the recipe's current photos — a partial, duplicate, or
     * foreign-id list is rejected (400) rather than silently corrupting `sortOrder`.
     */
    public async reorder(ownerId: string, recipeId: string, photoIds: string[]): Promise<RecipePhoto[]> {
        await this.assertOwner(ownerId, recipeId);

        const rows = await this.dal.reorder(recipeId, photoIds);

        if (rows === null) {
            throw new BadRequestException(
                "photoIds must be an exact reordering of the recipe's current photos (no missing, extra, or duplicate ids).",
            );
        }

        return rows.map((row) => this.toPhotoResponse(row));
    }

    /**
     * Read the object's leading bytes, translating a missing/unreadable object into a 422 rather than
     * letting the raw S3 error escape as a 500.
     *
     * @sideEffect Reads from S3.
     */
    private async readMagicBytesOrThrow(s3Key: string): Promise<Uint8Array> {
        try {
            return await this.storage.readMagicBytes(s3Key, MAGIC_BYTE_READ_LENGTH);
        } catch {
            throw new UnprocessableEntityException('The uploaded object could not be read for validation.');
        }
    }

    /**
     * HEAD the object for its size, translating a missing/unreadable object into a 422 rather than a 500.
     *
     * @sideEffect Reads from S3.
     */
    private async headSizeOrThrow(s3Key: string): Promise<number | undefined> {
        try {
            return await this.storage.headSize(s3Key);
        } catch {
            throw new UnprocessableEntityException('The uploaded object could not be sized.');
        }
    }

    /**
     * Map a persisted `recipe_photos` row to the shared `RecipePhoto` contract. The single stored object
     * is `s3KeyOrig`; there are no variants; `processingStatus` is always `complete` (served as-is).
     */
    private toPhotoResponse(row: RecipePhotoRow): RecipePhoto {
        return {
            id: row.id,
            recipeId: row.recipeId,
            s3KeyOrig: row.s3Key,
            cdnUrlBase: this.config.cloudfrontUrl,
            processingStatus: PhotoProcessingStatus.COMPLETE,
            sortOrder: row.sortOrder,
            createdAt: row.createdAt.toISOString(),
        };
    }
}

/** The owner+recipe-scoped object-key prefix all of a recipe's photos live under. */
function photoKeyPrefix(ownerId: string, recipeId: string): string {
    return `recipes/${ownerId}/${recipeId}/photos/`;
}

/** Narrowing allowlist check for the upload content type. Pure. */
function isAllowedContentType(contentType: string): contentType is (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number] {
    return (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(contentType);
}

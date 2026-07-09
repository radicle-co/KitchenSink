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
import { PhotoProcessingStatus, type RecipePhoto } from '@kitchensink/recipe-core';

import { PhotosDal, type CreatePhotoInput } from './dal/photos.dal.js';
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
const MAGIC_BYTE_READ_LENGTH = 16;

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
 * Detect a supported image content type from an object's leading bytes. Accepts ONLY JPEG, PNG, and
 * WebP (the served-as-is formats); every other wrapper — notably HEIC/HEIF (`ftyp` box) — returns
 * `undefined`. Pure.
 */
export function detectImageContentType(bytes: Uint8Array): (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number] | undefined {
    // JPEG: FF D8 FF
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) {
        return 'image/png';
    }

    // WebP: 'RIFF' (52 49 46 46) …4 size bytes… 'WEBP' (57 45 42 50)
    const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

    if (bytes.length >= 12 && isRiff && isWebp) {
        return 'image/webp';
    }

    return undefined;
}

@Injectable()
export class PhotosService {
    public constructor(
        @Inject(PHOTOS_DAL) private readonly dal: PhotosDal,
        @Inject(PHOTOS_STORAGE) private readonly storage: PhotoStoragePort,
        @Inject(PHOTOS_CONFIG) private readonly config: PhotosConfig,
    ) {}

    /**
     * Presign an S3 PUT for a new photo. Rejects any content type outside the allowlist BEFORE
     * presigning, and scopes the generated object key to the owner + recipe.
     *
     * @throws `UnsupportedMediaTypeException` (415) when `contentType` is not jpeg/png/webp.
     */
    public async createUploadUrl(ownerId: string, recipeId: string, contentType: string): Promise<UploadUrlResponse> {
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
        if (!s3Key.startsWith(photoKeyPrefix(ownerId, recipeId))) {
            throw new BadRequestException('The upload key is not scoped to this recipe.');
        }

        const bytes = await this.storage.readMagicBytes(s3Key, MAGIC_BYTE_READ_LENGTH);
        const detected = detectImageContentType(bytes);

        if (detected === undefined) {
            throw new UnprocessableEntityException(
                'The uploaded object is not a supported image (accepted: JPEG, PNG, WebP).',
            );
        }

        const size = await this.storage.headSize(s3Key);

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

    /** List a recipe's photos, ordered, shaped into the `RecipePhoto` contract. */
    public async list(recipeId: string): Promise<RecipePhoto[]> {
        const rows = await this.dal.findByRecipe(recipeId);

        return rows.map((row) => this.toPhotoResponse(row));
    }

    /**
     * Delete a recipe's photo.
     *
     * @throws `NotFoundException` when no such photo exists on the recipe.
     */
    public async delete(recipeId: string, photoId: string): Promise<void> {
        const removed = await this.dal.delete(recipeId, photoId);

        if (!removed) {
            throw new NotFoundException(`Photo ${photoId} not found on recipe ${recipeId}.`);
        }
    }

    /** Reorder a recipe's photos to the given id order and return the reordered contract objects. */
    public async reorder(recipeId: string, photoIds: string[]): Promise<RecipePhoto[]> {
        const rows = await this.dal.reorder(recipeId, photoIds);

        return rows.map((row) => this.toPhotoResponse(row));
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

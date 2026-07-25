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
 *   size ≤ 5 MB, then generates a small cover-thumbnail rendition (FOLLOW-UP-CR-001-A) and inserts the
 *   row with the DETECTED content type plus the thumbnail key. The full-size object is served as-is via
 *   CloudFront; the thumbnail is the ONE derived variant, and thumbnail generation is best-effort (a
 *   failure degrades to no thumbnail, never a failed save). There is no processing state machine.
 * - **response shaping** — persistence rows → the shared `RecipePhoto` wire contract
 *   (`{ id, recipeId, key, url, contentType, order, createdAt }`): the object is served as-is, the server
 *   resolves the full CDN `url`, and `order` is the 1-based display position.
 *
 * Input-validation failures surface as framework `HttpException`s (415/422/413/404); the 10-photo cap
 * is a domain `MAX_PHOTOS_EXCEEDED` thrown by the DAL.
 */
import { randomUUID } from 'node:crypto';

import {
    BadRequestException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    PayloadTooLargeException,
    UnprocessableEntityException,
    UnsupportedMediaTypeException,
} from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import {
    MAX_RECIPE_PHOTO_UPLOAD_BYTES,
    recipePhotoKeyPrefix,
    recipePhotoOriginalKey,
    recipePhotoThumbnailKey,
    type RecipePhoto,
} from '@kitchensink/recipe-core';

import { PhotosDal, type CreatePhotoInput } from './dal/photos.dal.js';
import { resolvePhotoView } from './photo-view.js';
import { generateThumbnail, THUMBNAIL_CONTENT_TYPE } from './photo-thumbnail.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { notOwner } from '../recipes/recipe.error.js';
import type { RecipePhotoRow } from '../database/schema/index.js';

/** DI token for the photo DAL — provided by `PhotosModule` via `useFactory` over the Drizzle client. */
export const PHOTOS_DAL = 'PHOTOS_DAL';

/** DI token for the S3 storage port (presigner + object reads) — adapted from the real `S3Client`. */
export const PHOTOS_STORAGE = 'PHOTOS_STORAGE';

/** DI token for the photos runtime config (CloudFront base URL for response shaping). */
export const PHOTOS_CONFIG = 'PHOTOS_CONFIG';

/**
 * The hard upload size limit: 5 MB, enforced at presign (bound) and at confirm (HEAD, authoritative).
 * Re-exports the single recipe-core source (`MAX_RECIPE_PHOTO_UPLOAD_BYTES`) — also the client's
 * pre-transmission size guard (REQ-011) — under this module's existing local name so callers/tests are
 * unaffected; see that constant's own doc for why it lives in recipe-core, not here.
 */
export const MAX_UPLOAD_BYTES = MAX_RECIPE_PHOTO_UPLOAD_BYTES;

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
    /** Max longest-edge (px) for the generated cover thumbnail (FOLLOW-UP-CR-001-A). */
    readonly thumbnailMaxPx: number;
    /** JPEG quality (1–100) for the generated cover thumbnail. */
    readonly thumbnailQuality: number;
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

/** A presigned upload: the URL the client PUTs to and the TTL (seconds) the signature is valid for. */
export interface PresignedUpload {
    /** The presigned S3 PUT URL. */
    readonly uploadUrl: string;
    /** The signature's validity window, in seconds. */
    readonly expiresIn: number;
}

/** A thumbnail object to store: its key, JPEG bytes, and content type. */
export interface PutObjectInput {
    /** The variant object key (under the owner erasure prefix). */
    readonly s3Key: string;
    /** The rendition bytes. */
    readonly body: Uint8Array;
    /** The content type to store the object with (served as-is by CloudFront). */
    readonly contentType: string;
}

/**
 * The narrow S3 surface the service depends on — the real adapter wraps `S3Client` + `getSignedUrl`
 * (`s3-request-presigner`); unit tests inject a mock. This is the "S3 + presigner" seam.
 */
export interface PhotoStoragePort {
    /** Presign an S3 PUT for a new photo object and return the upload URL + its expiry. */
    presignUpload(input: PresignUploadInput): Promise<PresignedUpload>;
    /** Read the first `byteCount` bytes of an object (for magic-byte sniffing). */
    readMagicBytes(s3Key: string, byteCount: number): Promise<Uint8Array>;
    /** HEAD an object → its `ContentLength` in bytes (`undefined` when S3 omits it). */
    headSize(s3Key: string): Promise<number | undefined>;
    /** Read an object's full bytes (the confirmed original, to derive its thumbnail). */
    getObject(s3Key: string): Promise<Uint8Array>;
    /** Write an object (the generated thumbnail rendition). */
    putObject(input: PutObjectInput): Promise<void>;
}

/** The client's `upload-url` request: the file it intends to upload (for the allowlist + size pre-check). */
export interface CreatePhotoUploadInput {
    /** The client's intended content type (allowlist-gated to jpeg/png/webp). */
    readonly contentType: string;
    /** The original file name (carried for the contract; the server assigns its own opaque object key). */
    readonly fileName: string;
    /** The intended object size in bytes — pre-checked against {@link MAX_UPLOAD_BYTES} before presigning. */
    readonly fileSize: number;
}

/** The `upload-url` response: the presigned target the client uploads to, its key, expiry, and size bound. */
export interface UploadUrlResponse {
    /** The presigned S3 PUT URL. */
    readonly uploadUrl: string;
    /** The object key the client MUST echo back on confirm. */
    readonly key: string;
    /** The presigned URL's validity window, in seconds. */
    readonly expiresIn: number;
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
    private readonly logger = new Logger(PhotosService.name);

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
     * presigning, pre-checks the declared file size against the 5 MB bound (the object is re-checked
     * authoritatively at confirm via an S3 HEAD), and scopes the generated object key to the owner +
     * recipe. The server assigns its own opaque object key — the client-supplied `fileName` is never used
     * to construct the key (a client-controlled key would let a caller write outside its prefix).
     *
     * @throws `UnsupportedMediaTypeException` (415) when `contentType` is not jpeg/png/webp.
     * @throws `PayloadTooLargeException` (413) when the declared `fileSize` exceeds {@link MAX_UPLOAD_BYTES}.
     */
    public async createUploadUrl(
        ownerId: string,
        recipeId: string,
        input: CreatePhotoUploadInput,
    ): Promise<UploadUrlResponse> {
        await this.assertOwner(ownerId, recipeId);

        if (!isAllowedContentType(input.contentType)) {
            throw new UnsupportedMediaTypeException(
                `Unsupported photo content type '${input.contentType}'. Allowed: ${ALLOWED_UPLOAD_CONTENT_TYPES.join(', ')}.`,
            );
        }

        if (input.fileSize > MAX_UPLOAD_BYTES) {
            throw new PayloadTooLargeException(
                `The declared file size ${input.fileSize} exceeds the ${MAX_UPLOAD_BYTES}-byte limit.`,
            );
        }

        const key = recipePhotoOriginalKey(ownerId, recipeId, randomUUID());
        const { uploadUrl, expiresIn } = await this.storage.presignUpload({
            s3Key: key,
            contentType: input.contentType,
            maxBytes: MAX_UPLOAD_BYTES,
        });

        return { uploadUrl, key, expiresIn, maxBytes: MAX_UPLOAD_BYTES };
    }

    /**
     * Confirm an uploaded object: validate it by magic-byte signature (jpeg/png/webp ONLY) and by an S3
     * HEAD size ≤ 5 MB, then persist the metadata row with the DETECTED content type.
     *
     * @throws `BadRequestException` when the key is not scoped to this owner+recipe.
     * @throws `UnprocessableEntityException` (422) when the bytes are not a supported image (incl. HEIC).
     * @throws `PayloadTooLargeException` (413) when the object exceeds 5 MB.
     */
    public async confirm(ownerId: string, recipeId: string, key: string): Promise<RecipePhoto> {
        await this.assertOwner(ownerId, recipeId);

        if (!key.startsWith(recipePhotoKeyPrefix(ownerId, recipeId))) {
            throw new BadRequestException('The upload key is not scoped to this recipe.');
        }

        // A missing object (never uploaded, or deleted between PUT and confirm) makes the S3 SDK throw a
        // raw `NoSuchKey`/`NotFound` the global filter can't classify — it would surface as a 500. Treat
        // an unreadable/unsizable object as an unprocessable upload (422) instead.
        const bytes = await this.readMagicBytesOrThrow(key);
        const detected = await detectImageContentType(bytes);

        if (detected === undefined) {
            throw new UnprocessableEntityException(
                'The uploaded object is not a supported image (accepted: JPEG, PNG, WebP).',
            );
        }

        const size = await this.headSizeOrThrow(key);

        if (size === undefined) {
            throw new UnprocessableEntityException('The uploaded object could not be sized.');
        }

        if (size > MAX_UPLOAD_BYTES) {
            throw new PayloadTooLargeException(`The uploaded object exceeds the ${MAX_UPLOAD_BYTES}-byte limit.`);
        }

        // Generate the small cover-thumbnail rendition and persist its key so the cover projections serve
        // it instead of the up-to-5 MB original (FOLLOW-UP-CR-001-A / SC-009). Best-effort: a thumbnail is
        // an optimisation, not correctness, so a generation failure degrades to `undefined` (the cover
        // falls back to the original) rather than failing the user's confirmed upload.
        const thumbnailKey = await this.generateAndStoreThumbnail(key);

        const input: CreatePhotoInput = {
            recipeId,
            s3Key: key,
            contentType: detected,
            sizeBytes: size,
            ...(thumbnailKey !== undefined ? { thumbnailKey } : {}),
        };
        const row = await this.dal.create(input);

        return this.toPhotoResponse(row);
    }

    /**
     * Read the confirmed original, resize it to a bounded cover thumbnail (sharp), and store the rendition
     * BESIDE the original under the same owner erasure prefix ({@link recipePhotoThumbnailKey}). Returns
     * the stored thumbnail key, or `undefined` when generation/storage fails — in which case the caller
     * persists no `thumbnailKey` and the cover falls back to the original.
     *
     * Deliberately catch-all and non-fatal: neither a non-decodable-but-magic-valid image nor a transient
     * S3 hiccup on the derived object should fail a save whose original already uploaded. The failure is
     * logged (observable) but swallowed. A missing thumbnail is self-healing at the read layer via the
     * `COALESCE(thumbnail_key, s3_key)` cover projection.
     *
     * @sideEffect Reads the original from S3 and writes the thumbnail object to S3.
     */
    private async generateAndStoreThumbnail(originalKey: string): Promise<string | undefined> {
        try {
            const original = await this.storage.getObject(originalKey);
            const thumbnail = await generateThumbnail(original, {
                maxPx: this.config.thumbnailMaxPx,
                quality: this.config.thumbnailQuality,
            });
            const thumbnailKey = recipePhotoThumbnailKey(originalKey);

            await this.storage.putObject({ s3Key: thumbnailKey, body: thumbnail, contentType: THUMBNAIL_CONTENT_TYPE });

            return thumbnailKey;
        } catch (error) {
            this.logger.warn(
                `Cover thumbnail generation failed for ${originalKey}; serving the original as cover. ` +
                    `${error instanceof Error ? error.message : String(error)}`,
            );

            return undefined;
        }
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

    /** Map a persisted `recipe_photos` row to the shared `RecipePhoto` contract (shared pure mapping). */
    private toPhotoResponse(row: RecipePhotoRow): RecipePhoto {
        return resolvePhotoView(row, this.config.cloudfrontUrl);
    }
}

/** Narrowing allowlist check for the upload content type. Pure. */
function isAllowedContentType(contentType: string): contentType is (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number] {
    return (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(contentType);
}

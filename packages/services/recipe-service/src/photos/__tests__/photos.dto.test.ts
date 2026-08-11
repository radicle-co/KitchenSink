/**
 * The photos vertical's request DTOs are the AUTHORED zod contract, wired into Nest through
 * `nestjs-zod`'s `createZodDto`. These tests drive the real {@link ZodValidationPipe} — not the schemas
 * directly — because the pipe is what actually runs on an inbound request, and a schema that is correct
 * but unwired validates nothing.
 *
 * TWO PROPERTIES CARRY MOST OF THE VALUE HERE, and both are written to fail if the seam regresses:
 *
 *  1. **The DTO and the published schema are the SAME object** (`Dto.schema === …RequestSchema`). This is
 *     the anti-drift assertion: `@kitchensink/schema-recipe` publishes those schemas verbatim, so identity
 *     makes it impossible to validate one shape server-side and publish another.
 *  2. **The pipe does NOT enforce the MIME allowlist or the 5 MB cap.** Those are the service's decisions
 *     and they answer `415`/`413`; a pipe-level rejection would silently downgrade both to `400`. The
 *     "accepts a non-allowlisted content type" and "accepts an oversized declared size" cases exist to red
 *     the build if someone narrows the request schema to `recipePhotoContentTypeSchema` or restores a
 *     `.max(MAX_RECIPE_PHOTO_UPLOAD_BYTES)` — see `photos.schema.ts` for why that would be a regression.
 */
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ArgumentMetadata } from '@nestjs/common';
import { ALLOWED_RECIPE_PHOTO_MIME_TYPES, MAX_RECIPE_PHOTO_UPLOAD_BYTES } from '@kitchensink/recipe-core';

import { ConfirmPhotoDto } from '../dto/confirm-photo.dto.js';
import { CreatePhotoUploadDto } from '../dto/create-photo-upload.dto.js';
import { ReorderPhotosDto } from '../dto/reorder-photos.dto.js';
import {
    confirmPhotoRequestSchema,
    createPhotoUploadRequestSchema,
    recipePhotoContentTypeSchema,
    reorderPhotosRequestSchema,
} from '../photos.schema.js';

const pipe = new ZodValidationPipe();

/** Build the `ArgumentMetadata` Nest hands a body pipe for the given DTO class. */
function bodyMetadata(metatype: unknown): ArgumentMetadata {
    return { type: 'body', metatype } as ArgumentMetadata;
}

/** Run a body through the real pipe for the given DTO. */
function transform(metatype: unknown, body: unknown): unknown {
    return pipe.transform(body, bodyMetadata(metatype));
}

/** The HTTP status a rejected body produces, or `undefined` when the body was accepted. */
function statusOfRejection(metatype: unknown, body: unknown): number | undefined {
    try {
        transform(metatype, body);

        return undefined;
    } catch (error: unknown) {
        return (error as { getStatus: () => number }).getStatus();
    }
}

const A_UUID = '4a3b2c1d-1111-4222-8333-444455556666';
const ANOTHER_UUID = '5b4c3d2e-2222-4333-8444-555566667777';

describe('CreatePhotoUploadDto', () => {
    it('IS the published upload-request schema, so the contract cannot be validated one way and published another', () => {
        expect(CreatePhotoUploadDto.schema).toBe(createPhotoUploadRequestSchema);
    });

    it('accepts a well-formed body', () => {
        expect(
            transform(CreatePhotoUploadDto, { fileName: 'stew.jpg', contentType: 'image/jpeg', fileSize: 2048 }),
        ).toEqual({ fileName: 'stew.jpg', contentType: 'image/jpeg', fileSize: 2048 });
    });

    it('strips an unknown key rather than passing it through to the service', () => {
        expect(
            transform(CreatePhotoUploadDto, {
                fileName: 'stew.jpg',
                contentType: 'image/jpeg',
                fileSize: 2048,
                ownerId: 'someone-elses-ulid',
            }),
        ).toEqual({ fileName: 'stew.jpg', contentType: 'image/jpeg', fileSize: 2048 });
    });

    it.each([
        ['an empty fileName', { fileName: '', contentType: 'image/jpeg', fileSize: 1 }],
        ['a fileName over 255 chars', { fileName: 'a'.repeat(256), contentType: 'image/jpeg', fileSize: 1 }],
        ['an empty contentType', { fileName: 'a.jpg', contentType: '', fileSize: 1 }],
        ['a contentType over 100 chars', { fileName: 'a.jpg', contentType: `image/${'x'.repeat(100)}`, fileSize: 1 }],
        ['a zero fileSize', { fileName: 'a.jpg', contentType: 'image/jpeg', fileSize: 0 }],
        ['a negative fileSize', { fileName: 'a.jpg', contentType: 'image/jpeg', fileSize: -1 }],
        ['a fractional fileSize', { fileName: 'a.jpg', contentType: 'image/jpeg', fileSize: 1.5 }],
        ['a missing fileSize', { fileName: 'a.jpg', contentType: 'image/jpeg' }],
        ['a string fileSize', { fileName: 'a.jpg', contentType: 'image/jpeg', fileSize: '10' }],
    ])('rejects %s with 400', (_case, body) => {
        expect(statusOfRejection(CreatePhotoUploadDto, body)).toBe(400);
    });

    it('ACCEPTS a non-allowlisted content type, because the allowlist is the service’s 415 and not a 400', () => {
        expect(
            statusOfRejection(CreatePhotoUploadDto, { fileName: 'a.heic', contentType: 'image/heic', fileSize: 1 }),
        ).toBe(undefined);
    });

    it('ACCEPTS a declared size over the 5 MB cap, because the cap is the service’s 413 and not a 400', () => {
        expect(
            statusOfRejection(CreatePhotoUploadDto, {
                fileName: 'a.jpg',
                contentType: 'image/jpeg',
                fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1,
            }),
        ).toBe(undefined);
    });
});

describe('ConfirmPhotoDto', () => {
    it('IS the published confirm-request schema', () => {
        expect(ConfirmPhotoDto.schema).toBe(confirmPhotoRequestSchema);
    });

    it('accepts a well-formed body', () => {
        expect(
            transform(ConfirmPhotoDto, { key: 'owners/1/recipes/2/original.jpg', contentType: 'image/png' }),
        ).toEqual({
            key: 'owners/1/recipes/2/original.jpg',
            contentType: 'image/png',
        });
    });

    it.each([
        ['an empty key', { key: '', contentType: 'image/jpeg' }],
        ['a key over 1024 chars', { key: 'k'.repeat(1025), contentType: 'image/jpeg' }],
        ['an empty contentType', { key: 'k', contentType: '' }],
        ['a contentType over 100 chars', { key: 'k', contentType: `image/${'x'.repeat(100)}` }],
        ['a missing key', { contentType: 'image/jpeg' }],
    ])('rejects %s with 400', (_case, body) => {
        expect(statusOfRejection(ConfirmPhotoDto, body)).toBe(400);
    });

    it('ACCEPTS a non-allowlisted content type, because confirm NEVER trusts it — the stored type is sniffed from the bytes', () => {
        expect(statusOfRejection(ConfirmPhotoDto, { key: 'k', contentType: 'application/x-msdownload' })).toBe(
            undefined,
        );
    });
});

describe('ReorderPhotosDto', () => {
    it('IS the published reorder-request schema', () => {
        expect(ReorderPhotosDto.schema).toBe(reorderPhotosRequestSchema);
    });

    it('accepts a non-empty list of photo uuids', () => {
        expect(transform(ReorderPhotosDto, { photoIds: [A_UUID, ANOTHER_UUID] })).toEqual({
            photoIds: [A_UUID, ANOTHER_UUID],
        });
    });

    it.each([
        ['an empty list', { photoIds: [] }],
        ['a non-uuid entry', { photoIds: ['not-a-uuid'] }],
        ['a nil uuid, which names no photo', { photoIds: ['00000000-0000-0000-0000-000000000000'] }],
        ['a non-array', { photoIds: A_UUID }],
        ['a missing list', {}],
    ])('rejects %s with 400', (_case, body) => {
        expect(statusOfRejection(ReorderPhotosDto, body)).toBe(400);
    });
});

describe('recipePhotoContentTypeSchema', () => {
    it('publishes exactly recipe-core’s allowlist, so widening one widens the other', () => {
        expect(recipePhotoContentTypeSchema.options).toEqual([...ALLOWED_RECIPE_PHOTO_MIME_TYPES]);
    });

    it('rejects HEIC, which the sharp build cannot decode', () => {
        expect(recipePhotoContentTypeSchema.safeParse('image/heic').success).toBe(false);
    });
});

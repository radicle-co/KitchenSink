/**
 * `POST /api/v1/users/me/avatar/presign` — the `type`/`size` boundary.
 *
 * ⚠️ THE DEFECT THIS FILE NOW COVERS. The route took two bare `@Query()` strings and hand-parsed the size:
 *
 * ```ts
 * const sizeNum = size ? Number.parseInt(size, 10) : 0;
 * if (sizeNum <= 0 || sizeNum > this.maxSizeBytes) { throw new BadRequestException(...); }
 * ```
 *
 * `Number.parseInt('abc', 10)` is `NaN`, and EVERY comparison against `NaN` is false — so `NaN <= 0` and
 * `NaN > max` both fail and a non-numeric `size` passed BOTH bounds. `NaN` then went into
 * `PutObjectCommand.ContentLength` and got signed into the presigned URL. That is the same `NaN`-through-a-guard
 * class already recorded for the admin list's `?limit=abc` (§15.4 / `admin.schema.ts`), on a route that hands
 * out an S3 credential.
 *
 * The shape (`type` present, `size` a positive integer) now lives in the authored `avatarPresignQuerySchema` and
 * is enforced by the global `ZodValidationPipe`; the POLICY (which MIME types, and the byte cap) stays in the
 * controller, which is where `avatar.schema.ts` deliberately keeps it so one security rule has one home.
 *
 * @module
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ArgumentMetadata } from '@nestjs/common';
import { newUserId } from '@kitchensink/identity-db';

import { isOwnAvatarKey } from '@kitchensink/identity-core';

import { AvatarUploadController } from '../src/users/avatarUpload.controller.js';
import { AvatarMedia, type AvatarMediaPort } from '../src/users/avatarMedia.js';
import { createS3AvatarStorage } from '../src/users/avatarStorage.js';
import { noopCdnInvalidation } from '../src/users/cdnInvalidation.js';
import { AvatarPresignQueryDto } from '../src/users/dto/avatarPresign.query.dto.js';
import type { AuthorizerContext } from '../src/auth/decorators/currentUser.decorator.js';

const pipe = new ZodValidationPipe();
const queryMeta: ArgumentMetadata = { type: 'query', metatype: AvatarPresignQueryDto, data: undefined };

/** Run the real global pipe over a query object, exactly as Nest does for `@Query()`. */
const parseQuery = (query: unknown): AvatarPresignQueryDto => pipe.transform(query, queryMeta) as AvatarPresignQueryDto;

describe('avatar presign — query SHAPE (the pipe)', () => {
    // ⛔ THE REGRESSION. Before the DTO existed this string reached `ContentLength` as `NaN`.
    it.each(['abc', '', '2.5', '-1', '0', 'Infinity', '1e21', 'NaN'])('rejects size=%j', (size) => {
        expect(() => parseQuery({ type: 'image/png', size })).toThrow();
    });

    it('rejects a missing size rather than defaulting it to 0', () => {
        expect(() => parseQuery({ type: 'image/png' })).toThrow();
    });

    it('rejects a missing type', () => {
        expect(() => parseQuery({ size: '1024' })).toThrow();
    });

    it('parses a decimal size into a NUMBER, so no downstream code can re-parse it wrongly', () => {
        expect(parseQuery({ type: 'image/png', size: '1024' })).toMatchObject({ size: 1024 });
    });
});

describe('avatar presign — POLICY (the controller)', () => {
    let controller: AvatarUploadController;
    let media: AvatarMediaPort;
    const ctx: AuthorizerContext = {
        userId: newUserId() as AuthorizerContext['userId'],
        email: 'test@example.com',
        clerkUserId: 'idp_123',
        scopes: [],
        permissions: [],
        tokenType: 'user' as AuthorizerContext['tokenType'],
        roles: [],
        testPrincipal: false,
    };

    beforeEach(() => {
        media = {
            cdnUrl: 'https://media.commise.app',
            presignUpload: vi.fn().mockResolvedValue('https://signed.example/put'),
            exists: vi.fn(),
            removeSuperseded: vi.fn(),
            removeAll: vi.fn(),
        };
        controller = new AvatarUploadController(media);
    });

    it('rejects an unsupported MIME type, naming what is allowed', async () => {
        await expect(
            controller.generatePresignedUrl(ctx, parseQuery({ type: 'image/gif', size: '1024' })),
        ).rejects.toThrow(BadRequestException);
    });

    it('rejects a size over the 5 MB cap', async () => {
        const oversized = String(5 * 1024 * 1024 + 1);

        await expect(
            controller.generatePresignedUrl(ctx, parseQuery({ type: 'image/png', size: oversized })),
        ).rejects.toThrow(BadRequestException);
    });

    // The boundary, which decides whether the cap is `>` or `>=`.
    it('accepts a size of exactly 5 MB — the cap is inclusive', async () => {
        const exact = String(5 * 1024 * 1024);

        await expect(
            controller.generatePresignedUrl(ctx, parseQuery({ type: 'image/png', size: exact })),
        ).resolves.toMatchObject({ uploadUrl: 'https://signed.example/put' });
    });

    // ADR-0064: the response names the OBJECT KEY, never a URL, so the CDN host is never baked into stored data.
    it('answers { uploadUrl, key } and no publicUrl', async () => {
        const result = await controller.generatePresignedUrl(ctx, parseQuery({ type: 'image/webp', size: '1024' }));

        expect(Object.keys(result).sort()).toEqual(['key', 'uploadUrl']);
        expect(isOwnAvatarKey(ctx.userId, result.key)).toBe(true);
        expect(result.key.endsWith('.webp')).toBe(true);
    });

    it('presigns exactly the key, type and size it returns', async () => {
        const result = await controller.generatePresignedUrl(ctx, parseQuery({ type: 'image/jpeg', size: '2048' }));

        expect(media.presignUpload).toHaveBeenCalledWith({ key: result.key, contentType: 'image/jpeg', size: 2048 });
    });

    it('does not presign anything for a refused type or size', async () => {
        await expect(
            controller.generatePresignedUrl(ctx, parseQuery({ type: 'image/gif', size: '1' })),
        ).rejects.toThrow();

        expect(media.presignUpload).not.toHaveBeenCalled();
    });
});

describe('avatar presign — the signed URL is uploadable by a plain HTTP client (D3)', () => {
    const ctx: AuthorizerContext = {
        userId: newUserId() as AuthorizerContext['userId'],
        email: 'test@example.com',
        clerkUserId: 'idp_123',
        scopes: [],
        permissions: [],
        tokenType: 'user' as AuthorizerContext['tokenType'],
        roles: [],
        testPrincipal: false,
    };

    // The installed SDK defaults to `requestChecksumCalculation: 'WHEN_SUPPORTED'`, which bakes
    // `x-amz-checksum-crc32` + `x-amz-sdk-checksum-algorithm` into the SIGNED query. A browser or `fetch` PUT
    // cannot reproduce that checksum, so S3 answers 400 and no avatar object could ever be written. This goes through
    // the REAL adapter and the controller, so a client rebuilt elsewhere cannot bring it back.
    it('signs no flexible-checksum parameter into the query', async () => {
        const real = new AvatarMedia(
            createS3AvatarStorage({
                bucket: 'test-bucket',
                region: 'us-east-1',
                credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
            }),
            noopCdnInvalidation(),
            'https://media.commise.app',
        );

        const { uploadUrl } = await new AvatarUploadController(real).generatePresignedUrl(
            ctx,
            parseQuery({ type: 'image/png', size: '1024' }),
        );

        const query = new URL(uploadUrl).searchParams;

        expect([...query.keys()].filter((name) => name.toLowerCase().includes('checksum'))).toEqual([]);
    });
});

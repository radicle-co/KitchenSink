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
import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ArgumentMetadata } from '@nestjs/common';
import { newUserId } from '@kitchensink/identity-db';

import { AvatarUploadController } from '../src/users/avatar-upload.controller.js';
import { AvatarPresignQueryDto } from '../src/users/dto/avatar-presign.query.dto.js';
import type { AuthorizerContext } from '../src/auth/decorators/current-user.decorator.js';

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
    const ctx: AuthorizerContext = {
        userId: newUserId() as AuthorizerContext['userId'],
        email: 'test@example.com',
        clerkUserId: 'idp_123',
        scopes: [],
        permissions: [],
        tokenType: 'user' as AuthorizerContext['tokenType'],
    };

    beforeEach(() => {
        controller = new AvatarUploadController();
        process.env['MEDIA_BUCKET_NAME'] = 'test-bucket';
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

    // The boundary, which decides whether the cap is `>` or `>=`. Presigning itself needs AWS credentials that
    // the unit tier does not have, so the assertion is on the POLICY outcome: exactly 5 MB must not produce a
    // `400`. Whatever the SDK does afterwards is a different tier's business.
    it('accepts a size of exactly 5 MB — the cap is inclusive', async () => {
        const exact = String(5 * 1024 * 1024);

        const error = await controller.generatePresignedUrl(ctx, parseQuery({ type: 'image/png', size: exact })).then(
            () => undefined,
            (thrown: unknown) => thrown,
        );

        expect(error).not.toBeInstanceOf(BadRequestException);
    });
});

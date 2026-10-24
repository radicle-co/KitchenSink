import { Controller, Post, Query, HttpCode, HttpStatus, BadRequestException, Inject } from '@nestjs/common';
import { newAvatarKey, type AvatarExtension } from '@kitchensink/identity-core';
import { CurrentAuthorizerContext } from '../auth/decorators/currentUser.decorator.js';
import { AvatarPresignQueryDto } from './dto/avatarPresign.query.dto.js';
import { AVATAR_MEDIA, type AvatarMediaPort } from './avatarMedia.js';
import type { AuthorizerContext } from '../auth/decorators/currentUser.decorator.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/users/me/avatar', 'v1/users/me/avatar'])
export class AvatarUploadController {
    private readonly maxSizeBytes = 5 * 1024 * 1024;
    private readonly allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    public constructor(@Inject(AVATAR_MEDIA) private readonly media: AvatarMediaPort) {}

    /**
     * Presign an S3 `PUT` for the viewer's avatar.
     *
     * ⚠️ THE QUERY ARRIVES PARSED, AND THAT IS THE FIX. This used to take `@Query('type')`/`@Query('size')` as
     * bare optional strings — metatype `String`, which the global `ZodValidationPipe` passes through — and
     * compute `Number.parseInt(size, 10)` itself. `parseInt('abc')` is `NaN`, and both bounds
     * (`NaN <= 0`, `NaN > max`) are false for `NaN`, so a non-numeric `size` was admitted and `ContentLength:
     * NaN` was signed into the presigned URL. `AvatarPresignQueryDto` now rejects that at the boundary, and
     * `query.size` is a `number` by the time this body runs.
     *
     * What remains here is POLICY, not shape: which MIME types are admitted, and the byte cap. `avatar.schema.ts`
     * deliberately does not restate either — one security rule, one home, reported in this `400`.
     *
     * @returns The presigned URL and the object KEY to send back as `avatarKey` (ADR-0064).
     * @sideEffect Signs an S3 `PUT` URL (no bytes traverse this service).
     */
    @Post('presign')
    @HttpCode(HttpStatus.OK)
    async generatePresignedUrl(
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
        @Query() query: AvatarPresignQueryDto,
    ): Promise<{ uploadUrl: string; key: string }> {
        const { type, size } = query;

        if (!this.allowedTypes.includes(type)) {
            throw new BadRequestException(`Invalid type. Allowed: ${this.allowedTypes.join(', ')}`);
        }

        if (size > this.maxSizeBytes) {
            throw new BadRequestException(`Size must be between 1 and ${this.maxSizeBytes} bytes`);
        }

        // The KEY is the answer, not a URL: the client sends it back as `avatarKey`, and the CDN URL is composed
        // at read time (ADR-0064). The key lies under the caller's own prefix, which `PATCH` re-checks.
        const key = newAvatarKey(ctx.userId, Date.now(), this.extensionForType(type));
        const uploadUrl = await this.media.presignUpload({ key, contentType: type, size });

        return { uploadUrl, key };
    }

    private extensionForType(type: string): AvatarExtension {
        switch (type) {
            case 'image/jpeg':
                return 'jpg';
            case 'image/png':
                return 'png';
            case 'image/webp':
                return 'webp';
            default:
                // Unreachable: `allowedTypes` is checked first. Throwing keeps an unlisted type from minting a key
                // that `isOwnAvatarKey` would refuse anyway.
                throw new BadRequestException(`Invalid type. Allowed: ${this.allowedTypes.join(', ')}`);
        }
    }
}

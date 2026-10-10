import { Controller, Post, Query, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CurrentAuthorizerContext } from '../auth/decorators/currentUser.decorator.js';
import { AvatarPresignQueryDto } from './dto/avatarPresign.query.dto.js';
import type { AuthorizerContext } from '../auth/decorators/currentUser.decorator.js';

// Canonically served under the `/api/{version}/` prefix. The bare `v1/...` entry is a DEPRECATED ALIAS:
// `/v1/*` is live in production and held by consumers configured OUTSIDE this repo (the Clerk dashboard
// webhook URL) as well as already-shipped mobile builds and cached web bundles, whose endpoints were
// inlined at build time. Removing it REQUIRES updating the Clerk dashboard first — see ADR-0011.
@Controller(['api/v1/users/me/avatar', 'v1/users/me/avatar'])
export class AvatarUploadController {
    private readonly s3: S3Client;
    private readonly bucket: string;
    private readonly maxSizeBytes = 5 * 1024 * 1024;
    private readonly allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    public constructor() {
        this.s3 = new S3Client({});
        this.bucket = process.env['MEDIA_BUCKET_NAME'] ?? 'kitchensink-identity-media-dev';
    }

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
     * @sideEffect Signs an S3 `PUT` URL (no bytes traverse this service).
     */
    @Post('presign')
    @HttpCode(HttpStatus.OK)
    async generatePresignedUrl(
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
        @Query() query: AvatarPresignQueryDto,
    ): Promise<{ uploadUrl: string; publicUrl: string }> {
        const { type, size } = query;

        if (!this.allowedTypes.includes(type)) {
            throw new BadRequestException(`Invalid type. Allowed: ${this.allowedTypes.join(', ')}`);
        }

        if (size > this.maxSizeBytes) {
            throw new BadRequestException(`Size must be between 1 and ${this.maxSizeBytes} bytes`);
        }

        const key = `avatars/${ctx.userId}/${Date.now()}.${this.extensionForType(type)}`;

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: type,
            ContentLength: size,
        });

        const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 300 });
        const publicUrl = `https://${this.bucket}.s3.amazonaws.com/${key}`;

        return { uploadUrl, publicUrl };
    }

    private extensionForType(type: string): string {
        switch (type) {
            case 'image/jpeg':
                return 'jpg';
            case 'image/png':
                return 'png';
            case 'image/webp':
                return 'webp';
            default:
                return 'bin';
        }
    }
}

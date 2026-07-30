import { Controller, Post, Query, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CurrentAuthorizerContext } from '../auth/decorators/current-user.decorator.js';
import type { AuthorizerContext } from '../auth/decorators/current-user.decorator.js';

@Controller('v1/users/me/avatar')
export class AvatarUploadController {
    private readonly s3: S3Client;
    private readonly bucket: string;
    private readonly maxSizeBytes = 5 * 1024 * 1024;
    private readonly allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    public constructor() {
        this.s3 = new S3Client({});
        this.bucket = process.env['MEDIA_BUCKET_NAME'] ?? 'kitchensink-identity-media-dev';
    }

    @Post('presign')
    @HttpCode(HttpStatus.OK)
    async generatePresignedUrl(
        @CurrentAuthorizerContext() ctx: AuthorizerContext,
        @Query('type') type?: string,
        @Query('size') size?: string,
    ): Promise<{ uploadUrl: string; publicUrl: string } | null> {
        if (!type || !this.allowedTypes.includes(type)) {
            throw new BadRequestException(`Invalid type. Allowed: ${this.allowedTypes.join(', ')}`);
        }

        const sizeNum = size ? Number.parseInt(size, 10) : 0;

        if (sizeNum <= 0 || sizeNum > this.maxSizeBytes) {
            throw new BadRequestException(`Size must be between 1 and ${this.maxSizeBytes} bytes`);
        }

        const key = `avatars/${ctx.userId}/${Date.now()}.${this.extensionForType(type)}`;

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: type,
            ContentLength: sizeNum,
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

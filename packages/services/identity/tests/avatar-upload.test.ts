import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AvatarUploadController } from '../src/users/avatar-upload.controller.js';
import type { AuthorizerContext } from '../src/auth/decorators/current-user.decorator.js';

describe('AvatarUploadController', () => {
    let controller: AvatarUploadController;
    const ctx: AuthorizerContext = {
        userId: '01HZZZZZZZZZZZZZZZZZZZZZZA' as unknown as AuthorizerContext['userId'],
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

    it('rejects unsupported MIME types', async () => {
        await expect(controller.generatePresignedUrl(ctx, 'image/gif', '1024')).rejects.toThrow(BadRequestException);
    });

    it('rejects files exceeding 5 MB', async () => {
        const oversized = (5 * 1024 * 1024 + 1).toString();
        await expect(controller.generatePresignedUrl(ctx, 'image/png', oversized)).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid or missing size', async () => {
        await expect(controller.generatePresignedUrl(ctx, 'image/png', '0')).rejects.toThrow(BadRequestException);
    });
});

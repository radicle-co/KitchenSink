/**
 * T036 — the `/v1/recipes/{recipeId}/photos` REST surface (recipe photos vertical).
 *
 * Thin controller: it reads the authenticated owner key from `req.principal.userId` (set by the
 * fail-closed `AuthMiddleware`) and delegates every decision to {@link PhotosService}. Domain failures
 * (`MAX_PHOTOS_EXCEEDED`) and input-validation `HttpException`s (415/422/413/404) thrown by the service
 * are translated to HTTP by the global `ApiExceptionFilter`. A controller-scoped `ValidationPipe`
 * enforces the DTOs.
 */
import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Req,
    UnauthorizedException,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import type { RecipePhoto } from '@kitchensink/recipe-core';

import { PhotosService, type UploadUrlResponse } from './photos.service.js';
import { CreatePhotoUploadDto } from './dto/create-photo-upload.dto.js';
import { ConfirmPhotoDto } from './dto/confirm-photo.dto.js';
import { ReorderPhotosDto } from './dto/reorder-photos.dto.js';
import type { AuthenticatedRequest } from '../auth/principal.js';

/** Read the verified owner key (app-user ULID) or reject — the middleware guarantees it on this route. */
function ownerIdOf(req: AuthenticatedRequest): string {
    const userId = req.principal?.userId;

    if (!userId) {
        throw new UnauthorizedException('Missing authenticated principal');
    }

    return userId;
}

@Controller('v1/recipes/:recipeId/photos')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class PhotosController {
    public constructor(private readonly photosService: PhotosService) {}

    /** `POST …/photos/upload-url` — presign an S3 PUT for a new photo (allowlisted content type). */
    @Post('upload-url')
    public async createUploadUrl(
        @Req() req: AuthenticatedRequest,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Body() body: CreatePhotoUploadDto,
    ): Promise<UploadUrlResponse> {
        return this.photosService.createUploadUrl(ownerIdOf(req), recipeId, body.contentType);
    }

    /** `POST …/photos/confirm` — validate the uploaded object (magic bytes + size) and persist it. */
    @Post('confirm')
    @HttpCode(HttpStatus.CREATED)
    public async confirm(
        @Req() req: AuthenticatedRequest,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Body() body: ConfirmPhotoDto,
    ): Promise<RecipePhoto> {
        return this.photosService.confirm(ownerIdOf(req), recipeId, body.s3Key);
    }

    /** `GET …/photos` — list the recipe's photos in display order. */
    @Get()
    public async list(
        @Req() req: AuthenticatedRequest,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
    ): Promise<RecipePhoto[]> {
        ownerIdOf(req);

        return this.photosService.list(recipeId);
    }

    /** `PATCH …/photos/reorder` — set the recipe's photo display order. */
    @Patch('reorder')
    public async reorder(
        @Req() req: AuthenticatedRequest,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Body() body: ReorderPhotosDto,
    ): Promise<RecipePhoto[]> {
        ownerIdOf(req);

        return this.photosService.reorder(recipeId, body.photoIds);
    }

    /** `DELETE …/photos/{photoId}` — remove a photo from the recipe. */
    @Delete(':photoId')
    @HttpCode(HttpStatus.NO_CONTENT)
    public async remove(
        @Req() req: AuthenticatedRequest,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Param('photoId', ParseUUIDPipe) photoId: string,
    ): Promise<void> {
        ownerIdOf(req);

        await this.photosService.delete(recipeId, photoId);
    }
}

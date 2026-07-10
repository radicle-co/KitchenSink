/**
 * T036 — the `/v1/recipes/{recipeId}/photos` REST surface (recipe photos vertical).
 *
 * Thin controller: the `@OwnerId()` decorator reads the authenticated owner key from `req.principal`
 * (set by the fail-closed `AuthMiddleware`) and the controller delegates every decision to
 * {@link PhotosService}. Domain failures (`MAX_PHOTOS_EXCEEDED`) and input-validation `HttpException`s
 * (415/422/413/404) thrown by the service are translated to HTTP by the global `ApiExceptionFilter`. A
 * controller-scoped `ValidationPipe` enforces the DTOs.
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
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import type { RecipePhoto } from '@kitchensink/recipe-core';

import { PhotosService, type UploadUrlResponse } from './photos.service.js';
import { CreatePhotoUploadDto } from './dto/create-photo-upload.dto.js';
import { ConfirmPhotoDto } from './dto/confirm-photo.dto.js';
import { ReorderPhotosDto } from './dto/reorder-photos.dto.js';
import { OwnerId } from '../auth/current-principal.decorator.js';

@Controller('v1/recipes/:recipeId/photos')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
export class PhotosController {
    public constructor(private readonly photosService: PhotosService) {}

    /**
     * `POST …/photos/upload-url` — presign an S3 PUT for a new photo (allowlisted content type + size
     * pre-check). Returns `200` (not the POST default `201`) per the OpenAPI contract — no resource is
     * created here; the row is created at `confirm`.
     */
    @Post('upload-url')
    @HttpCode(HttpStatus.OK)
    public async createUploadUrl(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Body() body: CreatePhotoUploadDto,
    ): Promise<UploadUrlResponse> {
        return this.photosService.createUploadUrl(ownerId, recipeId, body);
    }

    /** `POST …/photos/confirm` — validate the uploaded object (magic bytes + size) and persist it. */
    @Post('confirm')
    @HttpCode(HttpStatus.CREATED)
    public async confirm(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Body() body: ConfirmPhotoDto,
    ): Promise<RecipePhoto> {
        return this.photosService.confirm(ownerId, recipeId, body.key);
    }

    /** `GET …/photos` — list the recipe's photos in display order. */
    @Get()
    public async list(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
    ): Promise<RecipePhoto[]> {
        return this.photosService.list(ownerId, recipeId);
    }

    /** `PATCH …/photos/reorder` — set the recipe's photo display order. */
    @Patch('reorder')
    public async reorder(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Body() body: ReorderPhotosDto,
    ): Promise<RecipePhoto[]> {
        return this.photosService.reorder(ownerId, recipeId, body.photoIds);
    }

    /** `DELETE …/photos/{photoId}` — remove a photo from the recipe. */
    @Delete(':photoId')
    @HttpCode(HttpStatus.NO_CONTENT)
    public async remove(
        @OwnerId() ownerId: string,
        @Param('recipeId', ParseUUIDPipe) recipeId: string,
        @Param('photoId', ParseUUIDPipe) photoId: string,
    ): Promise<void> {
        await this.photosService.delete(ownerId, recipeId, photoId);
    }
}

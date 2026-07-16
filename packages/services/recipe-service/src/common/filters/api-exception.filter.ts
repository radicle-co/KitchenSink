import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { isRecipeError, RecipeErrorCode } from '@kitchensink/recipe-core';
import type { RecipeErrorCode as RecipeErrorCodeType } from '@kitchensink/recipe-core';
import type { Response } from 'express';

/**
 * HTTP 423 Locked (WebDAV, RFC 4918). NestJS's `HttpStatus` enum does not define it, so it is
 * declared here for the erasure-in-progress mapping (HAZ-052 rejects concurrent edits with 423).
 */
const HTTP_STATUS_LOCKED = 423;

/**
 * Canonical mapping from each {@link RecipeErrorCode} to the HTTP status the API surfaces. Kept as a
 * complete `Record` (exhaustive over the enum) so a newly-added code fails to compile until it is
 * mapped — there is no silent default. Codes are anchored to the OpenAPI contract and the design
 * artifacts (e.g. `COLLECTION_NOT_CLONED` → 400 per `api.openapi.yaml`; `ERASURE_IN_PROGRESS` → 423
 * per the hazard analysis).
 */
export const RECIPE_ERROR_STATUS: Record<RecipeErrorCodeType, number> = {
    [RecipeErrorCode.RECIPE_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [RecipeErrorCode.RECIPE_TOMBSTONED]: HttpStatus.GONE,
    [RecipeErrorCode.NOT_OWNER]: HttpStatus.FORBIDDEN,
    [RecipeErrorCode.VERSION_CONFLICT]: HttpStatus.CONFLICT,
    [RecipeErrorCode.MAX_PHOTOS_EXCEEDED]: HttpStatus.CONFLICT,
    [RecipeErrorCode.INVALID_VISIBILITY]: HttpStatus.BAD_REQUEST,
    [RecipeErrorCode.PHOTO_PROCESSING_FAILED]: HttpStatus.UNPROCESSABLE_ENTITY,
    [RecipeErrorCode.ARCHIVE_PENDING]: HttpStatus.CONFLICT,
    [RecipeErrorCode.ARCHIVE_DLQ]: HttpStatus.INTERNAL_SERVER_ERROR,
    [RecipeErrorCode.COLLECTION_NOT_CLONED]: HttpStatus.BAD_REQUEST,
    [RecipeErrorCode.ERASURE_IN_PROGRESS]: HTTP_STATUS_LOCKED,
    [RecipeErrorCode.UNKNOWN_INGREDIENT]: HttpStatus.BAD_REQUEST,
    // Rating your OWN recipe is a 403, not a 404: the caller demonstrably already knows the recipe
    // exists (they own it), so an explicit rejection leaks nothing (FR-013). The asymmetric case —
    // rating a recipe you cannot SEE — is a 404 RECIPE_NOT_FOUND, handled by the not-found mapping above.
    [RecipeErrorCode.CANNOT_RATE_OWN_RECIPE]: HttpStatus.FORBIDDEN,
};

/**
 * Structured error envelope returned to API clients. Mirrors the `ErrorResponse` schema in
 * `api.openapi.yaml` (`{ code, message, details? }`).
 */
interface ApiErrorBody {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

/**
 * Global exception filter for the recipe service. Translates thrown domain {@link RecipeError}s into
 * their mapped HTTP status with a structured `{ code, message, details? }` body, preserves framework
 * {@link HttpException}s (validation/auth/etc.) untouched, and collapses every other unexpected
 * throwable to a generic 500 that never leaks internal details.
 *
 * Registered by the application orchestrator as an `APP_FILTER` provider.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    public catch(exception: unknown, host: ArgumentsHost): void {
        const response = host.switchToHttp().getResponse<Response>();

        if (isRecipeError(exception)) {
            const status = RECIPE_ERROR_STATUS[exception.code];
            const body: ApiErrorBody = { code: exception.code, message: exception.message };

            if (exception.details !== undefined) {
                body.details = exception.details;
            }

            response.status(status).json(body);

            return;
        }

        if (exception instanceof HttpException) {
            response.status(exception.getStatus()).json(exception.getResponse());

            return;
        }

        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
        } satisfies ApiErrorBody);
    }
}

import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { isRecipeError, RecipeErrorCode } from '@kitchensink/recipe-core';
import type { RecipeErrorCode as RecipeErrorCodeType } from '@kitchensink/recipe-core';
import type { Request, Response } from 'express';

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
    // A pull-from-source drift (W8-a.8) is an optimistic-concurrency conflict — the previewed set no longer
    // matches; the client re-previews with the fresh diff carried in `details`.
    [RecipeErrorCode.PULL_DRIFT]: HttpStatus.CONFLICT,
    // REQ-049b: the 50-collection-per-owner cap is a resource-count limit, mapped the same way as
    // MAX_PHOTOS_EXCEEDED — 409, not 400/422: the request is well-formed, it is the caller's existing
    // state that conflicts with creating one more.
    [RecipeErrorCode.COLLECTION_LIMIT_REACHED]: HttpStatus.CONFLICT,
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
    private readonly logger = new Logger(ApiExceptionFilter.name);

    public catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const response = http.getResponse<Response>();
        const request = http.getRequest<Request>();
        const route = `${request.method} ${request.originalUrl ?? request.url}`;

        if (isRecipeError(exception)) {
            const status = RECIPE_ERROR_STATUS[exception.code];
            const body: ApiErrorBody = { code: exception.code, message: exception.message };

            if (exception.details !== undefined) {
                body.details = exception.details;
            }

            // Domain errors are expected control-flow, so log at `warn` (with the code) for observability
            // without treating a 4xx as a server fault.
            this.logger.warn(`${route} -> ${status} ${exception.code}: ${exception.message}`);
            response.status(status).json(body);

            return;
        }

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            // Log framework exceptions (validation/auth/etc.) with the response body so a 4xx (e.g. a bad
            // create payload) is diagnosable rather than a silent status on the wire.
            this.logger.warn(`${route} -> ${status}: ${JSON.stringify(exception.getResponse())}`);
            response.status(status).json(exception.getResponse());

            return;
        }

        // Truly unexpected: log the full error (stack included) at `error` before collapsing to a generic 500
        // that never leaks internals to the client.
        this.logger.error(
            `${route} -> 500 unhandled`,
            exception instanceof Error ? exception.stack : String(exception),
        );
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
        } satisfies ApiErrorBody);
    }
}

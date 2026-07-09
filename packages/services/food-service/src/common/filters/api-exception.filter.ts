import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

import {
    isCandidateMismatchError,
    isFetchUnavailableError,
    isFoodNotFoundError,
    isFoodPendingError,
    isNotResolvableError,
} from '../../foods/foods.errors.js';

/**
 * Machine-readable error codes surfaced to `/v1/foods/*` clients. One code per food domain error, so a
 * client (and the sibling identity/recipe services) can branch on a stable `code` string instead of a
 * localized `message`. Kept as an enum so {@link FOOD_ERROR_STATUS} is exhaustive over it at compile time.
 */
export enum FoodErrorCode {
    FOOD_PENDING = 'FOOD_PENDING',
    FOOD_NOT_FOUND = 'FOOD_NOT_FOUND',
    CANDIDATE_MISMATCH = 'CANDIDATE_MISMATCH',
    NOT_RESOLVABLE = 'NOT_RESOLVABLE',
    FETCH_UNAVAILABLE = 'FETCH_UNAVAILABLE',
    /** Generic bucket for any un-mapped throwable — always paired with a 500 and an empty body. */
    INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Canonical, exhaustive mapping from each {@link FoodErrorCode} to the HTTP status the API surfaces —
 * anchored to the `FoodsController` / FR-051 contract (`FOOD_PENDING` → 202, `FOOD_NOT_FOUND` → 404,
 * candidate/lifecycle conflicts → 409, `FETCH_UNAVAILABLE` → 503, everything else → 500). Kept as a
 * complete `Record` so adding a new code fails to compile until it is mapped — there is no silent default.
 */
export const FOOD_ERROR_STATUS: Record<FoodErrorCode, number> = {
    [FoodErrorCode.FOOD_PENDING]: HttpStatus.ACCEPTED,
    [FoodErrorCode.FOOD_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [FoodErrorCode.CANDIDATE_MISMATCH]: HttpStatus.CONFLICT,
    [FoodErrorCode.NOT_RESOLVABLE]: HttpStatus.CONFLICT,
    [FoodErrorCode.FETCH_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
    [FoodErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Structured error envelope returned to API clients: `{ code, message, details? }`. Shared verbatim with
 * the identity and recipe services so one client-side handler covers all three.
 */
export interface ApiErrorBody {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

/** A classified food domain error: its stable code plus any extra `details` / `Retry-After` seconds. */
interface ClassifiedFoodError {
    code: FoodErrorCode;
    details?: Record<string, unknown>;
    retryAfterSeconds?: number;
}

/**
 * Classify a thrown value as one of the food domain errors, or `undefined` when it is not one. Every
 * `foods.errors` type is handled here; the type guards keep this in lockstep with that module.
 */
function classifyFoodError(exception: unknown): ClassifiedFoodError | undefined {
    if (isFoodPendingError(exception)) {
        const details: Record<string, unknown> = { status: exception.status };

        if (exception.estimatedWaitSeconds !== undefined) {
            details['estimatedWaitSeconds'] = exception.estimatedWaitSeconds;
        }

        return { code: FoodErrorCode.FOOD_PENDING, details };
    }

    if (isFoodNotFoundError(exception)) {
        const details = exception.status !== undefined ? { status: exception.status } : undefined;

        return { code: FoodErrorCode.FOOD_NOT_FOUND, details };
    }

    if (isCandidateMismatchError(exception)) {
        return { code: FoodErrorCode.CANDIDATE_MISMATCH };
    }

    if (isNotResolvableError(exception)) {
        return { code: FoodErrorCode.NOT_RESOLVABLE, details: { status: exception.status } };
    }

    if (isFetchUnavailableError(exception)) {
        return {
            code: FoodErrorCode.FETCH_UNAVAILABLE,
            details: { retryAfterSeconds: exception.retryAfterSeconds },
            retryAfterSeconds: exception.retryAfterSeconds,
        };
    }

    return undefined;
}

/**
 * Global exception filter for the food service (registered as an `APP_FILTER` provider). Mirrors the
 * recipe service's filter: it translates thrown food domain errors into their mapped HTTP status with a
 * structured `{ code, message, details? }` body (setting `Retry-After` for `FetchUnavailableError`),
 * passes framework {@link HttpException}s (validation/auth/the controller's FR-051 mapping) through
 * untouched, and collapses every other throwable to a generic 500 that never leaks internal detail.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    public catch(exception: unknown, host: ArgumentsHost): void {
        const response = host.switchToHttp().getResponse<Response>();

        const classified = classifyFoodError(exception);

        if (classified) {
            if (classified.retryAfterSeconds !== undefined) {
                response.setHeader('Retry-After', String(classified.retryAfterSeconds));
            }

            const body: ApiErrorBody = {
                code: classified.code,
                message: (exception as Error).message,
            };

            if (classified.details !== undefined) {
                body.details = classified.details;
            }

            response.status(FOOD_ERROR_STATUS[classified.code]).json(body);

            return;
        }

        if (exception instanceof HttpException) {
            response.status(exception.getStatus()).json(exception.getResponse());

            return;
        }

        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            code: FoodErrorCode.INTERNAL_ERROR,
            message: 'Internal server error',
        } satisfies ApiErrorBody);
    }
}

/**
 * THE TRANSPORT POLICY over the one authored error envelope: which HTTP status each published `code` answers
 * with, and the ONE way anything in this service raises a coded failure.
 *
 * WHY THIS MODULE EXISTS. The code→status mapping is a single piece of knowledge, and it used to have two
 * authors. `ApiExceptionFilter` held an exhaustive `FOOD_ERROR_STATUS` table for the food domain errors, while
 * `FoodsController` independently re-decided the same thing by choosing a Nest exception CLASS
 * (`NotFoundException` for a `FoodNotFoundError`, `ConflictException` for a `CandidateMismatchError`, …). The two
 * agreed by convention only: nothing made them agree, and the controller's copy also happened to be the one that
 * emitted the legacy `{ error, …extras }` body. Routing every raise through {@link apiError} collapses both into
 * this table.
 *
 * ⚠️ {@link apiError} returns a bare `HttpException`, not a `BadRequestException`/`NotFoundException`/…, ON
 * PURPOSE. Picking the subclass is picking the status a second time, from a second place — exactly the
 * duplication this module removes. Assert on `getStatus()`, never on which subclass was constructed.
 *
 * @see ./apiError.schema.ts — the envelope's authored shape.
 * @see ../foods/foods.schema.ts — `foodErrorCodeSchema` / `foodErrorSchema`, the published codes and the typed
 *   `details` each one carries.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { GENERIC_STATUS_CODES, codeForStatus as sharedCodeForStatus } from '@kitchensink/nest-error-envelope';

import { foodErrorCodeSchema, type FoodErrorCode } from '../foods/foods.schema.js';
import type { ApiErrorBody } from './apiError.schema.js';

/**
 * Canonical, exhaustive mapping from each published {@link FoodErrorCode} to the HTTP status the API answers
 * with — the FR-051 precedence contract (`FOOD_PENDING` → 202, `FOOD_NOT_FOUND` → 404, candidate/lifecycle
 * conflicts → 409, `FETCH_UNAVAILABLE` → 503 and never `429`, `SOURCE_UNAVAILABLE` → 502 because the
 * fault is UPSTREAM rather than ours and carries no `Retry-After`).
 *
 * Kept as a COMPLETE `Record` so adding a code to `foodErrorCodeSchema` fails to compile until it is mapped.
 * There is deliberately no default arm: a code without a status is a contract that cannot be served.
 */
export const FOOD_ERROR_STATUS: Readonly<Record<FoodErrorCode, number>> = {
    VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
    INVALID_ID: HttpStatus.BAD_REQUEST,
    BATCH_TOO_LARGE: HttpStatus.BAD_REQUEST,
    UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
    IDENTITY_SYNC_PENDING: HttpStatus.UNAUTHORIZED,
    FORBIDDEN: HttpStatus.FORBIDDEN,
    FOOD_PENDING: HttpStatus.ACCEPTED,
    FOOD_NOT_FOUND: HttpStatus.NOT_FOUND,
    CANDIDATE_MISMATCH: HttpStatus.CONFLICT,
    NOT_RESOLVABLE: HttpStatus.CONFLICT,
    NOT_REQUEUEABLE: HttpStatus.CONFLICT,
    FETCH_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
    SOURCE_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
    INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * The code for a failure that has NO published domain code — a framework or transport-level outcome no
 * documented route produces.
 *
 * ⚠️ IT IS NOW `GENERIC_STATUS_CODES` SPREAD, not one of three hand-written copies. That shared table
 * (`@kitchensink/nest-error-envelope`) is the vocabulary the three services agree on for the generic cases; the
 * overrides below are the rows where THIS service has a published member of its own. The three copies had already
 * drifted — this one and identity's both lacked `GONE` (410) and `LOCKED` (423) while recipe's had them. Neither is
 * reachable on a food route today, so it was latent; the point is that the drift existed at all.
 *
 * ⚠️ `NOT_FOUND` here is NOT `FOOD_NOT_FOUND`: it is a request for a path this service does not route, which is
 * a different failure with a different fix. Keeping them distinct is the point of having a code at all.
 */
export const FOOD_STATUS_CODE: Readonly<Record<number, string>> = {
    ...GENERIC_STATUS_CODES,
    [HttpStatus.UNAUTHORIZED]: foodErrorCodeSchema.enum.UNAUTHORIZED,
    [HttpStatus.FORBIDDEN]: foodErrorCodeSchema.enum.FORBIDDEN,
    [HttpStatus.INTERNAL_SERVER_ERROR]: foodErrorCodeSchema.enum.INTERNAL_ERROR,
};

/**
 * The `code` to publish for a status with no domain code of its own.
 *
 * A thin binding of the shared `codeForStatus` to THIS service's table, kept one-argument because every call site
 * in the service reads better without repeating the table.
 *
 * @param status - The HTTP status being returned.
 * @returns A stable code — `HTTP_<status>` for anything unlisted, which is deterministic and leaks nothing. Pure.
 */
export function codeForStatus(status: number): string {
    return sharedCodeForStatus(status, FOOD_STATUS_CODE);
}

/**
 * Build the exception for a published failure code: the {@link ApiErrorBody} envelope at the status
 * {@link FOOD_ERROR_STATUS} assigns it.
 *
 * @param code - The published failure code. Its status comes from the table, never from the call site.
 * @param message - Human-readable summary. Never localized, never security-sensitive, never a stack trace.
 * @param details - The diagnostic detail this code's contract promises, when it promises any.
 * @returns The `HttpException` to throw. Pure — constructing it performs no I/O.
 */
export function apiError(code: FoodErrorCode, message: string, details?: Record<string, unknown>): HttpException {
    const body: ApiErrorBody = details === undefined ? { code, message } : { code, message, details };

    return new HttpException(body, FOOD_ERROR_STATUS[code]);
}

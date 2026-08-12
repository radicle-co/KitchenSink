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
 * @see ./api-error.schema.ts — the envelope's authored shape.
 * @see ../foods/foods.schema.ts — `foodErrorCodeSchema` / `foodErrorSchema`, the published codes and the typed
 *   `details` each one carries.
 */
import { HttpException, HttpStatus } from '@nestjs/common';

import { foodErrorCodeSchema, type FoodErrorCode } from '../foods/foods.schema.js';
import type { ApiErrorBody } from './api-error.schema.js';

/**
 * Canonical, exhaustive mapping from each published {@link FoodErrorCode} to the HTTP status the API answers
 * with — the FR-051 precedence contract (`FOOD_PENDING` → 202, `FOOD_NOT_FOUND` → 404, candidate/lifecycle
 * conflicts → 409, `FETCH_UNAVAILABLE` → 503 and never `429`).
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
    FETCH_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
    INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * The code for a failure that has NO published domain code — a framework or transport-level outcome no
 * documented route produces.
 *
 * Deliberately the SAME table the identity service uses (`packages/services/identity/src/common/filters/
 * api-exception.filter.ts`), so the three services speak one vocabulary for the generic cases. Kept explicit
 * rather than derived from Nest's status text, so the wire contract is decoupled from the framework's wording.
 *
 * ⚠️ `NOT_FOUND` here is NOT `FOOD_NOT_FOUND`: it is a request for a path this service does not route, which is
 * a different failure with a different fix. Keeping them distinct is the point of having a code at all.
 */
const STATUS_CODE: Readonly<Record<number, string>> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: foodErrorCodeSchema.enum.UNAUTHORIZED,
    [HttpStatus.FORBIDDEN]: foodErrorCodeSchema.enum.FORBIDDEN,
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
    [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
    [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
    [HttpStatus.INTERNAL_SERVER_ERROR]: foodErrorCodeSchema.enum.INTERNAL_ERROR,
    [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

/**
 * The `code` to publish for a status with no domain code of its own.
 *
 * @param status - The HTTP status being returned.
 * @returns A stable code — `HTTP_<status>` for anything unlisted, which is deterministic and leaks nothing. Pure.
 */
export function codeForStatus(status: number): string {
    return STATUS_CODE[status] ?? `HTTP_${status}`;
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

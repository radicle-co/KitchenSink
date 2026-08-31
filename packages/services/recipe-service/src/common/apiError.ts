/**
 * THE TRANSPORT POLICY over the one authored error envelope: which HTTP status each published `code` answers
 * with, and the ONE way anything in this service raises a coded failure.
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM THE FILTER. The code→status mapping is a single piece of knowledge, and
 * it needs to be readable by two callers that must not disagree: `ApiExceptionFilter`, which classifies a thrown
 * domain error, and {@link apiError}, which any service or guard uses to raise a coded failure directly. While
 * the table lived inside the filter, the second caller did not exist — so every non-domain failure was raised by
 * choosing a Nest exception CLASS, which is deciding the status from a second place, and the body that came with
 * it was whatever Nest happened to build.
 *
 * ⚠️ {@link apiError} returns a bare `HttpException`, not a `BadRequestException`/`NotFoundException`/…, ON
 * PURPOSE. Picking the subclass is picking the status a second time, from a second place — exactly the
 * duplication this module removes. Assert on `getStatus()`, never on which subclass was constructed.
 *
 * ⚠️ Recipe did NOT have food's `mapReadError`/`mapWriteError` controller duplication — checked before this change
 * rather than assumed, and its domain errors already propagated to the filter untouched. So unlike food's
 * convergence there was nothing to DELETE here; the gap was the filter's passthrough branch and the absence of a
 * published code union. That difference is recorded so a reader does not go looking for helpers that were never
 * there.
 *
 * @see ./apiError.schema.ts — the envelope, the published code enum, and the typed per-code `details`.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { GENERIC_STATUS_CODES, codeForStatus as sharedCodeForStatus } from '@kitchensink/nest-error-envelope';

import { recipeErrorCodeSchema, type ApiErrorBody, type RecipeErrorCode } from './apiError.schema.js';

/**
 * HTTP 423 Locked (WebDAV, RFC 4918). NestJS's `HttpStatus` enum does not define it, so it is declared here for
 * the erasure-in-progress mapping (HAZ-052 rejects concurrent edits with 423).
 */
export const HTTP_STATUS_LOCKED = 423;

/**
 * Canonical, exhaustive mapping from each published {@link RecipeErrorCode} to the HTTP status the API answers
 * with.
 *
 * Kept as a COMPLETE `Record` so adding a code to `recipeErrorCodeSchema` fails to compile until it is mapped.
 * There is deliberately no default arm: a code without a status is a contract that cannot be served.
 *
 * ⚠️ The fifteen DOMAIN rows are byte-for-byte the statuses the previous `RECIPE_ERROR_STATUS` assigned, and that
 * is load-bearing — this change converges the BODY, and a status that moved with it would be a second, unrelated
 * wire break hidden inside the first. `__tests__/apiError.test.ts` pins each one against the value the old table
 * held, so the preservation is checked rather than claimed.
 */
export const RECIPE_ERROR_STATUS: Readonly<Record<RecipeErrorCode, number>> = {
    // ── The fifteen recipe domain codes, statuses unchanged from the pre-convergence table ──
    RECIPE_NOT_FOUND: HttpStatus.NOT_FOUND,
    RECIPE_TOMBSTONED: HttpStatus.GONE,
    NOT_OWNER: HttpStatus.FORBIDDEN,
    VERSION_CONFLICT: HttpStatus.CONFLICT,
    MAX_PHOTOS_EXCEEDED: HttpStatus.CONFLICT,
    INVALID_VISIBILITY: HttpStatus.BAD_REQUEST,
    PHOTO_PROCESSING_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
    ARCHIVE_PENDING: HttpStatus.CONFLICT,
    ARCHIVE_DLQ: HttpStatus.INTERNAL_SERVER_ERROR,
    COLLECTION_NOT_CLONED: HttpStatus.BAD_REQUEST,
    PULL_DRIFT: HttpStatus.CONFLICT,
    COLLECTION_LIMIT_REACHED: HttpStatus.CONFLICT,
    ERASURE_IN_PROGRESS: HTTP_STATUS_LOCKED,
    UNKNOWN_INGREDIENT: HttpStatus.BAD_REQUEST,
    CANNOT_RATE_OWN_RECIPE: HttpStatus.FORBIDDEN,
    // ── Parse jobs (plan U9) ──
    PARSE_JOB_NOT_FOUND: HttpStatus.NOT_FOUND,
    PARSE_JOB_EXPIRED: HttpStatus.CONFLICT,

    // ── Auth and account lifecycle ──
    UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
    // Deliberately the SAME status as `UNAUTHORIZED` and a DIFFERENT code: both are 401s, they need opposite
    // handling ("retry with a refreshed token" versus "sign in"), and the status alone cannot tell them apart.
    // That distinction is the whole reason the envelope carries a code.
    IDENTITY_SYNC_PENDING: HttpStatus.UNAUTHORIZED,
    FORBIDDEN: HttpStatus.FORBIDDEN,
    ACCOUNT_ALREADY_ERASED: HttpStatus.GONE,

    // ── Transport / framework outcomes ──
    VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
    NOT_FOUND: HttpStatus.NOT_FOUND,
    PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
    UNSUPPORTED_MEDIA_TYPE: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,
    NOT_READY: HttpStatus.SERVICE_UNAVAILABLE,
    // A rate refusal, never a 429: the limit is a SHARED external one, not the caller's personal
    // quota, so blaming the caller would be wrong and would invite the wrong client behaviour.
    SOURCE_BUSY: HttpStatus.SERVICE_UNAVAILABLE,
    // 502, because the fault is genuinely upstream of us — and it carries no Retry-After, because
    // nothing here knows when an external source recovers.
    SOURCE_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
    INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * The `code` to publish for a status that arrived with no code of its own.
 *
 * ⚠️ IT IS NOW `GENERIC_STATUS_CODES` SPREAD, not a third hand-written copy of it. That shared table
 * (`@kitchensink/nest-error-envelope`) holds the vocabulary the three services agree on for the cases that are not
 * about any domain; the overrides below are the rows where THIS service has a PUBLISHED member of its own, so a
 * `404` is spelled with `recipeErrorCodeSchema`'s value rather than a matching string literal. Identity's copy of
 * the same table was missing `GONE` and `LOCKED`, which is what three hand-maintained copies buys you.
 *
 * ⚠️ NOT every value here is a PUBLISHED code, and that is deliberate rather than an oversight. `BAD_REQUEST`,
 * `METHOD_NOT_ALLOWED`, `CONFLICT`, `GONE`, `UNPROCESSABLE_ENTITY`, `LOCKED` and `SERVICE_UNAVAILABLE` are absent
 * from `recipeErrorCodeSchema`, so the typed union REJECTS them and a consumer degrades to mapping by status —
 * which is the correct handling, because these are exactly the failures where the status IS the whole signal.
 * Publishing them would invite a consumer to branch on a code that carries no more information than the number
 * beside it. Food made the identical call.
 *
 * ⚠️ `NOT_FOUND` here is NOT `RECIPE_NOT_FOUND`: it is a request for a path this service does not route, which is
 * a different failure with a different fix. Keeping them distinct is the point of having a code at all. The
 * override is what makes it this service's PUBLISHED `NOT_FOUND` rather than the shared literal — the strings are
 * equal, and `__tests__/apiError.test.ts` asserts the mapping so the equality is checked rather than assumed.
 */
export const RECIPE_STATUS_CODE: Readonly<Record<number, string>> = {
    ...GENERIC_STATUS_CODES,
    [HttpStatus.UNAUTHORIZED]: recipeErrorCodeSchema.enum.UNAUTHORIZED,
    [HttpStatus.FORBIDDEN]: recipeErrorCodeSchema.enum.FORBIDDEN,
    [HttpStatus.NOT_FOUND]: recipeErrorCodeSchema.enum.NOT_FOUND,
    [HttpStatus.PAYLOAD_TOO_LARGE]: recipeErrorCodeSchema.enum.PAYLOAD_TOO_LARGE,
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: recipeErrorCodeSchema.enum.UNSUPPORTED_MEDIA_TYPE,
    [HTTP_STATUS_LOCKED]: 'LOCKED',
    [HttpStatus.TOO_MANY_REQUESTS]: recipeErrorCodeSchema.enum.TOO_MANY_REQUESTS,
    [HttpStatus.INTERNAL_SERVER_ERROR]: recipeErrorCodeSchema.enum.INTERNAL_ERROR,
};

/**
 * The `code` to publish for a status with no code of its own.
 *
 * A thin binding of the shared `codeForStatus` to THIS service's table, kept as a one-argument function because
 * every call site in the service reads better without repeating the table.
 *
 * @param status - The HTTP status being returned.
 * @returns A stable code — `HTTP_<status>` for anything unlisted, which is deterministic and leaks nothing. Pure.
 */
export function codeForStatus(status: number): string {
    return sharedCodeForStatus(status, RECIPE_STATUS_CODE);
}

/**
 * Build the exception for a published failure code: the {@link ApiErrorBody} envelope at the status
 * {@link RECIPE_ERROR_STATUS} assigns it.
 *
 * @param code - The published failure code. Its status comes from the table, never from the call site.
 * @param message - Human-readable summary. Never localized, never security-sensitive, never a stack trace.
 * @param details - The diagnostic detail this code's contract promises, when it promises any.
 * @returns The `HttpException` to throw. Pure — constructing it performs no I/O.
 */
export function apiError(code: RecipeErrorCode, message: string, details?: Record<string, unknown>): HttpException {
    const body: ApiErrorBody = details === undefined ? { code, message } : { code, message, details };

    return new HttpException(body, RECIPE_ERROR_STATUS[code]);
}

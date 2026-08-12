import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { isRecipeError } from '@kitchensink/recipe-core';
import type { Request, Response } from 'express';

import { recipeErrorCodeSchema, type ApiErrorBody, type RecipeErrorCode } from '../api-error.schema.js';
import { codeForStatus, RECIPE_ERROR_STATUS } from '../api-error.js';

/**
 * The published failure codes, by name. AUTHORED in `../api-error.schema.ts` (`recipeErrorCodeSchema`) and
 * published to every consumer through `@kitchensink/schema-recipe`, so the code this filter writes and the code a
 * client branches on are ONE definition.
 */
const CODE = recipeErrorCodeSchema.enum;

/** Last-resort `message` when neither the body nor the exception offers a non-empty one. */
const UNSPECIFIED_MESSAGE = 'Request failed';

/**
 * Render ONE zod issue as a human-readable constraint, prefixed with the field it failed on. Pure.
 *
 * A zod issue's `message` is the CONSTRAINT alone (`Too small: expected string to have >=1 characters`), so
 * without the path a caller is told something is wrong but not what. An issue whose `path` is empty describes the
 * object itself — `z.strictObject`'s `unrecognized_keys` is exactly that, and since the strict sweep it is a
 * common case — and is rendered bare rather than with an empty `': '` prefix. A path segment may be a symbol in
 * zod v4, hence the string/number filter.
 *
 * @param issue - One entry of the validation exception's `errors` array.
 * @returns `"<field path>: <message>"`, the bare message for a path-less issue, or `undefined` when the entry is
 *   not renderable (so an unrecognised shape degrades to the envelope's own message).
 */
function describeIssue(issue: unknown): string | undefined {
    if (issue === null || typeof issue !== 'object') {
        return undefined;
    }

    const message = (issue as Record<string, unknown>)['message'];

    if (typeof message !== 'string' || message.length === 0) {
        return undefined;
    }

    const rawPath = (issue as Record<string, unknown>)['path'];
    const field = Array.isArray(rawPath)
        ? rawPath
              .filter(
                  (segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number',
              )
              .join('.')
        : '';

    return field.length === 0 ? message : `${field}: ${message}`;
}

/**
 * Translate a `nestjs-zod` validation rejection into the envelope, or `undefined` when the body is not one.
 *
 * WHY THIS EXISTS. `ZodValidationPipe` throws a `ZodValidationException` whose body is
 * `{ statusCode, message: 'Validation failed', errors: [...issues] }` — a FIXED message that discards both the
 * field names and the issues. Without this branch the generic normalization below would faithfully publish that
 * useless string, telling a caller their request was invalid and nothing about which part. That matters more here
 * than it did before the `z.strictObject()` sweep: GR-017 §17-c's promise is that a misspelled field becomes "a
 * `400` the client can fix", and a body reading only `Validation failed` does not keep it.
 *
 * The `errors` key is matched STRUCTURALLY rather than with `instanceof ZodValidationException`: the input here is
 * the serialized response body, and a duck-typed match cannot be defeated by a duplicated `nestjs-zod` install.
 * That the pipe really does put its issues there is pinned by a test that drives the REAL pipe.
 *
 * @param body - The `HttpException`'s response body.
 * @returns The envelope, or `undefined` when this is not a validation rejection.
 */
function asValidationEnvelope(body: unknown): ApiErrorBody | undefined {
    if (body === null || typeof body !== 'object') {
        return undefined;
    }

    const rawErrors = (body as Record<string, unknown>)['errors'];

    if (!Array.isArray(rawErrors)) {
        return undefined;
    }

    const fields = rawErrors.map(describeIssue).filter((field): field is string => field !== undefined);

    // An `errors` array with nothing renderable in it must not manufacture an empty `details.fields` or a blank
    // `message` — fall through to the generic normalization instead.
    if (fields.length === 0) {
        return undefined;
    }

    return { code: CODE.VALIDATION_FAILED, message: fields.join(', '), details: { fields } };
}

/** Body keys the framework owns; never lifted into `details`, because they duplicate the envelope. */
const FRAMEWORK_KEYS = new Set(['statusCode', 'message', 'error', 'code', 'details', 'errors']);

/**
 * A body that is ALREADY the envelope, taken verbatim. `undefined` when it is not one.
 *
 * This branch is what keeps a DELIBERATE code from being overwritten by a status-derived one, and the case that
 * matters is `IDENTITY_SYNC_PENDING` versus a plain `UNAUTHORIZED`: both are `401`s, they need opposite handling,
 * and a status-keyed derivation would flatten them into one. `ACCOUNT_ALREADY_ERASED` versus a bare `GONE` is the
 * same shape of distinction. It also means {@link apiError}'s output passes through untransformed.
 *
 * The envelope is REBUILT from the recognised keys rather than spread: a body of `{ code, message, id }` must not
 * publish a stray top-level `id`, because "extras live in `details`" is the property the one-shape contract rests
 * on. Dropping it here makes the omission visible in a test rather than on the wire.
 *
 * @param body - The `HttpException`'s response body.
 * @param fallbackMessage - `exception.message`, used when the body names a code but no message.
 * @returns The envelope, or `undefined`. Pure.
 */
function asExplicitEnvelope(body: unknown, fallbackMessage: string): ApiErrorBody | undefined {
    if (body === null || typeof body !== 'object') {
        return undefined;
    }

    const record = body as Record<string, unknown>;
    const code = record['code'];

    if (typeof code !== 'string' || code.length === 0) {
        return undefined;
    }

    // A `code` with NO message is still an explicit code, and losing it would flatten the very distinction this
    // branch exists to protect. The message falls back to the exception's; only the code is load-bearing.
    const raw = record['message'];
    const candidate = typeof raw === 'string' && raw.length > 0 ? raw : fallbackMessage;
    const message = candidate.length > 0 ? candidate : UNSPECIFIED_MESSAGE;
    const details = record['details'];

    return details !== null && typeof details === 'object' && !Array.isArray(details)
        ? { code, message, details: details as Record<string, unknown> }
        : { code, message };
}

/**
 * The best available `message` for a framework body, plus any caller-relevant extras lifted into `details`.
 *
 * Handles every body shape Nest can hand us:
 *
 *  - a bare STRING — `new HttpException('Locked', 423)`, and `@nestjs/throttler`'s `ThrottlerException`, whose
 *    response IS the string `"ThrottlerException: Too Many Requests"`. That is the `429` body that used to reach
 *    the wire as bare JSON text rather than an object;
 *  - `{ statusCode, message, error }` — Nest's own object body, from every `new BadRequestException('a string')`;
 *  - `{ message: 'Unauthorized', statusCode: 401 }` — the ARGUMENT-LESS form, which omits `error` entirely.
 *    `ClerkAuthService` raises exactly this once and `ServiceErasureAuthService` four times;
 *  - `{ message: [...] }` — the array form Nest builds for a multi-constraint rejection;
 *  - `{ status: 'unavailable', service: 'recipe' }` — the pre-convergence readiness body, kept working by the
 *    extras lift even though the health controller now raises `NOT_READY` directly;
 *  - anything else (a number, an array) — falls back to `exception.message`, which Nest always populates.
 *
 * `error` is used as the message ONLY when there is no `message`, because in Nest's own body `error` is the STATUS
 * TEXT (`'Unauthorized'`) and publishing that would be strictly less informative than what sits beside it.
 *
 * @param body - The `HttpException`'s response body.
 * @param fallbackMessage - `exception.message`, used when the body carries none.
 * @returns The message and, when the body carried extras, the `details` to publish them under. Pure.
 */
function describeBody(body: unknown, fallbackMessage: string): { message: string; details?: Record<string, unknown> } {
    if (typeof body === 'string') {
        return { message: body.length > 0 ? body : fallbackMessage };
    }

    if (body === null || typeof body !== 'object') {
        return { message: fallbackMessage.length > 0 ? fallbackMessage : UNSPECIFIED_MESSAGE };
    }

    const record = body as Record<string, unknown>;
    const rawMessage = record['message'];
    const rawError = record['error'];
    let message = fallbackMessage;

    if (Array.isArray(rawMessage)) {
        message = rawMessage.join(', ');
    } else if (typeof rawMessage === 'string' && rawMessage.length > 0) {
        message = rawMessage;
    } else if (typeof rawError === 'string' && rawError.length > 0) {
        message = rawError;
    }

    const extras = Object.fromEntries(Object.entries(record).filter(([key]) => !FRAMEWORK_KEYS.has(key)));
    const resolved = message.length > 0 ? message : UNSPECIFIED_MESSAGE;

    // A `message` ARRAY is Nest's per-field rejection shape, so it is published as `details.fields` — the same key
    // the zod path uses, so a client reads one place regardless of which validator rejected it.
    if (Array.isArray(rawMessage)) {
        return { message: resolved, details: { ...extras, fields: rawMessage } };
    }

    return Object.keys(extras).length === 0 ? { message: resolved } : { message: resolved, details: extras };
}

/**
 * An {@link ApiErrorBody} whose `code` is one of the PUBLISHED codes.
 *
 * An intersection rather than a fresh interface on purpose: it stays THE authored envelope type — so a change to
 * `api-error.schema.ts` still reaches this file — while narrowing `code` enough that {@link RECIPE_ERROR_STATUS},
 * exhaustive over exactly those codes, can be indexed with it without a cast.
 */
type ClassifiedEnvelope = ApiErrorBody & { readonly code: RecipeErrorCode };

/**
 * Classify a thrown value as a recipe DOMAIN error, or `undefined` when it is not one.
 *
 * `isRecipeError` is `recipe-core`'s structural guard, and its `code` is one of the fifteen domain codes — every
 * one of which is a member of the published wire enum, asserted mechanically in
 * `../__tests__/api-error.schema.test.ts` rather than trusted. The status is NOT decided here: it comes from
 * {@link RECIPE_ERROR_STATUS}, the one table {@link apiError} also reads, so a domain error and a deliberately
 * raised code cannot disagree about what a `VERSION_CONFLICT` answers with.
 *
 * @param exception - The thrown value.
 * @returns The envelope to publish, or `undefined`. Pure.
 */
function classifyRecipeError(exception: unknown): ClassifiedEnvelope | undefined {
    if (!isRecipeError(exception)) {
        return undefined;
    }

    return exception.details === undefined
        ? { code: exception.code, message: exception.message }
        : { code: exception.code, message: exception.message, details: exception.details };
}

/** What the filter decided to put on the wire: the status and the envelope (whose `code` drives logging). */
interface Resolution {
    readonly status: number;
    readonly body: ApiErrorBody;
}

/**
 * Decide the wire response for a thrown value. Pure — the whole status/body mapping in one place.
 *
 * ⛔ THERE IS NO PASSTHROUGH BRANCH, AND THAT IS THE POINT. Returning `exception.getResponse()` unchanged is what
 * put FOUR error shapes on this service's wire: the envelope, Nest's `{ statusCode, message, error? }`,
 * `nestjs-zod`'s `{ statusCode, message: 'Validation failed', errors }`, and — for the `429` — a bare JSON STRING.
 * Because the guarantee now lives HERE rather than at each throw site, it also covers failures this service does
 * not raise: `ClerkAuthService`'s argument-less `401`s, Nest's `404` for an unrouted path, the body parser's
 * `413`, the throttler's string `429`. No amount of controller discipline would have reached those.
 *
 * ⛔ Do not reintroduce a "pass it through if it looks fine" shortcut — "looks fine" is what the four shapes were.
 *
 * @param exception - The thrown value.
 * @returns The status and the envelope to surface.
 */
function resolve(exception: unknown): Resolution {
    const classified = classifyRecipeError(exception);

    if (classified) {
        return { status: RECIPE_ERROR_STATUS[classified.code], body: classified };
    }

    if (exception instanceof HttpException) {
        const status = exception.getStatus();
        const raw = exception.getResponse();
        const envelope = asExplicitEnvelope(raw, exception.message) ?? asValidationEnvelope(raw);

        if (envelope !== undefined) {
            return { status, body: envelope };
        }

        const { message, details } = describeBody(raw, exception.message);
        const code = codeForStatus(status);

        return { status, body: details === undefined ? { code, message } : { code, message, details } };
    }

    return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        // ⚠️ The message is a CONSTANT, never the throwable's. An unexpected `Error`'s message is the one place a
        // stack fragment, a connection string or a row's contents can reach a caller.
        body: { code: CODE.INTERNAL_ERROR, message: 'Internal server error' },
    };
}

/**
 * Global exception filter for the recipe service (registered as an `APP_FILTER` provider).
 *
 * **IT IS THE SINGLE AUTHOR OF EVERY ERROR BODY THIS SERVICE EMITS.** A thrown recipe domain error becomes the
 * `{ code, message, details? }` envelope at the status {@link RECIPE_ERROR_STATUS} assigns it; ANY
 * {@link HttpException} — whoever raised it, whatever body it carries — is normalized into that same envelope; and
 * every other throwable collapses to a generic `500` that leaks no internal detail. Making that a property of this
 * class rather than of every throw site is what let four published error shapes become one (see {@link resolve}).
 *
 * ⚠️ `RECIPE_ERROR_STATUS` MOVED OUT of this file to `../api-error.ts` and is re-exported below, because the table
 * now has a second legitimate reader — {@link apiError}, the one way to raise a coded failure — and a table with
 * two readers must not live inside one of them.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(ApiExceptionFilter.name);

    /** @inheritdoc @sideEffect Writes the HTTP response and logs the failure. */
    public catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const request = http.getRequest<Request | undefined>();
        const route = `${request?.method ?? ''} ${request?.originalUrl ?? request?.url ?? ''}`.trim();
        const { status, body } = resolve(exception);

        if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
            // A 5xx is a server fault: log the full throwable INCLUDING its stack, which is the only record of
            // what actually failed — the response deliberately carries none of it.
            this.logger.error(
                `${route} -> ${status} ${body.code}: ${body.message}`,
                exception instanceof Error ? exception.stack : String(exception),
            );
        } else {
            // A 4xx (and the readiness 503's sibling cases) is expected control flow: visible at `warn` with the
            // code, so a log query can group failures without a stack per request.
            this.logger.warn(`${route} -> ${status} ${body.code}: ${body.message}`);
        }

        http.getResponse<Response>().status(status).json(body);
    }
}

// Re-exported because this module is where every existing import site expects to find them, and because the
// envelope's authored home is the schema file rather than either of these.
export { RECIPE_ERROR_STATUS } from '../api-error.js';
export { apiErrorSchema, type ApiErrorBody } from '../api-error.schema.js';

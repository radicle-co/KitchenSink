import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { isRecipeError } from '@kitchensink/recipe-core';
import { normalizeHttpException } from '@kitchensink/nest-error-envelope';
import type { ApiErrorEnvelope, EnvelopeVocabulary, NormalizedFailure } from '@kitchensink/nest-error-envelope';
import type { Request, Response } from 'express';

import { recipeErrorCodeSchema, type RecipeErrorCode } from '../api-error.schema.js';
import { RECIPE_ERROR_STATUS, RECIPE_STATUS_CODE } from '../api-error.js';

/**
 * The published failure codes, by name. AUTHORED in `../api-error.schema.ts` (`recipeErrorCodeSchema`) and
 * published to every consumer through `@kitchensink/schema-recipe`, so the code this filter writes and the code a
 * client branches on are ONE definition.
 */
const CODE = recipeErrorCodeSchema.enum;

/**
 * This service's published code vocabulary, handed to the shared normalization.
 *
 * ⚠️ THE NORMALIZATION ITSELF NO LONGER LIVES IN THIS FILE. `describeIssue`, `asValidationEnvelope`,
 * `asExplicitEnvelope`, `describeBody`, `FRAMEWORK_KEYS` and `UNSPECIFIED_MESSAGE` were ~100 lines that were, line
 * for line, food's — and identity's third variant of the same idea was MISSING the explicit-code branch, which
 * made its readiness `503` publish `SERVICE_UNAVAILABLE` where its own OpenAPI document promised `NOT_READY`. The
 * mechanism is now `@kitchensink/nest-error-envelope`; what stays here is what ADR-0014 requires to stay: this
 * service's own codes, its own status table, its domain-error branch and its own logging.
 */
const VOCABULARY: EnvelopeVocabulary = {
    validationFailedCode: CODE.VALIDATION_FAILED,
    statusCode: RECIPE_STATUS_CODE,
};

/**
 * An {@link ApiErrorBody} whose `code` is one of the PUBLISHED codes.
 *
 * An intersection rather than a fresh interface on purpose: it stays the MECHANISM's envelope type — the one
 * `normalizeHttpException` also returns, so both arms of {@link resolve} produce one shape — while narrowing `code`
 * enough that {@link RECIPE_ERROR_STATUS}, exhaustive over exactly those codes, can be indexed without a cast.
 *
 * ⚠️ Deliberately NOT the authored `ApiErrorBody`. That type is `.loose()`, so it carries an index signature and
 * would accept any extra top-level key here — the exact thing `asExplicitEnvelope` rebuilds the envelope to
 * prevent. The two shapes are asserted equivalent in `packages/infra/global/__tests__/error-envelope-parity.test.ts`
 * (every service's published `apiErrorSchema` parses a mechanism envelope), so using the tighter one loses nothing.
 */
type ClassifiedEnvelope = ApiErrorEnvelope & { readonly code: RecipeErrorCode };

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

/*
 * What the filter decided to put on the wire is the shared `NormalizedFailure` — `{ status, body }`, where `body`
 * is the mechanism's envelope. It used to be a local `Resolution` interface over `ApiErrorBody`; using the shared
 * type instead is what lets the domain arm and the `HttpException` arm return the same thing without a cast.
 */

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
function resolve(exception: unknown): NormalizedFailure {
    const classified = classifyRecipeError(exception);

    if (classified) {
        return { status: RECIPE_ERROR_STATUS[classified.code], body: classified };
    }

    if (exception instanceof HttpException) {
        return normalizeHttpException(exception, VOCABULARY);
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

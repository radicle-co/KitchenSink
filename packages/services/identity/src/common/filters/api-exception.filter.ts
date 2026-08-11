import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Response } from 'express';

import { shouldCaptureException } from '../../observability/sentry.filter.js';

// The envelope is AUTHORED as zod in `../api-error.schema.ts` and published via `@kitchensink/schema-identity`
// (CODING_STANDARDS §15.2), so the shape this filter writes and the shape clients parse are ONE definition rather
// than two hand-written interfaces on either side of the wire. Re-exported here because this module is where every
// existing import site expects to find it.
export type { ApiErrorBody } from '../api-error.schema.js';

import type { ApiErrorBody } from '../api-error.schema.js';

/**
 * Stable, machine-readable `code` for each HTTP status the identity service surfaces. Identity expresses
 * its domain failures AS Nest `HttpException`s (`NotFoundException`, `ForbiddenException`, …), so the
 * status is the mapping key. Unlisted statuses fall back to `HTTP_<status>` — a deterministic code, never
 * a leak. Kept explicit (not derived from the status text) so the wire contract is decoupled from Nest.
 */
const STATUS_CODE: Readonly<Record<number, string>> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
    [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
    [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
    [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
    [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

/** The generic code for anything without a specific mapping — paired with a 500 and a detail-free body. */
const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR';

function codeForStatus(status: number): string {
    return STATUS_CODE[status] ?? `HTTP_${status}`;
}

/**
 * Render ONE validation issue as a single human-readable constraint message, prefixed with the field it
 * failed on. Pure.
 *
 * Accepts `unknown` and returns `undefined` for anything it cannot render, so a body carrying a shape this
 * function does not recognise degrades to the envelope's own `message` instead of emitting `undefined` or
 * `[object Object]` onto the wire.
 *
 * The path prefix is what makes the message usable: a zod issue's `message` is the CONSTRAINT alone
 * (`Invalid URL`), unlike a class-validator constraint string, which embedded the property name. An issue
 * whose `path` is empty describes the object itself — `z.strictObject`'s `unrecognized_keys` is exactly
 * that — so it is rendered bare rather than with an empty `': '` prefix. A `path` segment may be a symbol
 * in zod v4, hence the string/number filter.
 *
 * @param issue - One entry of a validation exception's `errors` array.
 * @returns `"<field path>: <message>"`, the bare message for a path-less issue, or `undefined`.
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
 * Derive the envelope `message` (and any `details`) from an `HttpException`'s response body. Nest's body is
 * either a bare string or an object `{ statusCode, message, error }`, and a VALIDATION rejection carries its
 * per-field diagnostics in one of two places — both of which are lifted into `details.fields` and joined for
 * the human-readable `message`, because `details.fields` is what the published contract promises
 * (`contract/openapi.ts`, `../api-error.schema.ts`) and `message` is all a client is guaranteed to show.
 *
 * 1. `errors` — an array of zod issues. This is what `nestjs-zod`'s `ZodValidationException` builds
 *    (`{ statusCode, message: 'Validation failed', errors: [...issues] }`), i.e. what the globally-bound
 *    `ZodValidationPipe` throws for every request DTO in this service. Its `message` is the FIXED string
 *    `'Validation failed'`, so reading `message` alone discards the field names AND the issues — which is
 *    precisely the regression that shipped when the DTOs moved off `class-validator`: the only validated
 *    write route in the service answered `{"code":"BAD_REQUEST","message":"Validation failed"}` while three
 *    artifacts promised `details.fields`, and the profile form had nothing to show but that bare string.
 *    Checked FIRST for that reason: the string `message` is present too, and would otherwise win.
 * 2. `message` as an ARRAY — Nest's own body shape for `new HttpException([...])`. No identity route
 *    produces it today (there is no `class-validator` left in the service), but it is a supported framework
 *    shape and dropping the branch would collapse such a body to `exception.message`, i.e. `'Bad Request'`.
 *
 * The `errors` key is matched STRUCTURALLY rather than by `instanceof ZodValidationException` on purpose:
 * this function's input is the serialized response body, and a duck-typed match cannot be defeated by a
 * duplicated `nestjs-zod` install. The coupling that matters — that the pipe really does put its issues
 * there — is pinned by `tests/api-exception.filter.test.ts`, which drives the REAL pipe rather than a
 * hand-shaped body, so a `nestjs-zod` change fails a test instead of quietly degrading the wire.
 */
function shapeHttpException(exception: HttpException): { message: string; details?: Record<string, unknown> } {
    const body = exception.getResponse();

    if (typeof body === 'string') {
        return { message: body };
    }

    if (body !== null && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        const rawErrors = record['errors'];

        if (Array.isArray(rawErrors)) {
            const fields = rawErrors.map(describeIssue).filter((field): field is string => field !== undefined);

            // An `errors` array with nothing renderable in it must not manufacture an empty `details.fields`
            // or a blank `message` — fall through to whatever the body's own `message` says.
            if (fields.length > 0) {
                return { message: fields.join(', '), details: { fields } };
            }
        }

        const rawMessage = record['message'];

        if (Array.isArray(rawMessage)) {
            return { message: rawMessage.join(', '), details: { fields: rawMessage } };
        }

        if (typeof rawMessage === 'string') {
            return { message: rawMessage };
        }
    }

    return { message: exception.message };
}

/**
 * Global exception filter for the identity service (registered as an `APP_FILTER` provider). It composes
 * the two cross-cutting concerns at one boundary:
 *
 * 1. **Observability** — unexpected (non-`HttpException`) throwables are still reported to Sentry via the
 *    unchanged {@link shouldCaptureException} predicate, exactly as the prior `SentryExceptionFilter` did.
 * 2. **Response shape** — every failure is rendered as the shared `{ code, message, details? }` envelope:
 *    a known `HttpException` maps to its status + a code, and any other throwable collapses to a generic
 *    500 that never leaks internal detail.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    public catch(exception: unknown, host: ArgumentsHost): void {
        if (shouldCaptureException(exception)) {
            Sentry.captureException(exception);
        }

        const response = host.switchToHttp().getResponse<Response>();

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const { message, details } = shapeHttpException(exception);
            const envelope: ApiErrorBody = { code: codeForStatus(status), message };

            if (details !== undefined) {
                envelope.details = details;
            }

            response.status(status).json(envelope);

            return;
        }

        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            code: INTERNAL_ERROR_CODE,
            message: 'Internal server error',
        } satisfies ApiErrorBody);
    }
}

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
 * Derive the envelope `message` (and any `details`) from an `HttpException`'s response body. Nest's body
 * is either a bare string or an object `{ statusCode, message, error }`; class-validator produces a
 * `message` *array* of constraint strings — those are preserved under `details.fields` and joined for the
 * human-readable `message`.
 */
function shapeHttpException(exception: HttpException): { message: string; details?: Record<string, unknown> } {
    const body = exception.getResponse();

    if (typeof body === 'string') {
        return { message: body };
    }

    if (body !== null && typeof body === 'object') {
        const record = body as Record<string, unknown>;
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

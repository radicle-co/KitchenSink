import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { GENERIC_STATUS_CODES, normalizeHttpException } from '@kitchensink/nest-error-envelope';
import type { EnvelopeVocabulary } from '@kitchensink/nest-error-envelope';
import * as Sentry from '@sentry/nestjs';
import type { Response } from 'express';

import { shouldCaptureException } from '../../observability/sentry.filter.js';

// The envelope is AUTHORED as zod in `../apiError.schema.ts` and published via `@kitchensink/schema-identity`
// (CODING_STANDARDS §15.2), so the shape this filter writes and the shape clients parse are ONE definition rather
// than two hand-written interfaces on either side of the wire. Re-exported here because this module is where every
// existing import site expects to find it.
export type { ApiErrorBody } from '../apiError.schema.js';

import type { ApiErrorBody } from '../apiError.schema.js';

/**
 * The generic code for anything without a specific mapping — paired with a 500 and a detail-free body.
 *
 * Also the value `GENERIC_STATUS_CODES` maps `500` to; spelled here because the non-`HttpException` arm below
 * never consults the table (there is no status to key on — the 500 is this filter's own decision).
 */
const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR';

/**
 * Identity's published code vocabulary, handed to the shared normalization.
 *
 * ── WHY THE TABLE IS NOW A SPREAD OF `GENERIC_STATUS_CODES` ──
 *
 * Identity expresses its domain failures AS Nest `HttpException`s (`NotFoundException`, `ForbiddenException`, …),
 * so the status is the mapping key and identity needs no members of its own. It previously declared the table
 * INLINE — the third of three copies across the services — and that copy was missing `GONE` (410) and `LOCKED`
 * (423). Neither is reachable on a current identity route, so it was latent rather than live; the point is that
 * three hand-maintained copies of one table is how a row goes missing at all.
 *
 * ⚠️ `validationFailedCode` is `BAD_REQUEST` — identity's own choice, NOT recipe's `VALIDATION_FAILED` — because
 * identity's published `openapi.yaml` and `apiError.schema.ts` describe the `400` that way today, and changing it
 * here would be an unannounced wire change on the service every request touches. The vocabulary is per-service on
 * purpose (ADR-0014); only the MECHANISM is shared.
 */
const VOCABULARY: EnvelopeVocabulary = {
    validationFailedCode: 'BAD_REQUEST',
    statusCode: GENERIC_STATUS_CODES,
};

/**
 * Global exception filter for the identity service (registered as an `APP_FILTER` provider). It composes
 * the two cross-cutting concerns at one boundary:
 *
 * 1. **Observability** — unexpected (non-`HttpException`) throwables are still reported to Sentry via the
 *    unchanged {@link shouldCaptureException} predicate, exactly as the prior `SentryExceptionFilter` did.
 * 2. **Response shape** — every failure is rendered as the `{ code, message, details? }` envelope by
 *    `normalizeHttpException` (`@kitchensink/nest-error-envelope`), and any other throwable collapses to a
 *    generic 500 that never leaks internal detail.
 *
 * ⚠️ THE NORMALIZATION USED TO BE HAND-WRITTEN HERE, AND THIS COPY WAS THE WEAK ONE. It had no branch for a body
 * that ALREADY NAMES its code, so it derived one from the status instead — which meant
 * `HealthController.getReadiness`, which raises
 * `new ServiceUnavailableException({ code: 'NOT_READY', message: 'Database not reachable' })`, published
 * `SERVICE_UNAVAILABLE` while `contract/openapi.ts` documented that `503` as `NOT_READY`. The published document
 * described a code the service never sent. It also dropped body extras instead of lifting them into `details`, and
 * had no empty-message fallback. All three are properties of the shared module now, so identity cannot be the copy
 * that is behind again. Regression pinned in `tests/apiException.filter.test.ts`.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    public catch(exception: unknown, host: ArgumentsHost): void {
        if (shouldCaptureException(exception)) {
            Sentry.captureException(exception);
        }

        const response = host.switchToHttp().getResponse<Response>();

        if (exception instanceof HttpException) {
            const { status, body } = normalizeHttpException(exception, VOCABULARY);

            // No `satisfies ApiErrorBody` here: that type is `.loose()`, so it carries an index signature the
            // mechanism's tighter envelope does not have. The two shapes are asserted equivalent in
            // `packages/infra/global/__tests__/errorEnvelopeParity.test.ts`, which parses a mechanism envelope
            // with every service's PUBLISHED `apiErrorSchema` — a stronger check than a structural annotation.
            response.status(status).json(body);

            return;
        }

        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            code: INTERNAL_ERROR_CODE,
            // ⚠️ The message is a CONSTANT, never the throwable's. An unexpected `Error`'s message is the one
            // place a stack fragment, a connection string or a row's contents can reach a caller.
            message: 'Internal server error',
        } satisfies ApiErrorBody);
    }
}

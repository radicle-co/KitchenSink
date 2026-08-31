import { Catch, HttpException, HttpStatus, Optional, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { normalizeHttpException } from '@kitchensink/nest-error-envelope';
import type { ApiErrorEnvelope, EnvelopeVocabulary, NormalizedFailure } from '@kitchensink/nest-error-envelope';
import type { Request, Response } from 'express';

import {
    isCandidateMismatchError,
    isFetchUnavailableError,
    isSearchQueryTooShortError,
    isSourceUnavailableError,
    isDuplicateAuthoredNameError,
    isFoodNotFoundError,
    isFoodPendingError,
    isNotEditableError,
    isNotFoodAuthorError,
    isNotResolvableError,
} from '../../foods/foods.errors.js';
import { foodErrorCodeSchema, type FoodErrorCode } from '../../foods/foods.schema.js';
import { ConsoleWorkerLogger } from '../../worker/ConsoleWorkerLogger.js';
import { type LogContext, type WorkerLogger } from '../../worker/workerLogger.js';
import { FOOD_ERROR_STATUS, FOOD_STATUS_CODE } from '../apiError.js';

/**
 * The published failure codes, by name. AUTHORED in `../../foods/foods.schema.ts` (`foodErrorCodeSchema`) and
 * published to every consumer through `@kitchensink/schema-food`, so the code this filter writes and the code a
 * client branches on are ONE definition. It was a TS `enum` local to this file until 2026-08-12, which meant the
 * discriminant a consumer needed most was the one thing the contract did not publish.
 */
const CODE = foodErrorCodeSchema.enum;

/**
 * This service's published code vocabulary, handed to the shared normalization.
 *
 * ⚠️ THE NORMALIZATION ITSELF NO LONGER LIVES IN THIS FILE. `describeIssue`, `asValidationEnvelope`,
 * `asExplicitEnvelope`, `describeBody`, `FRAMEWORK_KEYS` and `UNSPECIFIED_MESSAGE` were ~100 lines that were, line
 * for line, recipe's — and identity's third variant of the same idea was MISSING the explicit-code branch, which
 * made its readiness `503` publish `SERVICE_UNAVAILABLE` where its own OpenAPI document promised `NOT_READY`. The
 * mechanism is now `@kitchensink/nest-error-envelope`; what stays here is what ADR-0014 requires to stay: this
 * service's own codes, its own status table, its domain-error branch, its `Retry-After` derivation and its logging.
 */
const VOCABULARY: EnvelopeVocabulary = {
    validationFailedCode: CODE.VALIDATION_FAILED,
    statusCode: FOOD_STATUS_CODE,
};

/**
 * An {@link ApiErrorEnvelope} whose `code` is one of the PUBLISHED codes.
 *
 * Written as an intersection rather than a fresh interface on purpose: it stays THE authored envelope type — so a
 * change to `apiError.schema.ts` still reaches this file — while narrowing `code` enough that
 * {@link FOOD_ERROR_STATUS}, which is exhaustive over exactly those codes, can be indexed with it without a cast.
 */
type ClassifiedEnvelope = ApiErrorEnvelope & { readonly code: FoodErrorCode };

/**
 * Classify a thrown value as one of the food domain errors, or `undefined` when it is not one.
 *
 * Every `foods.errors` type is handled here and the type guards keep this in lockstep with that module. The
 * status is NOT decided here: it comes from {@link FOOD_ERROR_STATUS}, the one table `apiError` also reads, so
 * a domain error and a deliberately-raised code cannot disagree about what a `CANDIDATE_MISMATCH` answers with.
 *
 * `details.id` is on every by-id code because `FoodsController` used to put it in its own `{ error, id, status }`
 * body. Converging the envelope had to preserve the information, not just the status.
 *
 * @param exception - The thrown value.
 * @returns The envelope to publish, or `undefined` when this is not a food domain error. Pure.
 */
function classifyFoodError(exception: unknown): ClassifiedEnvelope | undefined {
    if (isFoodPendingError(exception)) {
        const details: Record<string, unknown> = { id: exception.id, status: exception.status };

        if (exception.estimatedWaitSeconds !== undefined) {
            details['estimatedWaitSeconds'] = exception.estimatedWaitSeconds;
        }

        return { code: CODE.FOOD_PENDING, message: exception.message, details };
    }

    if (isFoodNotFoundError(exception)) {
        const details: Record<string, unknown> =
            exception.status === undefined ? { id: exception.id } : { id: exception.id, status: exception.status };

        return { code: CODE.FOOD_NOT_FOUND, message: exception.message, details };
    }

    if (isCandidateMismatchError(exception)) {
        return { code: CODE.CANDIDATE_MISMATCH, message: exception.message, details: { id: exception.id } };
    }

    if (isNotResolvableError(exception)) {
        return {
            code: CODE.NOT_RESOLVABLE,
            message: exception.message,
            details: { id: exception.id, status: exception.status },
        };
    }

    if (isFetchUnavailableError(exception)) {
        return {
            code: CODE.FETCH_UNAVAILABLE,
            message: exception.message,
            details: { retryAfterSeconds: exception.retryAfterSeconds },
        };
    }

    if (isSearchQueryTooShortError(exception)) {
        // Rendered in the `VALIDATION_FAILED` field shape every other boundary rejection uses, so a client
        // handles it with the code it already handles rather than learning a fourth failure for one route.
        return {
            code: CODE.VALIDATION_FAILED,
            message: exception.message,
            details: { fields: [`query: at least ${exception.minimum} characters`] },
        };
    }

    if (isNotEditableError(exception)) {
        return { code: CODE.NOT_EDITABLE, message: exception.message, details: { id: exception.id } };
    }

    if (isDuplicateAuthoredNameError(exception)) {
        return {
            code: CODE.DUPLICATE_AUTHORED_NAME,
            message: exception.message,
            details: { existingId: exception.existingId },
        };
    }

    if (isNotFoodAuthorError(exception)) {
        return { code: CODE.FORBIDDEN, message: exception.message };
    }

    if (isSourceUnavailableError(exception)) {
        // ⛔ NOT `FETCH_UNAVAILABLE`. That code means OUR budget said no and carries a `Retry-After`; this
        // one means the upstream source did not answer, and we know nothing about when it will. The picker
        // renders them as two different sentences, so collapsing them here would strand a cook.
        // The failing source stays out of the body (FR-ADP-1) — it is on the log line instead.
        return { code: CODE.SOURCE_UNAVAILABLE, message: exception.message };
    }

    return undefined;
}

/*
 * What the filter decided to put on the wire is the shared `NormalizedFailure` — `{ status, body }`, where `body` is
 * the mechanism's envelope. It used to be a local `Resolution` interface over the authored `ApiErrorBody`; the
 * shared type is what lets the domain arm and the `HttpException` arm return one shape without a cast, and it is
 * TIGHTER: `ApiErrorBody` is `.loose()`, so it carries an index signature and would accept any stray top-level key
 * here — the exact thing `asExplicitEnvelope` rebuilds the envelope to prevent. The two are asserted equivalent in
 * `packages/infra/global/__tests__/errorEnvelopeParity.test.ts`.
 */

/**
 * The `Retry-After` seconds a resolution implies, read from the body it is already publishing.
 *
 * Derived from `details.retryAfterSeconds` rather than tracked alongside it, so the header and the body cannot
 * disagree — and so a `FETCH_UNAVAILABLE` raised through `apiError` (rather than as the domain error) still
 * gets the header a `503` is useless without.
 *
 * @param body - The envelope being published.
 * @returns The seconds, or `undefined` when this failure carries no retry advice. Pure.
 */
function retryAfterSecondsFor(body: ApiErrorEnvelope): number | undefined {
    if (body.code !== CODE.FETCH_UNAVAILABLE) {
        return undefined;
    }

    const seconds = body.details?.['retryAfterSeconds'];

    return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Decide the wire response for a thrown value. Pure — the whole status/body mapping in one place, so the
 * filter itself only has to execute it (and log it) once.
 *
 * ⛔ THERE IS NO PASSTHROUGH BRANCH, AND THAT IS THE POINT. Returning `exception.getResponse()` unchanged is what
 * put THREE error shapes on this service's wire: the envelope, Nest's `{ statusCode, message, error }`, and the
 * controller's `{ error, …extras }`. Because the guarantee now lives here rather than at each throw site, it also
 * covers exceptions this service does not raise — the auth guard's string-bodied `401`s, Nest's `404` for an
 * unrouted path, the body parser's `413` — none of which any amount of controller discipline would have reached.
 * Do not reintroduce a "pass it through if it looks fine" shortcut: "looks fine" is what the three shapes were.
 *
 * @param exception - The thrown value.
 * @returns The status and the envelope to surface.
 */
function resolve(exception: unknown): NormalizedFailure {
    const classified = classifyFoodError(exception);

    if (classified) {
        return { status: FOOD_ERROR_STATUS[classified.code], body: classified };
    }

    if (exception instanceof HttpException) {
        return normalizeHttpException(exception, VOCABULARY);
    }

    return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: { code: CODE.INTERNAL_ERROR, message: 'Internal server error' },
    };
}

/** The event name every failed-request record carries (one name, so a log query needs one term). */
const FAILURE_EVENT = 'api-request-failed';

/** The component tag on the API's structured records (the worker uses its own). */
const LOG_COMPONENT = 'food-api';

/**
 * The last-resort tripwire line, used only when the log sink itself throws. A pre-built constant with no
 * interpolation, because a fallback that can fail is not a fallback — but staying SILENT here would
 * re-create the very defect this module was changed to fix.
 */
const LOG_FAILURE_LINE = JSON.stringify({
    level: 'error',
    component: LOG_COMPONENT,
    message: 'api-error-log-failed',
});

/**
 * Severity for a response status, or `undefined` when the outcome does not deserve a line at all. Pure.
 *
 * `>= 500` is a server fault (an operator must see it); `>= 400` is expected client-side control flow
 * (visible at `warn`, no stack); anything lower is a SUCCESSFUL outcome that merely travels as an
 * exception — notably the 202 `FOOD_PENDING` raised on the first read of every newly-requested food.
 * Logging those would bury the failures this policy exists to surface, and bill for the privilege.
 *
 * @param status - The HTTP status being returned.
 * @returns The log level, or `undefined` to log nothing.
 */
function logLevelForStatus(status: number): 'error' | 'warn' | undefined {
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        return 'error';
    }

    return status >= HttpStatus.BAD_REQUEST ? 'warn' : undefined;
}

/**
 * The throwable's identity, for the log record only. A non-`Error` gets the `NonError` name and no stack.
 *
 * @param exception - The thrown value.
 * @returns The name, message, and stack (when there is one).
 */
function describeThrowable(exception: unknown): { errorName: string; errorMessage: string; stack?: string } {
    if (exception instanceof Error) {
        const described = { errorName: exception.name, errorMessage: exception.message };

        return typeof exception.stack === 'string' ? { ...described, stack: exception.stack } : described;
    }

    return { errorName: 'NonError', errorMessage: String(exception) };
}

/**
 * The request facts that are safe to write to stdout. Pure.
 *
 * Deliberately NARROW: the method, the path with any query string removed, and a correlation id read from
 * the same headers the identity service correlates on (`x-request-id`, else the ALB's `x-amzn-trace-id`).
 * The body, the headers, and the query string are all caller-supplied and stay off the log — the query
 * string in particular carries `?query=` search text and is exactly where a leaked `api_key` would sit.
 *
 * @param request - The Express request, or `undefined` for a non-HTTP host.
 * @returns The loggable request context.
 */
function requestFacts(request: Request | undefined): LogContext {
    if (request === undefined) {
        return {};
    }

    const target = request.originalUrl ?? request.url ?? '';
    const facts: LogContext = { method: request.method, path: target.split('?')[0] };
    const requestId = request.headers['x-request-id'] ?? request.headers['x-amzn-trace-id'];

    return typeof requestId === 'string' ? { ...facts, requestId } : facts;
}

/**
 * Global exception filter for the food service (registered as an `APP_FILTER` provider).
 *
 * **IT IS THE SINGLE AUTHOR OF EVERY ERROR BODY THIS SERVICE EMITS.** A thrown food domain error becomes the
 * `{ code, message, details? }` envelope at the status {@link FOOD_ERROR_STATUS} assigns it; ANY
 * {@link HttpException} — whoever raised it, whatever body it carries — is normalized into that same envelope;
 * and every other throwable collapses to a generic 500 that leaks no internal detail. Making that a property of
 * this class rather than of every throw site is what let three published error shapes become one (see
 * {@link resolve}).
 *
 * **It also LOGS the failure (T-151), which it previously did not.** An unclassified throwable used to
 * return a 500 and leave no trace anywhere: no line on the container's stdout, and — since the food API
 * carries no Sentry SDK and its ECS log group has no drain subscription — nowhere else either. A real
 * `TypeError` behind a 500 was locatable only by patching a temporary debug log into this file. The
 * classified 503 and the `HttpException` passthrough had the identical hole for their own 5xx.
 *
 * Pattern: the status/body decision is a pure {@link resolve} mapping, the severity a pure
 * {@link logLevelForStatus} policy, and the record goes through the service's ONE structured-logging port
 * ({@link WorkerLogger}) — a JSON line per record, which is what the deployed task's stdout already speaks.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    /**
     * @param logger - The structured-logging sink. Defaults to a JSON line on stdout; `@Optional()` so
     *   Nest's `useClass` registration constructs it with no provider for the (interface) port, while a
     *   test can inject a recorder. `ConsoleWorkerLogger` resolves `console` per call, so an interception
     *   installed later in the process still sees these lines (the `emfMetrics.ts` `writeLine` lesson).
     */
    public constructor(@Optional() private readonly logger: WorkerLogger = new ConsoleWorkerLogger(LOG_COMPONENT)) {}

    /** @inheritdoc @sideEffect Writes the HTTP response and emits one structured log record. */
    public catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const resolution = resolve(exception);

        this.record(exception, resolution, http.getRequest<Request | undefined>());

        const response = http.getResponse<Response>();
        const retryAfterSeconds = retryAfterSecondsFor(resolution.body);

        if (retryAfterSeconds !== undefined) {
            response.setHeader('Retry-After', String(retryAfterSeconds));
        }

        response.status(resolution.status).json(resolution.body);
    }

    /**
     * Emit the one structured record for this failure, at the severity its status earns.
     *
     * Best-effort BY DESIGN: a throw from here would escape `catch()` and turn a clean 500 into a dead
     * socket, so a sink failure degrades to {@link LOG_FAILURE_LINE} rather than propagating — and is
     * never swallowed silently.
     *
     * @param exception - The thrown value.
     * @param resolution - What is going on the wire.
     * @param request - The Express request, when the host is HTTP.
     * @sideEffect Writes to the log sink (stdout in production).
     */
    private record(exception: unknown, resolution: NormalizedFailure, request: Request | undefined): void {
        const level = logLevelForStatus(resolution.status);

        if (level === undefined) {
            return;
        }

        try {
            const described = describeThrowable(exception);
            const context: LogContext = {
                status: resolution.status,
                // Always present now: every resolution carries a code, including the status-derived one for a
                // framework failure. A log query can therefore group by `code` without a missing-field arm.
                code: resolution.body.code,
                ...requestFacts(request),
                errorName: described.errorName,
                errorMessage: described.errorMessage,
                // A 4xx is expected control flow — its stack is noise, and every one of them would pay
                // for a multi-kilobyte log line that tells an operator nothing.
                ...(level === 'error' && described.stack !== undefined ? { stack: described.stack } : {}),
            };

            this.logger[level](FAILURE_EVENT, context);
        } catch {
            console.error(LOG_FAILURE_LINE);
        }
    }
}

import { Catch, HttpException, HttpStatus, Optional, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
    isCandidateMismatchError,
    isFetchUnavailableError,
    isFoodNotFoundError,
    isFoodPendingError,
    isNotResolvableError,
} from '../../foods/foods.errors.js';
import { ConsoleWorkerLogger, type LogContext, type WorkerLogger } from '../../worker/worker-logger.js';
import type { ApiErrorBody } from '../api-error.schema.js';

/**
 * Machine-readable error codes surfaced to `/api/v1/foods/*` clients. One code per food domain error, so a
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
    /** A request body/query the globally bound `ZodValidationPipe` rejected — always a 400. */
    VALIDATION_FAILED = 'VALIDATION_FAILED',
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
    [FoodErrorCode.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
};

/**
 * Render ONE zod issue as a human-readable constraint, prefixed with the field it failed on. Pure.
 *
 * A zod issue's `message` is the CONSTRAINT alone (`Too small: expected string to have >=1 characters`), so
 * without the path a caller is told something is wrong but not what. An issue whose `path` is empty describes
 * the object itself — `z.strictObject`'s `unrecognized_keys` is exactly that — and is rendered bare rather than
 * with an empty `': '` prefix. A path segment may be a symbol in zod v4, hence the string/number filter.
 *
 * @param issue - One entry of the validation exception's `errors` array.
 * @returns `"<field path>: <message>"`, the bare message for a path-less issue, or `undefined` when the entry
 *   is not renderable (so an unrecognised shape degrades to the envelope's own message).
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
 * Translate a `nestjs-zod` validation rejection into the ARCH-PS-2 envelope, or `undefined` when the body is
 * not one.
 *
 * WHY THIS EXISTS. `ZodValidationPipe` throws a `ZodValidationException` whose response body is
 * `{ statusCode, message: 'Validation failed', errors: [...issues] }`. This filter passes an `HttpException`'s
 * body through UNCHANGED, so binding the pipe without this branch would have put a FOURTH error shape on the
 * wire — one that matches none of the three `errorResponseSchema` documents, and whose fixed `message` string
 * discards both the field names and the issues. Normalizing here means the pipe's arrival adds no new shape:
 * a rejection is `{ code: 'VALIDATION_FAILED', message, details.fields }`, which is `apiErrorSchema`, the
 * envelope identity and recipe already emit.
 *
 * The `errors` key is matched STRUCTURALLY rather than with `instanceof ZodValidationException`: the input here
 * is the serialized response body, and a duck-typed match cannot be defeated by a duplicated `nestjs-zod`
 * install. That the pipe really does put its issues there is pinned by a test that drives the REAL pipe.
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
    // `message` — fall through and let the body pass as it did before.
    if (fields.length === 0) {
        return undefined;
    }

    return { code: FoodErrorCode.VALIDATION_FAILED, message: fields.join(', '), details: { fields } };
}

// The envelope is AUTHORED as zod in `../api-error.schema.ts` and published via `@kitchensink/schema-food`
// (CODING_STANDARDS §15.2), so the shape this filter writes and the shape clients parse are ONE definition
// rather than two hand-written interfaces on either side of the wire. Re-exported here because this module is
// where every existing import site expects to find it.
export type { ApiErrorBody } from '../api-error.schema.js';

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

/** What the filter decided to put on the wire: the status, the body, and the food code when there is one. */
interface Resolution {
    status: number;
    body: unknown;
    code?: FoodErrorCode;
    retryAfterSeconds?: number;
}

/**
 * Decide the wire response for a thrown value. Pure — the whole status/body mapping in one place, so the
 * filter itself only has to execute it (and log it) once.
 *
 * @param exception - The thrown value.
 * @returns The status, body, and food code to surface.
 */
function resolve(exception: unknown): Resolution {
    const classified = classifyFoodError(exception);

    if (classified) {
        const body: ApiErrorBody = { code: classified.code, message: (exception as Error).message };

        if (classified.details !== undefined) {
            body.details = classified.details;
        }

        const resolution: Resolution = { status: FOOD_ERROR_STATUS[classified.code], body, code: classified.code };

        return classified.retryAfterSeconds === undefined
            ? resolution
            : { ...resolution, retryAfterSeconds: classified.retryAfterSeconds };
    }

    if (exception instanceof HttpException) {
        const body = exception.getResponse();
        const validation = asValidationEnvelope(body);

        // A pipe rejection becomes the shared envelope; every other `HttpException` body still passes through
        // unchanged, so the controller's FR-051 mapping and the auth guard's `401`s are untouched.
        return validation === undefined
            ? { status: exception.getStatus(), body }
            : { status: exception.getStatus(), body: validation, code: FoodErrorCode.VALIDATION_FAILED };
    }

    return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: { code: FoodErrorCode.INTERNAL_ERROR, message: 'Internal server error' } satisfies ApiErrorBody,
        code: FoodErrorCode.INTERNAL_ERROR,
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
 * Global exception filter for the food service (registered as an `APP_FILTER` provider). Mirrors the
 * recipe service's filter: it translates thrown food domain errors into their mapped HTTP status with a
 * structured `{ code, message, details? }` body (setting `Retry-After` for `FetchUnavailableError`),
 * passes framework {@link HttpException}s (validation/auth/the controller's FR-051 mapping) through
 * untouched, and collapses every other throwable to a generic 500 that never leaks internal detail.
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
     *   installed later in the process still sees these lines (the `emf-metrics.ts` `writeLine` lesson).
     */
    public constructor(@Optional() private readonly logger: WorkerLogger = new ConsoleWorkerLogger(LOG_COMPONENT)) {}

    /** @inheritdoc @sideEffect Writes the HTTP response and emits one structured log record. */
    public catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const resolution = resolve(exception);

        this.record(exception, resolution, http.getRequest<Request | undefined>());

        const response = http.getResponse<Response>();

        if (resolution.retryAfterSeconds !== undefined) {
            response.setHeader('Retry-After', String(resolution.retryAfterSeconds));
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
    private record(exception: unknown, resolution: Resolution, request: Request | undefined): void {
        const level = logLevelForStatus(resolution.status);

        if (level === undefined) {
            return;
        }

        try {
            const described = describeThrowable(exception);
            const context: LogContext = {
                status: resolution.status,
                ...(resolution.code === undefined ? {} : { code: resolution.code }),
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

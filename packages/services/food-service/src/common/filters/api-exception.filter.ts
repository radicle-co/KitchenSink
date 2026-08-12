import { Catch, HttpException, HttpStatus, Optional, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
    isCandidateMismatchError,
    isFetchUnavailableError,
    isFoodNotFoundError,
    isFoodPendingError,
    isNotResolvableError,
} from '../../foods/foods.errors.js';
import { foodErrorCodeSchema, type FoodErrorCode } from '../../foods/foods.schema.js';
import { ConsoleWorkerLogger, type LogContext, type WorkerLogger } from '../../worker/worker-logger.js';
import { codeForStatus, FOOD_ERROR_STATUS } from '../api-error.js';
import type { ApiErrorBody } from '../api-error.schema.js';

/**
 * The published failure codes, by name. AUTHORED in `../../foods/foods.schema.ts` (`foodErrorCodeSchema`) and
 * published to every consumer through `@kitchensink/schema-food`, so the code this filter writes and the code a
 * client branches on are ONE definition. It was a TS `enum` local to this file until 2026-08-12, which meant the
 * discriminant a consumer needed most was the one thing the contract did not publish.
 */
const CODE = foodErrorCodeSchema.enum;

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
 * `{ statusCode, message: 'Validation failed', errors: [...issues] }` — a fixed `message` that discards both the
 * field names and the issues. Without this branch the generic normalization below would faithfully publish that
 * useless string, telling a caller their request was invalid and nothing about which part.
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
    // `message` — fall through to the generic normalization instead.
    if (fields.length === 0) {
        return undefined;
    }

    return { code: CODE.VALIDATION_FAILED, message: fields.join(', '), details: { fields } };
}

/** Body keys the framework owns; never lifted into `details`, because they duplicate the envelope. */
const FRAMEWORK_KEYS = new Set(['statusCode', 'message', 'error', 'code', 'details', 'errors']);

/** Last-resort `message` when neither the body nor the exception offers a non-empty one. */
const UNSPECIFIED_MESSAGE = 'Request failed';

/**
 * A body that is ALREADY the envelope, taken verbatim. `undefined` when it is not one.
 *
 * This branch is what keeps a deliberate code from being overwritten by a status-derived one — the case that
 * matters is `IDENTITY_SYNC_PENDING` versus a plain `UNAUTHORIZED`: both are `401`s, they need different
 * handling ("retry with a refreshed token" versus "sign in"), and a status-keyed derivation flattens them into
 * one. It also means {@link apiError}'s output passes through untransformed.
 *
 * The envelope is REBUILT from the recognised keys rather than spread: a body of `{ code, message, id }` must not
 * publish a stray top-level `id`, because "extras live in `details`" is the property the one-shape contract rests
 * on. Dropping it here is what makes the omission visible in a test rather than on the wire.
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
    const message = typeof raw === 'string' && raw.length > 0 ? raw : fallbackMessage;
    const details = record['details'];

    return details !== null && typeof details === 'object' && !Array.isArray(details)
        ? {
              code,
              message: message.length > 0 ? message : UNSPECIFIED_MESSAGE,
              details: details as Record<string, unknown>,
          }
        : { code, message: message.length > 0 ? message : UNSPECIFIED_MESSAGE };
}

/**
 * The best available `message` for a framework body, plus any caller-relevant extras lifted into `details`.
 *
 * Handles every body shape Nest can hand us, and the legacy controller shape it used to pass through:
 *
 *  - a bare STRING (`new HttpException('teapot', 418)`, and every `new UnauthorizedException('…')`);
 *  - `{ statusCode, message, error }` — Nest's own object body;
 *  - `{ message: [...] }` — the array form Nest builds for a multi-constraint rejection;
 *  - `{ error: 'A label', …extras }` — the pre-convergence controller payload. `error` is used only when there
 *    is no `message`, because in Nest's own body `error` is the STATUS TEXT (`'Unauthorized'`) and publishing
 *    that as the message would be strictly less informative than what is beside it;
 *  - anything else (a number, an array) — falls back to `exception.message`, which Nest always populates.
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

    // A `message` array is Nest's per-field rejection shape, so it is published as `details.fields` — the same
    // key the zod path uses, so a client reads one place regardless of which validator rejected it.
    if (Array.isArray(rawMessage)) {
        return { message: resolved, details: { ...extras, fields: rawMessage } };
    }

    return Object.keys(extras).length === 0 ? { message: resolved } : { message: resolved, details: extras };
}

// The envelope is AUTHORED as zod in `../api-error.schema.ts` and published via `@kitchensink/schema-food`
// (CODING_STANDARDS §15.2), so the shape this filter writes and the shape clients parse are ONE definition
// rather than two hand-written interfaces on either side of the wire. Re-exported here because this module is
// where every existing import site expects to find it.
export type { ApiErrorBody } from '../api-error.schema.js';

/**
 * An {@link ApiErrorBody} whose `code` is one of the PUBLISHED codes.
 *
 * Written as an intersection rather than a fresh interface on purpose: it stays THE authored envelope type — so a
 * change to `api-error.schema.ts` still reaches this file — while narrowing `code` enough that
 * {@link FOOD_ERROR_STATUS}, which is exhaustive over exactly those codes, can be indexed with it without a cast.
 */
type ClassifiedEnvelope = ApiErrorBody & { readonly code: FoodErrorCode };

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

    return undefined;
}

/** What the filter decided to put on the wire: the status and the envelope (whose `code` drives logging). */
interface Resolution {
    status: number;
    body: ApiErrorBody;
}

/**
 * The `Retry-After` seconds a resolution implies, read from the body it is already publishing.
 *
 * Derived from `details.retryAfterSeconds` rather than tracked alongside it, so the header and the body cannot
 * disagree — and so a `FETCH_UNAVAILABLE` raised through {@link apiError} (rather than as the domain error) still
 * gets the header a `503` is useless without.
 *
 * @param body - The envelope being published.
 * @returns The seconds, or `undefined` when this failure carries no retry advice. Pure.
 */
function retryAfterSecondsFor(body: ApiErrorBody): number | undefined {
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
function resolve(exception: unknown): Resolution {
    const classified = classifyFoodError(exception);

    if (classified) {
        return { status: FOOD_ERROR_STATUS[classified.code], body: classified };
    }

    if (exception instanceof HttpException) {
        const status = exception.getStatus();
        const body = exception.getResponse();
        const envelope = asExplicitEnvelope(body, exception.message) ?? asValidationEnvelope(body);

        if (envelope !== undefined) {
            return { status, body: envelope };
        }

        const { message, details } = describeBody(body, exception.message);
        const code = codeForStatus(status);

        return { status, body: details === undefined ? { code, message } : { code, message, details } };
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
     *   installed later in the process still sees these lines (the `emf-metrics.ts` `writeLine` lesson).
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
    private record(exception: unknown, resolution: Resolution, request: Request | undefined): void {
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

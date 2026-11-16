/**
 * THE BODY PARSER'S REFUSALS ARE THE CALLER'S `4xx`, not a server fault.
 *
 * `body-parser` refuses a request body with an `http-errors` object (`type: 'entity.too.large'`, `'entity.parse.failed'`,
 * `'encoding.unsupported'`, `'charset.unsupported'`, and raw-body's `'request.size.invalid'` and `'request.aborted'`), which is NOT a Nest
 * `HttpException`, so `normalizeHttpException` never sees it and a filter's `500` fallback answered it.
 *
 * ⛔ THE THROWN OBJECT CARRIES THE REQUEST TEXT: `entity.parse.failed` has the raw body as its `body` property, and its
 * `message` (a `SyntaxError`'s) quotes the characters around the error. Every published message here is a CONSTANT,
 * and a filter that gets a failure from this link answers at `warn` with the code only (a `4xx` is never a Sentry issue).
 *
 * ⛔ THE FILTER ONLY SEES WHAT NEST HANDS ON UNCHANGED. Nest's own body parser routes a parse failure through
 * `mapExternalException`, which rewrites any `SyntaxError` into a `BadRequestException` carrying the parser's message,
 * so the normaliser never sees it and that message is published. A service that serves a JSON body therefore creates
 * its app with `bodyParser: false`, registers its own parser, and registers {@link stripBodyParserRefusal} directly
 * after it, so each refusal reaches Nest's handler as `{ type, status, expose }`.
 *
 * A filter that serves a body-parsing route consults the normaliser before its `500` fallback, so the rule lives once
 * rather than once per filter.
 *
 * @pattern Chain of Responsibility — one link of a service filter's resolve chain, and one link of the Express chain
 * @module
 */
import { HttpStatus } from '@nestjs/common';

import { codeForStatus, type EnvelopeVocabulary, type NormalizedFailure } from './envelope.js';

/** The published `message` for an oversized body: a CONSTANT, never the parser's text. */
export const BODY_TOO_LARGE_MESSAGE = 'The request body is too large.';
/** The published `message` for a body that is not the JSON it declared: a CONSTANT, never the parser's text. */
export const BODY_NOT_PARSEABLE_MESSAGE = 'The request body is not valid JSON.';
/** The published `message` for a body in an encoding or charset the parser does not read: a CONSTANT. */
export const BODY_ENCODING_UNSUPPORTED_MESSAGE = 'The request body uses an encoding that is not supported.';

/** The published `message` for a body whose length does not match its `content-length`: a CONSTANT. */
export const BODY_LENGTH_MISMATCH_MESSAGE = 'The request body does not match its declared length.';

/** The published `message` for a body the client stopped sending: a CONSTANT. */
export const BODY_INCOMPLETE_MESSAGE = 'The request body was not received in full.';

/** What each parser `type` this link claims answers with. Read through `Object.hasOwn`: a `type` of `constructor` is not one. */
const PARSER_FAILURES: Readonly<
    Record<string, { readonly status: number; readonly message: string; readonly validation: boolean }>
> = {
    'entity.too.large': { status: HttpStatus.PAYLOAD_TOO_LARGE, message: BODY_TOO_LARGE_MESSAGE, validation: false },
    'entity.parse.failed': { status: HttpStatus.BAD_REQUEST, message: BODY_NOT_PARSEABLE_MESSAGE, validation: true },
    'encoding.unsupported': {
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        message: BODY_ENCODING_UNSUPPORTED_MESSAGE,
        validation: false,
    },
    'charset.unsupported': {
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        message: BODY_ENCODING_UNSUPPORTED_MESSAGE,
        validation: false,
    },
    'request.size.invalid': {
        status: HttpStatus.BAD_REQUEST,
        message: BODY_LENGTH_MISMATCH_MESSAGE,
        validation: false,
    },
    'request.aborted': { status: HttpStatus.BAD_REQUEST, message: BODY_INCOMPLETE_MESSAGE, validation: false },
};

/** Whether `type` is one this module claims. `Object.hasOwn`: a `type` of `constructor` is not one. Pure. */
function isClaimedType(type: unknown): type is string {
    return typeof type === 'string' && Object.hasOwn(PARSER_FAILURES, type);
}

/**
 * The Express error link a service registers directly after its JSON parser. A refusal {@link normalizeBodyParserError}
 * claims travels on as `{ type, status, expose }` only, so neither its `body` (the request text) nor its `message`
 * (which quotes it) can reach the envelope or the log. Any other error travels on as the same object with any `body`
 * property removed, because a filter logs a `5xx` whole.
 *
 * @param error - What the parser passed to `next`.
 * @param _request - Unused (Express passes the request).
 * @param _response - Unused (Express passes the response).
 * @param next - The next link (Nest's error handler).
 * @sideEffect Deletes `body` from an unclaimed error, and calls `next`.
 */
export function stripBodyParserRefusal(
    error: unknown,
    _request: unknown,
    _response: unknown,
    next: (error: unknown) => void,
): void {
    if (typeof error !== 'object' || error === null) {
        next(error);

        return;
    }

    if ('type' in error && isClaimedType(error.type)) {
        next({
            type: error.type,
            status: 'status' in error ? error.status : undefined,
            expose: 'expose' in error ? error.expose : undefined,
        });

        return;
    }

    Reflect.deleteProperty(error, 'body');
    next(error);
}

/**
 * Answer a body-parser refusal as its `4xx`, or `undefined` when the thrown value is not one.
 *
 * Matched on the parser's own `type`, and only when the error is exposed (`expose === true`) with a `4xx` `status`, so an
 * unrelated error that happens to carry a `type` or a `413` is not claimed.
 *
 * @param exception - The thrown value.
 * @param vocabulary - The raising service's published code vocabulary (`validationFailedCode` answers a malformed body).
 * @returns The status and envelope, or `undefined`. Pure.
 */
export function normalizeBodyParserError(
    exception: unknown,
    vocabulary: EnvelopeVocabulary,
): NormalizedFailure | undefined {
    if (typeof exception !== 'object' || exception === null) {
        return undefined;
    }

    const { type, status, expose } = exception as { type?: unknown; status?: unknown; expose?: unknown };
    const failure = isClaimedType(type) ? PARSER_FAILURES[type] : undefined;

    if (failure === undefined || expose !== true || typeof status !== 'number' || status < 400 || status > 499) {
        return undefined;
    }

    return {
        status: failure.status,
        body: {
            code: failure.validation
                ? vocabulary.validationFailedCode
                : codeForStatus(failure.status, vocabulary.statusCode),
            message: failure.message,
        },
    };
}

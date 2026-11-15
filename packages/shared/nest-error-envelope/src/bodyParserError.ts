/**
 * THE BODY PARSER'S REFUSALS ARE THE CALLER'S `4xx`, not a server fault.
 *
 * `body-parser` refuses a request body with an `http-errors` object (`type: 'entity.too.large'`, `'entity.parse.failed'`,
 * `'encoding.unsupported'`, `'charset.unsupported'`), which is NOT a Nest `HttpException`, so `normalizeHttpException`
 * never sees it and a filter's `500` fallback answered it. A client that shrinks a chunk on `413` never saw the status it
 * branches on, and a malformed JSON body was reported to Sentry and logged as a server fault.
 *
 * ⛔ THE THROWN OBJECT CARRIES THE REQUEST TEXT: `entity.parse.failed` has the raw body as its `body` property. A filter
 * must therefore neither log nor capture it. Every published message here is a CONSTANT, and a filter that gets a
 * failure from this link answers at `warn` with the code only (a `4xx` is never a Sentry issue).
 *
 * A filter that serves a body-parsing route consults this before its `500` fallback, so the rule lives once rather than
 * once per filter. (Food's and identity's filters do not consult it yet; they serve no large JSON body.)
 *
 * @pattern Chain of Responsibility — one link of a service filter's resolve chain, consulted before its 500 fallback
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
};

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
    const failure =
        typeof type === 'string' && Object.hasOwn(PARSER_FAILURES, type) ? PARSER_FAILURES[type] : undefined;

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

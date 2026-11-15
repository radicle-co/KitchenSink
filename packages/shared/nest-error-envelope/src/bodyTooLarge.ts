/**
 * THE BODY PARSER'S "TOO LARGE" REFUSAL IS THE CALLER'S `413`, not a server fault.
 *
 * `body-parser` refuses a JSON body over its limit with an `http-errors` object (`type: 'entity.too.large'`), which is
 * NOT a Nest `HttpException`, so `normalizeHttpException` never sees it and a filter's `500` fallback answered it.
 * A client that shrinks a chunk on `413` (the bulk import) never saw the status it branches on.
 *
 * Every service filter consults this before its `500` fallback, so the rule lives once rather than once per filter.
 *
 * @pattern Chain of Responsibility — one link of each service filter's resolve chain, consulted before its 500 fallback
 * @module
 */
import { HttpStatus } from '@nestjs/common';

import { codeForStatus, type EnvelopeVocabulary, type NormalizedFailure } from './envelope.js';

/** The published `message`: a CONSTANT, never the parser's text. */
export const BODY_TOO_LARGE_MESSAGE = 'The request body is too large.';

/**
 * Answer the body parser's oversized-body refusal as `413`, or `undefined` when the thrown value is not one.
 *
 * Matched on the parser's own `type`, not on a bare `status`, so an unrelated error that happens to carry `413` is not
 * claimed.
 *
 * @param exception - The thrown value.
 * @param vocabulary - The raising service's published code vocabulary.
 * @returns The status and envelope, or `undefined`. Pure.
 */
export function normalizeBodyTooLarge(
    exception: unknown,
    vocabulary: EnvelopeVocabulary,
): NormalizedFailure | undefined {
    if (
        typeof exception !== 'object' ||
        exception === null ||
        !('type' in exception) ||
        exception.type !== 'entity.too.large'
    ) {
        return undefined;
    }

    return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        body: {
            code: codeForStatus(HttpStatus.PAYLOAD_TOO_LARGE, vocabulary.statusCode),
            message: BODY_TOO_LARGE_MESSAGE,
        },
    };
}

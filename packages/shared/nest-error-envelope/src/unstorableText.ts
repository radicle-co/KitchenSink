/**
 * TEXT POSTGRESQL CANNOT STORE IS THE CALLER'S ERROR, not a server fault.
 *
 * A PostgreSQL `text` value cannot hold a NUL (U+0000), and a `jsonb` value cannot hold the `\u0000` escape. The
 * server refuses the first with SQLSTATE `22021` (`character_not_in_repertoire`) and the second with `22P05`
 * (`untranslatable_character`) — PostgreSQL Appendix A. A JavaScript string reaches the driver as valid UTF-8 in every
 * other case, so on these services the two codes mean one thing: text in the request carried a NUL.
 * Unmapped, that was a `500` and a Sentry issue any signed-in caller could raise at will.
 *
 * Every service filter consults this before its `500` fallback, so the rule lives once rather than once per filter
 * or once per text field.
 *
 * @pattern Chain of Responsibility — one link of each service filter's resolve chain, consulted before its 500 fallback
 * @module
 */
import { HttpStatus } from '@nestjs/common';

import type { EnvelopeVocabulary, NormalizedFailure } from './envelope.js';

/**
 * The published `message`, and the one `details.fields` entry beside it.
 *
 * ⚠️ A CONSTANT, never the driver's text: a drizzle query error's message is the SQL plus every bound parameter,
 * which is the caller's own text and this service's schema. The entry is path-less because the driver does not
 * say which field held the NUL, and a path-less entry is how `describeIssue` already renders an object-level issue.
 */
export const UNSTORABLE_TEXT_MESSAGE = 'Text in this request contains a NUL character (U+0000), which cannot be stored';

/** The SQLSTATEs PostgreSQL raises for a NUL in a `text` (`22021`) or a `jsonb` (`22P05`) parameter. */
const UNSTORABLE_TEXT_SQLSTATES: ReadonlySet<string> = new Set(['22021', '22P05']);

/**
 * How many `cause` links the search follows. Drizzle wraps the driver error once and a service may wrap that again;
 * the bound keeps a pathological chain from costing more than a handful of property reads.
 */
const MAX_CAUSE_DEPTH = 8;

/**
 * Whether a thrown value, or anything on its `cause` chain, is a PostgreSQL text rejection. Pure.
 *
 * Matched STRUCTURALLY on `code`, as `asValidationEnvelope` matches its body: `pg` throws its `DatabaseError` bare,
 * and drizzle throws a `DrizzleQueryError` holding it as `cause`, and neither class is a dependency of this package.
 *
 * @param exception - The thrown value.
 * @returns `true` when a link carries one of {@link UNSTORABLE_TEXT_SQLSTATES}.
 */
function isUnstorableText(exception: unknown): boolean {
    const seen = new Set<object>();
    let link: unknown = exception;

    while (link !== null && typeof link === 'object' && !seen.has(link) && seen.size < MAX_CAUSE_DEPTH) {
        seen.add(link);
        const code = (link as Record<string, unknown>)['code'];

        if (typeof code === 'string' && UNSTORABLE_TEXT_SQLSTATES.has(code)) {
            return true;
        }

        link = (link as Record<string, unknown>)['cause'];
    }

    return false;
}

/**
 * Answer a PostgreSQL text rejection as the service's own validation failure, or `undefined` when the thrown value
 * is not one.
 *
 * A `400` in the vocabulary's `validationFailedCode`, so a client handles it with the code it already handles. Every
 * filter reports only a `5xx` to Sentry, so this answer raises no issue.
 *
 * @param exception - The thrown value.
 * @param vocabulary - The raising service's published code vocabulary.
 * @returns The status and envelope, or `undefined`. Pure.
 */
export function normalizeUnstorableText(
    exception: unknown,
    vocabulary: EnvelopeVocabulary,
): NormalizedFailure | undefined {
    if (!isUnstorableText(exception)) {
        return undefined;
    }

    return {
        status: HttpStatus.BAD_REQUEST,
        body: {
            code: vocabulary.validationFailedCode,
            message: UNSTORABLE_TEXT_MESSAGE,
            details: { fields: [UNSTORABLE_TEXT_MESSAGE] },
        },
    };
}

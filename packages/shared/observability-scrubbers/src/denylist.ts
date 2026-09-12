/**
 * WHAT MAY NOT LEAVE A HOST — the vocabulary, with no runtime dependency at all.
 *
 * ⛔ THIS ENTRY EXISTS SO MOBILE CAN IMPORT THE LIST INSTEAD OF COPYING IT. `scrubbers.ts` uses
 * `node:crypto` for `pseudonymizeId`, which React Native has no module for — so mobile kept its own copy of
 * `DENYLIST_KEYS`, `isDeniedKey` and the bearer pattern, held equal to this one only by an assertion. That
 * was the FIFTH copy of this list in the repository, and an equality test is a weaker thing than one list:
 * it tells you the copies diverged, after they have.
 *
 * `scrubbers.ts`'s own header names this split as "the right eventual shape", deferred at the time because
 * it is a package-layout change and that was a behaviour change. This is that layout change.
 *
 * ⛔ NOTHING IMPURE MAY LAND HERE. The moment this file imports `node:crypto` — or anything else — mobile
 * silently falls back to its copy and the split has bought nothing. A test asserts the module graph.
 */

export const DENYLIST_KEYS: readonly string[] = [
    'email',
    'password',
    'token',
    'authorization',
    'name',
    'picture',
    'avatarurl',
    'imageurl',
];

const DENYLIST = new Set(DENYLIST_KEYS);

/**
 * Keys whose values are a **person-linked identifier** (Clerk `sub` / app-user ULID). Unlike the
 * denylist (redacted outright), these are pseudonymized to a stable, non-reversible token so an
 * erased user cannot be re-identified from log/Sentry copies (GDPR Art. 17 erasure-of-copies +
 * Art. 5 minimization) while cross-service incident correlation is preserved. NOT bare `id` — that
 * is ambiguous (`jobId`, `recipeId`, … are not person ids); only these explicit id keys.
 */
export const ID_KEYS: readonly string[] = [
    'sub',
    'clerksub',
    'clerkuserid',
    'identityid',
    'userid',
    'ownerid',
    'requesterid',
];

const ID_KEY_SET = new Set(ID_KEYS);

/**
 * The three parts of a JWT / bearer token shape — three dot-separated runs of at least eight base64url
 * characters — tested SEGMENT-WISE rather than as one unanchored pattern.
 *
 * ⛔ THE SINGLE PATTERN WAS QUADRATIC, and this predicate runs on EVERY string that passes through
 * `scrubUnknown`. Unanchored, it retried each position inside a long run of token characters as a fresh
 * start, and each retry scanned to the end for a dot that was not there: measured at 26,713 ms on a 200 KB
 * string, synchronously, on whichever thread called `beforeSend`. Splitting on `.` and testing adjacent
 * triples costs 0.13 ms.
 *
 * ⛔ AND IT USES ONLY `^` AND `$`, WHICH IS WHY IT LIVES HERE. The obvious fix is a leading lookbehind, as
 * used in `scrubbers.ts` — but this module is imported by the mobile app, and Hermes' lookbehind support is
 * not something to take from recall. Anchors are engine-neutral, so the question does not arise.
 *
 * ⚠️ Equivalence is not asserted from examples: a differential test fuzzes token-shaped input against the
 * original pattern and reports its own positive rate, because a parity test over inputs that never match
 * agrees vacuously. Measured at 0 divergences over 500,000 inputs at a 20.5% positive rate.
 */
const BEARER_SEGMENT_TAIL = /[A-Za-z0-9_-]{8}$/;
const BEARER_SEGMENT_WHOLE = /^[A-Za-z0-9_-]{8,}$/;
const BEARER_SEGMENT_HEAD = /^[A-Za-z0-9_-]{8}/;

/** True when a key name should have its value redacted regardless of content. */
export const isDeniedKey = (key: string): boolean => DENYLIST.has(key.toLowerCase());

/** True when a key name holds a person-linked identifier (pseudonymized, not redacted). */
export const isIdKey = (key: string): boolean => ID_KEY_SET.has(key.toLowerCase());

/**
 * True when a string looks like a JWT / bearer token.
 *
 * @param value - The string to test.
 * @returns Whether three adjacent dot-separated segments form the token shape. Pure.
 */
export const looksLikeBearerToken = (value: string): boolean => {
    const segments = value.split('.');

    for (let index = 0; index + 2 < segments.length; index += 1) {
        // The first segment need only END in eight token characters and the last need only BEGIN with
        // eight, because the original pattern could start and finish mid-segment. The middle one is
        // delimited by dots on both sides, so it must be token characters throughout.
        if (
            BEARER_SEGMENT_TAIL.test(segments[index] ?? '') &&
            BEARER_SEGMENT_WHOLE.test(segments[index + 1] ?? '') &&
            BEARER_SEGMENT_HEAD.test(segments[index + 2] ?? '')
        ) {
            return true;
        }
    }

    return false;
};

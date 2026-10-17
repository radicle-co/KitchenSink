/**
 * @module iamPattern — IAM `StringLike` / ARN wildcard matching, as a pure function.
 *
 * IAM's `*` matches any run of characters INCLUDING hyphens and slashes, and `?` matches exactly one. Guards that
 * judge a policy's patterns against real names need exactly that and nothing more: every other character is
 * matched literally, so no regular-expression syntax leaks through from a pattern. Matching is case-sensitive, as
 * IAM's is.
 */

/** Escapes a character for a regular expression unless it is one of IAM's two wildcards. */
const toRegexSource = (pattern: string): string =>
    pattern
        .split('')
        .map((character) => {
            if (character === '*') {
                return '.*';
            }

            if (character === '?') {
                return '.';
            }

            return character.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
        })
        .join('');

/**
 * Whether `value` matches the IAM wildcard `pattern`.
 *
 * @returns True on a full match. Pure.
 */
export function iamLike(pattern: string, value: string): boolean {
    return new RegExp(`^${toRegexSource(pattern)}$`, 'su').test(value);
}

/** Whether `value` matches any of the patterns. Pure. */
export function iamLikeAny(patterns: readonly string[], value: string): boolean {
    return patterns.some((pattern) => iamLike(pattern, value));
}

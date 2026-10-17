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

// Guards judge every action against every resource of every statement, so the same few hundred patterns are matched
// millions of times; compiling each once keeps an exhaustive guard inside the test timeout on a loaded CI runner.
const compiledPatterns = new Map<string, RegExp>();

const compiled = (pattern: string): RegExp => {
    const known = compiledPatterns.get(pattern);

    if (known !== undefined) {
        return known;
    }

    const regex = new RegExp(`^${toRegexSource(pattern)}$`, 'su');

    compiledPatterns.set(pattern, regex);

    return regex;
};

/**
 * Whether `value` matches the IAM wildcard `pattern`.
 *
 * @returns True on a full match. Pure.
 */
export function iamLike(pattern: string, value: string): boolean {
    return compiled(pattern).test(value);
}

/** Whether `value` matches any of the patterns. Pure. */
export function iamLikeAny(patterns: readonly string[], value: string): boolean {
    return patterns.some((pattern) => iamLike(pattern, value));
}

/**
 * Whether two IAM glob patterns can match a common string (`*` is any run, `?` is one character).
 *
 * A role's own policy may name a resource with a wildcard (`stack/kitchensink-*`); what matters is that the boundary
 * leaves some of it reachable, and that a CONCRETE name is inside. For a concrete name this is an exact match.
 */
export function patternsOverlap(left: string, right: string): boolean {
    const memo = new Map<string, boolean>();

    const walk = (i: number, j: number): boolean => {
        const key = `${i}:${j}`;
        const known = memo.get(key);

        if (known !== undefined) {
            return known;
        }

        let result: boolean;

        if (i === left.length && j === right.length) {
            result = true;
        } else if (left[i] === '*') {
            result = walk(i + 1, j) || (j < right.length && walk(i, j + 1));
        } else if (right[j] === '*') {
            result = walk(i, j + 1) || (i < left.length && walk(i + 1, j));
        } else if (i < left.length && j < right.length) {
            result = (left[i] === right[j] || left[i] === '?' || right[j] === '?') && walk(i + 1, j + 1);
        } else {
            result = false;
        }

        memo.set(key, result);

        return result;
    };

    return walk(0, 0);
}

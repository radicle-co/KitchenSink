/**
 * Unit tests for the admin filters' LIKE-pattern construction.
 *
 * The property under test is narrow and total: after {@link containsPattern}, the ONLY unescaped `%` in the
 * result are the two the function itself adds. Everything the caller typed matches literally.
 *
 * Mutation lens — each case reds if the escaping is removed, if a metacharacter is dropped from the set, if
 * the escape is applied twice, or if the surrounding wildcards are lost (which would silently turn every
 * substring filter into an exact-match one).
 */
import { describe, expect, it } from 'vitest';

import { containsPattern, escapeLikeMetacharacters, LIKE_ESCAPE_CHARACTER } from '../like-pattern.js';

describe('escapeLikeMetacharacters', () => {
    it('leaves ordinary text untouched', () => {
        expect(escapeLikeMetacharacters('ada@example.com')).toBe('ada@example.com');
    });

    it.each([
        ['%', '\\%'],
        ['_', '\\_'],
        ['\\', '\\\\'],
    ])('escapes %j as %j', (raw, escaped) => {
        expect(escapeLikeMetacharacters(raw)).toBe(escaped);
    });

    it('escapes EVERY occurrence, not just the first', () => {
        expect(escapeLikeMetacharacters('%_%_')).toBe('\\%\\_\\%\\_');
    });

    it('never double-escapes a backslash the caller typed', () => {
        // The sequential `\` → `%` → `_` implementation is where this bug lives: escaping `%` after `\` would
        // re-escape the backslash just inserted. One left-to-right pass cannot.
        expect(escapeLikeMetacharacters('a\\%b')).toBe('a\\\\\\%b');
    });

    it('does not touch characters that are not LIKE syntax, including SQL-looking ones', () => {
        // A reminder of the actual threat model: this is pattern syntax, not injection. Quotes and semicolons
        // are handled by parameterisation and must NOT be mangled here.
        expect(escapeLikeMetacharacters("o'brien; drop--")).toBe("o'brien; drop--");
    });
});

describe('containsPattern', () => {
    it('wraps the escaped text in the two wildcards that make it a substring match', () => {
        expect(containsPattern('ada')).toBe('%ada%');
    });

    it('turns a bare % from "match every row" into "match a literal percent sign"', () => {
        // The defect, reduced: `%${'%'}%` is `%%%`, which ILIKE matches against every value.
        expect(containsPattern('%')).toBe('%\\%%');
        expect(containsPattern('%')).not.toBe('%%%');
    });

    it('turns ___ from "any three or more characters" into a literal three underscores', () => {
        expect(containsPattern('___')).toBe('%\\_\\_\\_%');
    });

    it('keeps a legitimate underscore in an address searchable as itself', () => {
        expect(containsPattern('a_b@example.com')).toBe('%a\\_b@example.com%');
    });

    it('leaves exactly two unescaped wildcards — the ones it added', () => {
        // The invariant, asserted directly rather than through examples: strip every escaped pair, and what
        // remains must be the leading and trailing `%` and nothing else.
        const pattern = containsPattern('50% off_the_price\\');
        const withoutEscapedPairs = pattern.replace(/\\./gu, '');

        expect(withoutEscapedPairs.match(/[%_]/gu)).toEqual(['%', '%']);
    });

    it('is built for the escape character the pattern actually declares', () => {
        expect(LIKE_ESCAPE_CHARACTER).toBe('\\');
        expect(containsPattern('%').includes(`${LIKE_ESCAPE_CHARACTER}%`)).toBe(true);
    });
});

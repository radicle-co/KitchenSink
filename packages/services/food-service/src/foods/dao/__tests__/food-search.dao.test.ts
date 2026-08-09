/**
 * Unit tests for {@link selectSearchStrategy} — the pure routing decision behind `FoodSearchDao.search`
 * (T-198, SC-007/FR-008/FR-010).
 *
 * The DAO itself is a single SQL read and is covered against a real Postgres in
 * `tests/food-search.dao.integration.test.ts`. What is unit-testable — and what carries the whole
 * correctness burden of the short-query path — is the STRATEGY SELECTION: which of the two statements a
 * query routes to, and the tsquery text handed to `to_tsquery`. Both are pure, so they are tested here
 * with no database.
 *
 * Requirement → test mapping:
 * - SC-007  → a 1–2 character query must NOT reach the `ILIKE '%q%'` statement (it cannot be
 *             index-served below 3 characters — the measured 85–157ms sequential scan).
 * - FR-008  → a query of 3+ characters keeps the existing relevance statement, byte for byte.
 * - FR-010  → the prefix strategy carries the token needed to rank name-initial matches first.
 *
 * Mutation lens: every case below fails if the length threshold moves, if the `:*` prefix marker is
 * dropped, or if the tsquery-metacharacter whitelist is removed (an unsanitised `&`/`:`/`!` makes
 * Postgres' `to_tsquery` raise `syntax error in tsquery`, i.e. a 500 on a keystroke).
 */
import { describe, expect, it } from 'vitest';

import { selectSearchStrategy } from '../food-search.dao.js';

describe('selectSearchStrategy', () => {
    describe('short queries (1–2 characters) route to the word-initial prefix statement', () => {
        it('routes a single character to a prefix tsquery over the stored search vector', () => {
            expect(selectSearchStrategy('c')).toEqual({ kind: 'wordInitialPrefix', tsquery: 'c:*', token: 'c' });
        });

        it('routes two characters to a prefix tsquery', () => {
            expect(selectSearchStrategy('ch')).toEqual({ kind: 'wordInitialPrefix', tsquery: 'ch:*', token: 'ch' });
        });

        it('preserves case in both the tsquery and the token (Postgres folds case on both sides)', () => {
            // The `simple` config lowercases the tsquery token, and the ranking predicate compares
            // `lower(left(name, …))` to `lower(token)`; folding in SQL keeps ONE case-folding authority and
            // avoids a JS/Postgres collation divergence.
            expect(selectSearchStrategy('Ch')).toEqual({ kind: 'wordInitialPrefix', tsquery: 'Ch:*', token: 'Ch' });
        });

        it('keeps digits and non-ASCII letters, which are legitimate query characters', () => {
            expect(selectSearchStrategy('2%')).toEqual({ kind: 'wordInitialPrefix', tsquery: '2:*', token: '2' });
            expect(selectSearchStrategy('ég')).toEqual({ kind: 'wordInitialPrefix', tsquery: 'ég:*', token: 'ég' });
        });

        it('counts CHARACTERS, not UTF-16 code units, when choosing the strategy', () => {
            // '🍎' is two UTF-16 units but one character; it must not be mistaken for a 2-char query. It
            // carries no letter or digit, so nothing searchable survives.
            expect(selectSearchStrategy('🍎')).toEqual({ kind: 'none' });
        });
    });

    describe('tsquery metacharacters are stripped, never interpolated', () => {
        it.each(['&', '|', '!', ':', '(', ')', "'", '<', '*', '\\'])(
            'strips the metacharacter %j rather than handing it to to_tsquery',
            (metacharacter) => {
                expect(selectSearchStrategy(`c${metacharacter}`)).toEqual({
                    kind: 'wordInitialPrefix',
                    tsquery: 'c:*',
                    token: 'c',
                });
            },
        );

        it.each(['&', '::', '!!', '((', '||', "''", '<>', '  ', ''])(
            'yields no strategy for %j, which leaves nothing searchable',
            (query) => {
                expect(selectSearchStrategy(query)).toEqual({ kind: 'none' });
            },
        );
    });

    describe('queries of 3+ characters keep the existing relevance statement', () => {
        // `'&&&'` / `'<->'` route here too, and that is correct: `plainto_tsquery` SANITISES rather than
        // parses, so the relevance statement has always been safe against metacharacters. Only
        // `to_tsquery` on the prefix path needs the whitelist.
        it.each(['abc', 'egg', 'chicken', 'grilled chicken', 'a b', '   ', '&&&', '2%!', '<->'])(
            'routes %j to the relevance strategy, untouched',
            (query) => {
                expect(selectSearchStrategy(query)).toEqual({ kind: 'relevance' });
            },
        );

        it('routes the shortest query pg_trgm can index (3 characters) to relevance, not to prefix', () => {
            // The boundary IS the trigram: `show_trgm('ch')` yields only padded partials, so 2 characters
            // cannot be index-served, while 3 can. Moving this boundary either re-opens the sequential scan
            // (threshold too high) or needlessly narrows working substring search (threshold too low).
            expect(selectSearchStrategy('chi')).toEqual({ kind: 'relevance' });
            expect(selectSearchStrategy('ch')).toMatchObject({ kind: 'wordInitialPrefix' });
        });
    });
});

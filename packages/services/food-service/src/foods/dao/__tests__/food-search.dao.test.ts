/**
 * Unit tests for `FoodSearchDao`'s routing (T-198, SC-007/FR-008/FR-010) — TWO tiers of guard, both
 * database-free and both running on EVERY pull request (the `unit` job in `_ci.yml`):
 *
 *  1. {@link selectSearchStrategy} — the pure routing DECISION: which of the two statements a query
 *     resolves to, and the tsquery text handed to `to_tsquery`.
 *  2. The STATEMENT `FoodSearchDao.search` actually executes, rendered through drizzle's `PgDialect`
 *     exactly as the `pg` driver would receive it. This is the layer that catches a revert: (1) alone
 *     passes if `search` stops honouring the strategy it selected.
 *
 * Requirement → test mapping:
 * - SC-007  → a 1–2 character query must NOT reach the `ILIKE '%q%'` statement (it cannot be
 *             index-served below 3 characters — the measured 85–157ms sequential scan).
 * - FR-008  → a query of 3+ characters keeps the existing relevance statement, byte for byte.
 * - FR-010  → the prefix strategy carries the token needed to rank name-initial matches first, and the
 *             row cap reaches SQL as a `LIMIT`.
 *
 * ## Why the statement TEXT and not the query PLAN
 *
 * SC-007's claim is that a short query is index-served rather than scanned, so the tempting assertion is
 * `EXPLAIN … LIKE '%food_search_vector_idx%'`. That guard was written, measured and deliberately removed —
 * `tests/food-search.dao.integration.test.ts` records the two reproductions (forcing the planner does not
 * discriminate, because `food_status_idx` lets the OLD statement avoid a `Seq Scan` too; and the natural
 * plan choice is cost-model noise below production scale). The statement text is the honest deterministic
 * invariant underneath it: the sequential scan existed *because* the `ILIKE '%q%'` / `name % q` branches
 * ran at 1–2 characters, so "those branches are absent from the executed SQL" is the cause, asserted
 * directly, with no dependence on the planner, on row count, or on timing.
 *
 * Mutation lens: every case below fails if the length threshold moves, if the `:*` prefix marker is
 * dropped, if the tsquery-metacharacter whitelist is removed (an unsanitised `&`/`:`/`!` makes Postgres'
 * `to_tsquery` raise `syntax error in tsquery`, i.e. a 500 on a keystroke), if `search` is reverted to run
 * one statement for every length, or if either statement loses its `RESOLVED` filter or its `LIMIT`.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import type { FoodDrizzle } from '../../../database/database.module.js';
import { FoodSearchDao, selectSearchStrategy } from '../food-search.dao.js';

/** Renders a Drizzle `SQL` fragment to text + params, exactly as the pg driver would. */
const dialect = new PgDialect();

/** One statement `search` handed to the driver. */
interface CapturedStatement {
    /** The rendered SQL, with runs of whitespace collapsed so re-indenting the template cannot break a
     * guard while a change of SHAPE still does. */
    readonly text: string;
    /** The bound parameters, in order. */
    readonly params: readonly unknown[];
}

/**
 * Run `FoodSearchDao.search` against a fake client that records every statement instead of executing it.
 *
 * @param query - The query to route.
 * @param limit - Optional row cap, passed straight through to `search`.
 * @returns Every statement the call executed, in order (empty when it short-circuited).
 */
async function statementsFor(query: string, limit?: number): Promise<CapturedStatement[]> {
    const statements: CapturedStatement[] = [];

    const execute = (statement: SQL): Promise<{ rows: never[] }> => {
        const { sql: text, params } = dialect.sqlToQuery(statement);

        statements.push({ text: text.replace(/\s+/g, ' ').trim(), params });

        return Promise.resolve({ rows: [] });
    };

    const dao = new FoodSearchDao({ execute } as unknown as FoodDrizzle);

    await (limit === undefined ? dao.search(query) : dao.search(query, limit));

    return statements;
}

/**
 * The SINGLE statement `search` executed for a query. Asserting the count here (rather than indexing
 * blindly) is itself a guard: search is one local read per call (FR-009), and a second round trip added to
 * the read path is exactly the kind of regression SC-007's budget pays for.
 *
 * @param query - The query to route.
 * @param limit - Optional row cap.
 * @returns The sole captured statement.
 */
async function soleStatementFor(query: string, limit?: number): Promise<CapturedStatement> {
    const statements = await statementsFor(query, limit);

    expect(statements).toHaveLength(1);

    return statements[0]!;
}

/** The string parameters of a statement, in order (the numeric weights and the limit are not needles). */
function stringParams(statement: CapturedStatement): string[] {
    return statement.params.filter((param): param is string => typeof param === 'string');
}

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

describe('FoodSearchDao.search — the statement it actually executes', () => {
    // The `ILIKE '%q%'` / `name % q` branches ARE the sequential scan T-195 measured. Their absence from
    // the short-query SQL is therefore the direct, planner-independent statement of the SC-007 fix, and
    // their presence at 3+ characters is the statement that nothing else changed.
    const SUBSTRING_BRANCHES = ['ILIKE', 'name %', 'similarity(', 'plainto_tsquery'];

    describe('a 1–2 character query executes the word-initial prefix statement, and ONLY that', () => {
        // Placeholder NUMBERS are deliberately matched as `$\d+` rather than pinned: the score expression
        // binds parameters too, so hardcoding `$5` would turn any unrelated ranking edit into a confusing
        // failure here while adding no discrimination — the SHAPE is the invariant, not the numbering.
        it.each(['c', 'ch'])('runs a prefix tsquery over the GIN-indexed search_vector for %j', async (query) => {
            const statement = await soleStatementFor(query);

            expect(statement.text).toMatch(/search_vector @@ to_tsquery\('simple', \$\d+::text\)/);
            expect(stringParams(statement)).toContain(`${query}:*`);
        });

        it.each(SUBSTRING_BRANCHES)('does NOT reach the %s branch at 2 characters', async (branch) => {
            const statement = await soleStatementFor('ch');

            expect(statement.text).not.toContain(branch);
        });

        it('binds no LIKE wildcard pattern, at all — a `%ch%` param is the reverted statement', async () => {
            const statement = await soleStatementFor('ch');

            expect(statement.params).not.toContain('%ch%');
            expect(stringParams(statement).filter((param) => param.includes('%'))).toEqual([]);
        });

        it("uses the 'simple' config, never 'english' (an english prefix tsquery is EMPTY for a stopword)", async () => {
            const statement = await soleStatementFor('be');

            // `to_tsquery('english', 'be:*')` is an empty tsquery, so this exact flip silently turns every
            // short stopword query into zero results — the pre-T-198 behaviour, restored invisibly.
            expect(statement.text).toContain(`to_tsquery('simple'`);
            expect(statement.text).not.toContain(`to_tsquery('english'`);
        });

        it('surfaces only RESOLVED, named rows and caps them (the short path can match the whole store)', async () => {
            const statement = await soleStatementFor('ch');

            expect(statement.text).toContain(`WHERE status = 'RESOLVED'`);
            expect(statement.text).toContain('AND name IS NOT NULL');
            // A single letter can be word-initial in the ENTIRE store (measured: `m` matched all 50,000
            // rows on the T-195 fixture), so an unbounded prefix statement is an SC-007 breach by itself.
            expect(statement.text).toMatch(/LIMIT \$\d+/);
            expect(statement.params.at(-1)).toBe(20);
        });

        it('orders by the score ALIAS, which is the ordering the recipe service re-sorts on', async () => {
            const statement = await soleStatementFor('ch');

            expect(statement.text).toContain('AS score');
            expect(statement.text).toContain('ORDER BY score DESC, name ASC');
        });

        it('passes an explicit row cap through to the SQL rather than dropping it', async () => {
            const statement = await soleStatementFor('ch', 5);

            expect(statement.params.at(-1)).toBe(5);
        });
    });

    describe('a 3+ character query executes the pre-existing relevance statement, unchanged', () => {
        it.each(['chi', 'chicken', 'grilled chicken'])('keeps every relevance branch for %j', async (query) => {
            const statement = await soleStatementFor(query);

            for (const branch of SUBSTRING_BRANCHES) {
                expect(statement.text).toContain(branch);
            }

            expect(statement.text).toMatch(/plainto_tsquery\('english', \$\d+\)/);
            expect(statement.text).toMatch(/OR name ILIKE \$\d+/);
            expect(statement.text).toMatch(/OR description ILIKE \$\d+/);
            expect(statement.params).toContain(`%${query}%`);
            // The prefix statement must NOT leak up into the substring-capable range.
            expect(statement.text).not.toContain(`to_tsquery('simple'`);
        });

        it('honours an explicit row cap here too', async () => {
            const statement = await soleStatementFor('chicken', 3);

            expect(statement.text).toMatch(/LIMIT \$\d+/);
            expect(statement.params.at(-1)).toBe(3);
        });
    });

    describe('the routing boundary, asserted through the DAO and not just the pure selector', () => {
        // `selectSearchStrategy` can be right while `search` ignores it. These two cases are what fail if
        // the dispatch is collapsed back to a single statement, or if the threshold moves by one.
        it('runs the prefix statement AT 2 characters and the relevance statement AT 3', async () => {
            expect((await soleStatementFor('ch')).text).toContain(`to_tsquery('simple'`);
            expect((await soleStatementFor('chi')).text).toContain(`plainto_tsquery('english'`);
        });
    });

    describe('a query with nothing searchable costs no round trip', () => {
        it.each(['', ' ', '  ', '&', '::', '🍎'])('executes no statement for %j', async (query) => {
            await expect(statementsFor(query)).resolves.toEqual([]);
        });
    });
});

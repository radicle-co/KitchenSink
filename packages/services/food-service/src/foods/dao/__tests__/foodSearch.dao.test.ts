/**
 * Unit tests for `FoodSearchDao`'s routing (003-FR-010a / plan U37, SC-007/FR-008/FR-010) — TWO tiers of
 * guard, both database-free and both running on EVERY pull request (the `unit` job in `_ci.yml`):
 *
 *  1. {@link selectSearchStrategy} — the pure routing DECISION: whether a query is searched at all, and
 *     which statement it resolves to.
 *  2. The STATEMENT `FoodSearchDao.search` actually executes, rendered through drizzle's `PgDialect`
 *     exactly as the `pg` driver would receive it. This is the layer that catches a revert: (1) alone
 *     passes if `search` stops honouring the strategy it selected.
 *
 * Requirement → test mapping:
 * - FR-010a → a query below {@link MIN_SEARCH_QUERY_LENGTH} executes NO statement at all: it cannot
 *             discriminate (one character matches 51% of the real catalog, two 23%), so an arbitrary slice
 *             of it is worse than nothing.
 * - FR-008  → a query of 3+ characters keeps the existing relevance statement, byte for byte — and the
 *             fifteen genuine three-character foods (`egg`, `ham`, `rye`, …) are searched, not refused.
 * - FR-010  → the row cap reaches SQL as a `LIMIT`.
 * - SC-007  → below 3 characters the `ILIKE '%q%'` / `name % q` branches cannot be index-served (the
 *             measured 85–157ms sequential scan). They are now unreachable at that length because NO
 *             statement is, which is a strictly stronger guarantee than routing them elsewhere.
 *
 * ## ⛔ WHAT THIS FILE STOPPED TESTING, AND WHERE THAT COVERAGE WENT (plan U37)
 *
 * T-198's `wordInitialPrefix` strategy — the 1–2 character `to_tsquery('simple', '<token>:*')` path, its
 * `simple`-vs-`english` config subtlety, its name-initial ranking, and the character WHITELIST that kept a
 * raw `&`/`|`/`!`/`:`/`(`/`'` from reaching `to_tsquery` and raising `syntax error in tsquery` (a 500 on a
 * keystroke) — is DELETED, and so are the ~20 cases that proved it. It is not weakened coverage: the
 * hazard those cases guarded no longer exists, because the input can no longer reach a tsquery PARSER.
 * What replaces them is one assertion that is stronger than all of them together —
 * {@link NO_TSQUERY_PARSER} — which fails if any executed statement ever calls bare `to_tsquery` again,
 * whitelist or no whitelist. The 1–2 character behaviour they described is now a product decision
 * (FR-010a), asserted here as "no round trip" and on both clients as the localized empty state.
 *
 * ## Why the statement TEXT and not the query PLAN
 *
 * SC-007's claim is that search is index-served rather than scanned, so the tempting assertion is
 * `EXPLAIN … LIKE '%food_search_vector_idx%'`. That guard was written, measured and deliberately removed —
 * `tests/foodSearch.dao.integration.test.ts` records the two reproductions (forcing the planner does not
 * discriminate, because `food_status_idx` lets the OLD statement avoid a `Seq Scan` too; and the natural
 * plan choice is cost-model noise below production scale). The statement text is the honest deterministic
 * invariant underneath it, with no dependence on the planner, on row count, or on timing.
 *
 * Mutation lens: every case below fails if the minimum moves in EITHER direction (a floor of 4 breaks
 * `egg`; a floor of 2 restores the 23%-of-catalog slice), if `search` stops honouring the strategy it
 * selected, if a bare `to_tsquery` returns, or if the relevance statement loses its `RESOLVED` filter or
 * its `LIMIT`.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';

import type { FoodDrizzle } from '../../../database/database.module.js';
import { FoodSearchDao, selectSearchStrategy } from '../foodSearch.dao.js';

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

    await (limit === undefined
        ? dao.search(query, 'caller-scoping-test')
        : dao.search(query, 'caller-scoping-test', limit));

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

/**
 * Every genuine three-character food FR-010a enumerates from the real catalog. They are the reason the floor
 * is three and not four, and they are asserted BY NAME rather than as "some 3-character string" so a raised
 * floor fails with the food it broke.
 */
const THREE_CHARACTER_FOODS = [
    'egg',
    'ham',
    'rye',
    'cod',
    'soy',
    'oat',
    'fig',
    'yam',
    'nut',
    'tea',
    'pie',
    'elk',
    'gin',
    'rum',
    'poi',
] as const;

/**
 * A call to the bare tsquery PARSER. `to_tsquery` parses its argument, so a raw `&`, `|`, `!`, `:`, `(` or
 * `'` in it raises `syntax error in tsquery` — a 500 on a keystroke — and the only defence was a hand-rolled
 * character whitelist. `plainto_tsquery` SANITISES instead of parsing and is safe, so the lookbehind is what
 * makes this assertion meaningful rather than a substring accident.
 */
const NO_TSQUERY_PARSER = /(?<![a-z_])to_tsquery\(/;

describe('selectSearchStrategy', () => {
    describe('below the FR-010a minimum, nothing is searched at all', () => {
        it.each(['', 'e', 'eg', ' ', '  ', 'c', 'ch', '&', '::', '🍎', ' eg '])(
            'yields no strategy for %j',
            (query) => {
                expect(selectSearchStrategy(query)).toEqual({ kind: 'none' });
            },
        );

        it('refuses everything shorter than the shared minimum, whatever that minimum is', () => {
            // Derived from the constant rather than pinned to 2, so this case cannot silently disagree with
            // the policy module the clients also read.
            const justShort = 'a'.repeat(MIN_SEARCH_QUERY_LENGTH - 1);

            expect(selectSearchStrategy(justShort)).toEqual({ kind: 'none' });
        });
    });

    describe('at and above the minimum, the relevance statement is selected', () => {
        it.each(THREE_CHARACTER_FOODS)('searches the real three-character food %j', (query) => {
            expect(selectSearchStrategy(query)).toEqual({ kind: 'relevance' });
        });

        // `'&&&'` / `'<->'` route here too, and that is correct: `plainto_tsquery` SANITISES rather than
        // parses, so the relevance statement has always been safe against metacharacters. There is no longer
        // any path on which a metacharacter reaches a tsquery PARSER, so there is no whitelist to keep.
        it.each(['abc', 'chicken', 'grilled chicken', 'a b', '&&&', '2%!', '<->'])(
            'routes %j to the relevance strategy, untouched',
            (query) => {
                expect(selectSearchStrategy(query)).toEqual({ kind: 'relevance' });
            },
        );

        it('counts CHARACTERS, not UTF-16 code units, when applying the minimum', () => {
            // '🍎' is two UTF-16 units but ONE character. Counting code units would admit two of them as a
            // 4-character query and search on what the cook reads as two.
            expect(selectSearchStrategy('🍎🍎')).toEqual({ kind: 'none' });
            expect(selectSearchStrategy('🍎🍎🍎')).toEqual({ kind: 'relevance' });
        });
    });

    describe('the boundary is exactly three, in both directions', () => {
        it('refuses two characters and admits three', () => {
            // The pair, together, is the FR-010a ruling: a floor of 2 restores the 23%-of-catalog slice, a
            // floor of 4 breaks `egg`. Either mutation fails one half of this.
            expect(selectSearchStrategy('eg')).toEqual({ kind: 'none' });
            expect(selectSearchStrategy('egg')).toEqual({ kind: 'relevance' });
        });
    });
});

describe('FoodSearchDao.search — the statement it actually executes', () => {
    // The `ILIKE '%q%'` / `name % q` branches ARE the sequential scan T-195 measured. Their presence at
    // 3+ characters is the statement that FR-010a changed nothing above the minimum; below it they are
    // unreachable because no statement is.
    const SUBSTRING_BRANCHES = ['ILIKE', 'name %', 'similarity(', 'plainto_tsquery'];

    describe('a query below the minimum executes NOTHING', () => {
        // ⚠️ REPLACES the ~10 cases that proved the deleted `wordInitialPrefix` statement (T-198). Those
        // asserted which statement a 1–2 character query ran; there is no longer a statement to assert, and
        // "no round trip at all" is strictly stronger than any of them — it cannot be satisfied by a
        // statement that merely looks different.
        it.each(['', ' ', 'c', 'ch', ' eg ', '&', '::', '🍎'])('issues no statement for %j', async (query) => {
            await expect(statementsFor(query)).resolves.toEqual([]);
        });

        it('reaches the database for three characters, so the guard above is not vacuous', async () => {
            // Without this, deleting `search`'s body entirely would pass every case above.
            await expect(statementsFor('egg')).resolves.toHaveLength(1);
        });
    });

    describe('the tsquery PARSER is gone from every statement, at every length', () => {
        // ⚠️ THIS IS WHERE THE DELETED WHITELIST'S COVERAGE WENT. `to_tsquery` was reachable only from the
        // short path, and it PARSES its argument, so a raw `&`/`|`/`!`/`:`/`(`/`'` raised
        // `syntax error in tsquery` — a 500 on a keystroke — unless application code stripped it first. The
        // whitelist was a hand-rolled sanitiser guarding a parser we did not need; both are deleted, and
        // this case fails if either returns.
        it.each(['egg', 'chicken', 'grilled chicken', "a'b", 'a&b', 'a|b', 'a!b', 'a:b', 'a(b', '2% milk'])(
            'never calls bare to_tsquery for %j',
            async (query) => {
                const statements = await statementsFor(query);

                expect(statements).not.toEqual([]);

                for (const statement of statements) {
                    expect(statement.text).not.toMatch(NO_TSQUERY_PARSER);
                }
            },
        );

        it('still uses the SANITISING plainto_tsquery, so the guard discriminates', async () => {
            const statement = await soleStatementFor('chicken');

            expect(statement.text).toContain("plainto_tsquery('english'");
            expect(statement.text).not.toMatch(NO_TSQUERY_PARSER);
        });

        it('passes a tsquery metacharacter through as an ordinary bound VALUE', async () => {
            // Nothing strips it any more, and nothing needs to: it travels as a parameter into
            // `plainto_tsquery`, `similarity()` and an escaped `ILIKE` pattern, none of which parse it.
            const statement = await soleStatementFor('a&b');

            expect(stringParams(statement)).toContain('a&b');
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
            // No bare tsquery PARSER anywhere in it — see NO_TSQUERY_PARSER for why that matters.
            expect(statement.text).not.toMatch(NO_TSQUERY_PARSER);
        });

        it('orders by the score ALIAS with a deterministic tiebreak', async () => {
            const statement = await soleStatementFor('chicken');

            expect(statement.text).toContain('AS score');
            // `name ASC` is not cosmetic.
            // Without the tiebreak, rows sharing a score come back in whatever order the ACCESS PATH
            // happened to produce them — so the same query returns a different top 20 as the plan changes,
            // and T-202 changed the plan (`food_name_trgm_gist_idx`). Ties are the normal case here, not an
            // edge: every row matched only by an `ILIKE` branch scores `similarity(name, query)`, and equal
            // similarity across similarly-shaped USDA names is common. `FoodCatalogGateway` in the recipe
            // service then re-sorts hits by `score DESC, name ASC`, so a tie the DAO leaves unbroken is one
            // the two sides resolve differently.
            expect(statement.text).toContain('ORDER BY score DESC, name ASC');
        });

        it('honours an explicit row cap here too', async () => {
            const statement = await soleStatementFor('chicken', 3);

            expect(statement.text).toMatch(/LIMIT \$\d+/);
            expect(statement.params.at(-1)).toBe(3);
        });
    });

    /**
     * THE CURATED-ALIAS BRANCH (plan U2 / KTD-2).
     *
     * USDA publishes 9,648 additional descriptions across 5,432 FNDDS main descriptions — brands, regional
     * synonyms and alternate forms (`Tillamook`, `Longhorn`, `sharp cheese` for `Cheese, Cheddar`). They now
     * land in `food.aliases`, with their OWN stored generated tsvector `aliases_search_vector` and its own
     * GIN index.
     *
     * ⛔ They are deliberately NOT folded into `search_vector`. Doing so needs
     * `ALTER COLUMN … SET EXPRESSION`, which is PostgreSQL 17, and the PG 16 equivalent is DROP + ADD
     * COLUMN — an ACCESS EXCLUSIVE lock, a full rewrite of `food`, and the dependent GIN index dropped.
     * So the statement ORs the two vectors and takes the better of the two `ts_rank`s.
     *
     * Mutation lens: these fail if the alias predicate is dropped from the WHERE (an alias-only query would
     * return nothing), if it is added to the WHERE but not to the score (an alias hit would rank at 0 and
     * be truncated out of the 20-row page — the failure mode a "does it match?" test cannot see), or if the
     * second vector is folded into the first.
     */
    describe('the curated-alias branch (U2)', () => {
        it('matches the second vector as well as the first', async () => {
            const statement = await soleStatementFor('tillamook');

            expect(statement.text).toMatch(/aliases_search_vector @@ plainto_tsquery\('english', \$\d+\)/);
            expect(statement.text).toMatch(
                /search_vector @@ plainto_tsquery\('english', \$\d+\)\s+OR aliases_search_vector/,
            );
        });

        it('RANKS an alias hit — matching without scoring would leave it unreachable past the LIMIT', async () => {
            // ⚠️ REWRITTEN for U5, not weakened. It used to assert `GREATEST(` appears exactly ONCE, as a
            // proxy for "the ranking has one authority". The tiered sort key adds a second `GREATEST` — the
            // clamp that keeps the base metric inside [0, 1] so a rung can never be crossed — so counting
            // the token now measures the wrong thing. The invariant it was protecting is unchanged and is
            // asserted directly below: each of the three relevance branches appears exactly once, all three
            // are combined by ONE base-metric expression, and that expression is fed into the ONE score the
            // `ORDER BY` sorts on. The tier ladder itself is asserted in `foodRelevance.test.ts`.
            const statement = await soleStatementFor('tillamook');
            const score = statement.text.slice(0, statement.text.indexOf('AS score'));

            expect(score.match(/ts_rank\(aliases_search_vector,/g)).toHaveLength(1);
            expect(score.match(/ts_rank\(search_vector,/g)).toHaveLength(1);
            expect(score.match(/similarity\(name,/g)).toHaveLength(1);
            expect(statement.text).toContain('ORDER BY score DESC, name ASC');
            expect(statement.text.slice(statement.text.indexOf('AS score'))).not.toContain('ts_rank(');
        });

        it('layers the tier ladder ABOVE that expression rather than replacing it (U5 / KTD-1)', async () => {
            // The catalog keeps `similarity` — swapping it for `word_similarity` measured 4 regressions and
            // 0 fixes — so the ladder must be additive. This case fails if the ladder is ever removed to
            // "simplify" the statement back to its pre-U5 shape.
            const statement = await soleStatementFor('tillamook');
            const score = statement.text.slice(0, statement.text.indexOf('AS score'));

            expect(score).toContain('CASE');
            expect(score).toContain('food.rank_folded');
            expect(score).toContain('food.rank_tokens');
            expect(score).toContain('ELSE 0');
            // ⛔ And it does NO per-row text processing: the fold and the tokenizer are two STORED generated
            // columns (migration 0008), because computing them per row measured 253–357ms at 50,000 rows
            // against SC-007's 200ms budget. Inlining them back would pass every ordering test here.
            expect(statement.text).not.toContain('CROSS JOIN LATERAL');
            expect(score).not.toContain('regexp_split_to_table');
        });

        it('does not add a second trigram or ILIKE branch over the alias text', async () => {
            // The alias column gets a tsvector and nothing else. `name %` already cost 30.5ms of a 45.8ms
            // statement before 0004 gave it a GiST index; a fourth `ILIKE '%q%'` over a second free-text
            // column is exactly the per-row cost SC-007's budget has no room for.
            const statement = await soleStatementFor('tillamook');

            expect(statement.text).not.toContain('aliases ILIKE');
            expect(statement.text).not.toContain('aliases %');
            expect(statement.text).not.toContain('similarity(aliases');
        });
    });

    /**
     * LIKE-METACHARACTER ESCAPING — the security half of the relevance statement.
     *
     * `%` and `_` are wildcards to `ILIKE`, not literals, and the pattern is built by wrapping the user's
     * query: `%${query}%`. So `?query=%` produced `ILIKE '%%%'` — a pattern that matches EVERY row with a
     * name, turning a search endpoint into a full-table scan on demand; `?query=___` matched any 3+
     * character name; and a query of alternating `%_` compounds the recheck cost per row. Parameterisation
     * does not help, because the metacharacters are inside the parameter's VALUE, where they are still
     * pattern syntax. This is a bounded-work / availability defect, not SQL injection.
     *
     * The escape happens where the PATTERN IS BUILT, and nowhere else. That placement is load-bearing: the
     * same validated string is also bound to `plainto_tsquery` (which parses to lexemes and discards
     * operators, so it is already safe) and to the trigram comparison `name % query` (where the string is a
     * VALUE, not a pattern). Escaping at validation time would corrupt both — a search for `50% cream` would
     * become a search for the literal text `50\% cream`.
     *
     * Mutation lens: each case reds if the escaping is removed, if it is moved to validation, if `ESCAPE`
     * stops being declared, or if a metacharacter is dropped from the set.
     */
    describe('LIKE metacharacters in the ILIKE pattern are escaped, so a wildcard cannot scan the table', () => {
        it.each([
            ['%', '\\%'],
            ['_', '\\_'],
            ['\\', '\\\\'],
        ])('escapes %j inside the pattern as %j', async (needle, escaped) => {
            // Padded past the FR-010a minimum so the query is searched at all; `abc` carries no
            // metacharacter of its own, so the only escaping observed is the needle's.
            const statement = await soleStatementFor(`abc${needle}`);

            expect(stringParams(statement)).toContain(`%abc${escaped}%`);
        });

        it('escapes a lone % so the pattern can no longer match every row', async () => {
            // The exploit, reduced: before escaping this bound `%%%`, which ILIKE matches against any name.
            const statement = await soleStatementFor('%%%');

            expect(stringParams(statement)).toContain('%\\%\\%\\%%');
            expect(stringParams(statement)).not.toContain('%%%%%');
        });

        it('leaves a LEGITIMATE % in the query searchable — `50% cream` still finds `50% cream`', async () => {
            const statement = await soleStatementFor('50% cream');

            // The pattern matches the literal percent sign…
            expect(stringParams(statement)).toContain('%50\\% cream%');
            // …while the FTS and trigram branches receive the query UNESCAPED, because a backslash there is
            // a character to match, not an escape. This is the assertion that reds if escaping is hoisted
            // into validation.
            expect(stringParams(statement)).toContain('50% cream');
        });

        it('declares the escape character explicitly on both ILIKE branches', async () => {
            const statement = await soleStatementFor('chicken');

            // Postgres defaults to backslash, but the default is a server setting away from being wrong;
            // stating it makes the pattern's meaning independent of the connection's configuration.
            expect(statement.text).toMatch(/name ILIKE \$\d+ ESCAPE '\\'/);
            expect(statement.text).toMatch(/description ILIKE \$\d+ ESCAPE '\\'/);
        });

        it('never double-escapes, so a backslash the user typed survives as one backslash', async () => {
            // A sequential `\` → `%` → `_` escape is where the classic double-escaping bug lives. One
            // left-to-right pass cannot re-visit what it just inserted, which is why this holds.
            const statement = await soleStatementFor('a\\%b');

            expect(stringParams(statement)).toContain('%a\\\\\\%b%');
        });
    });

    describe('the FR-010a boundary, asserted through the DAO and not just the pure selector', () => {
        // `selectSearchStrategy` can be right while `search` ignores it. These cases are what fail if the
        // dispatch stops honouring the strategy, or if the minimum moves by one in either direction.
        it('issues no statement AT 2 characters and the relevance statement AT 3', async () => {
            await expect(statementsFor('eg')).resolves.toEqual([]);
            expect((await soleStatementFor('egg')).text).toContain("plainto_tsquery('english'");
        });

        it.each(THREE_CHARACTER_FOODS)('actually searches for the real three-character food %j', async (query) => {
            const statement = await soleStatementFor(query);

            expect(stringParams(statement)).toContain(query);
        });
    });
});

describe('the FNDDS consumption prior rides the statement (plan U5)', () => {
    it('LEFT JOINs food_popularity and folds the clamped fraction into the score', async () => {
        const statement = await soleStatementFor('flour');

        // LEFT, never INNER: an absent popularity row IS a prior of zero, and an inner join would silently
        // drop every food without measured consumption from the results entirely.
        expect(statement.text).toMatch(/LEFT JOIN food_popularity fp ON fp\.food_id = food\.id/);
        expect(statement.text).toContain('COALESCE(fp.prior_fraction, 0::float8)');
    });
});

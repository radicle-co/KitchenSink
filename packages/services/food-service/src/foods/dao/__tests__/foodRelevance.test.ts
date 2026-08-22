/**
 * Unit tests for the CATALOG Scoring Policy (plan U5) — the SQL mirror of `@kitchensink/recipe-core`'s
 * ranking vocabulary, and the sort key `FoodSearchDao` orders by.
 *
 * ## What is asserted here, and what structurally CANNOT be
 *
 * This file asserts the SHAPE of the rendered fragments: that a tier expression exists at all, that it has
 * one rung per tier, that the base metric is still `similarity` (KTD-1 — the catalog keeps its length
 * penalty), that the score is normalized so it cannot cross food-service's crosswalk score of `1`, and that
 * the query's terms arrive as BOUND PARAMETERS rather than being re-derived in SQL.
 *
 * ⛔ It cannot assert that Postgres AGREES with `classifyRankTier` — two engines, two regex dialects, one
 * collation each. That is `tests/rankingTiers.integration.test.ts` and the shared conformance contract in
 * `@kitchensink/service-test-harness`, both against a real database.
 *
 * ⚠️ **This is the test KTD-1 says had to be written.** `foodSearch.dao.test.ts` asserts branch substrings
 * and `ORDER BY score DESC, name ASC` and never the scoring expression, so a tiered sort key passes it
 * unchanged — "worse than a failing test: nothing forces the rewrite, and a stale suite stays green while
 * counting as coverage for behaviour it no longer describes."
 *
 * ## Mutation lens
 *
 * Every case fails if the tier expression is dropped or loses a rung, if the base metric is swapped for
 * `word_similarity`, if the normalization divisor is removed, if the fold stops stripping combining marks or
 * starts using `[[:space:]]`, or if a query term is interpolated instead of bound.
 */
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';
import { RANK_TIERS, SCORE_CEILING, TIER_GAP } from '@kitchensink/recipe-core/resolution/ranking-tiers';

import { CATALOG_RANK_TERMS_ALIAS, catalogTieredSortKey } from '../foodRelevance.js';

const dialect = new PgDialect();

/** Render a fragment exactly as the pg driver receives it, with whitespace runs collapsed. */
function render(fragment: SQL): { readonly text: string; readonly params: readonly unknown[] } {
    const query = dialect.sqlToQuery(sql`SELECT ${fragment}`);

    return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
}

const BASE_METRIC = sql`similarity(name, ${'brown sugar'})`;
const KEY = catalogTieredSortKey('brown sugar', BASE_METRIC);

describe('catalogTieredSortKey — the per-row terms lateral', () => {
    const lateral = render(KEY.lateral);

    it('folds case and strips combining marks, mirroring `foldForRanking`', () => {
        expect(lateral.text).toContain('lower(');
        expect(lateral.text).toContain('normalize(');
        expect(lateral.text).toContain('NFD');
        // The pattern is a BOUND PARAMETER, not spliced text — `regexp_replace` takes it as a value, and
        // `sql.raw` is banned in this repository. Asserting it through `params` therefore also proves it is
        // parameterised.
        expect(lateral.params).toContain('[\\u0300-\\u036f]');
    });

    it('collapses ONLY the explicit ASCII whitespace class, never `[[:space:]]`', () => {
        // `[[:space:]]` and JavaScript's `\s` do not agree on NBSP; the TypeScript fold uses an explicit
        // class for exactly that reason, and the SQL mirror must use the same one or the two folds diverge
        // on an input neither author thought about.
        expect(lateral.params).not.toContain('[[:space:]]+');
        expect(lateral.params).toContain('[ \\t\\n\\r\\f\\v]+');
    });

    it('tokenizes on non-alphanumeric runs and PRESERVES ORDER, because the head term is token 1', () => {
        expect(lateral.text).toContain('regexp_split_to_table');
        expect(lateral.text).toContain('WITH ORDINALITY');
        expect(lateral.text).toContain('ORDER BY');
        expect(lateral.params).toContain('[^[:alnum:]]+');
    });

    it('applies both arms of the plural rule with their length guards', () => {
        expect(lateral.params).toContain('(s|x|z|ch|sh)es$');
        expect(lateral.params).toContain('[^s]s$');
        expect(lateral.params).toContain(5);
        expect(lateral.params).toContain(4);
        expect(lateral.text).toContain('left(split.token, -2)');
        expect(lateral.text).toContain('left(split.token, -1)');
    });

    it('computes the row terms ONCE, under a named alias the score refers to', () => {
        expect(lateral.text).toContain(CATALOG_RANK_TERMS_ALIAS);
        expect(render(KEY.score).text).toContain(`${CATALOG_RANK_TERMS_ALIAS}.`);
    });
});

describe('catalogTieredSortKey — the tier expression itself', () => {
    const score = render(KEY.score);

    it('renders one rung per tier, highest first, so the CASE IS the ladder', () => {
        // The `base` rung is the `ELSE`, which is what makes the ladder TOTAL: every row lands somewhere.
        for (let ordinal = RANK_TIERS.length - 1; ordinal >= 1; ordinal -= 1) {
            expect(score.text).toContain(`THEN ${ordinal}`);
        }

        expect(score.text).toContain('ELSE 0');
    });

    it('orders the rungs so the first matching branch is the HIGHEST tier that holds', () => {
        const rungs = [...score.text.matchAll(/THEN (\d)/g)].map((match) => Number(match[1]));

        expect(rungs).toEqual([...rungs].sort((a, b) => b - a));
    });

    it('keeps the CATALOG base metric — `similarity`, length penalty and all (KTD-1)', () => {
        expect(score.text).toContain('similarity(');
        expect(score.text).not.toContain('word_similarity(');
    });

    it('normalizes by the shared ceiling, so a lexical hit can never outrank a crosswalk hit', () => {
        // food-service unshifts a barcode / external-key crosswalk hit at score exactly 1, and the recipe
        // gateway re-sorts by score. An un-normalized tiered score would reach 9 and silently demote it.
        expect(score.params).toContain(SCORE_CEILING);
        expect(score.params).toContain(TIER_GAP);
        expect(score.text).toMatch(/\/ \$\d+::float8\)::float8$/);
    });

    it('binds every query term as a parameter rather than deriving it in SQL', () => {
        const terms = describeRankingQuery('brown sugar');

        expect(score.params).toContain(terms.folded);
        expect(score.params).toContain(terms.head);
        expect(score.params).toContainEqual([...terms.tokens]);
    });

    it('⛔ binds the token array as ONE value, never as a row constructor', () => {
        // Drizzle flattens a bare `${array}` into one placeholder per element, so `${tokens}::text[]`
        // renders `($1, $2)::text[]` — a ROW constructor cast to an array. It parses, it even runs, and it
        // is not the containment test the rung means. `sql.param` is what makes it one value.
        expect(score.text).not.toMatch(/\(\$\d+, \$\d+\)::text\[\]/);
        expect(score.text).toMatch(/\$\d+::text\[\]/);
    });

    it("carries no raw-affinity term — `raw` injection is recipe-service's local surface (U6)", () => {
        expect(score.text).not.toContain('raw');
    });
});

describe('catalogTieredSortKey — a query with nothing searchable', () => {
    it('still renders a valid key rather than throwing, so the DAO has one code path', () => {
        const empty = catalogTieredSortKey('   ', BASE_METRIC);

        // Nothing can be promoted by a query with no tokens: `[].every()` is vacuously true and
        // `'{}' <@ anything` is true, so both `covered` and `tokenSet` would fire on garbage input. The
        // policy resolves that at BUILD time — the rendered key carries no rung above `base` at all.
        expect(() => render(empty.score)).not.toThrow();
        expect(render(empty.score).text).not.toContain('THEN');
    });
});

/**
 * Unit tests for the CATALOG Scoring Policy (plan U5) — the sort key `FoodSearchDao` orders by.
 *
 * ## What is asserted here, and what structurally CANNOT be
 *
 * This file asserts the SHAPE of the rendered sort key: that a tier ladder exists at all, that it has one
 * rung per tier in descending order, that the base metric is still `similarity` (KTD-1 — the catalog keeps
 * its length penalty), that the score is normalized so it cannot cross food-service's crosswalk score of
 * `1`, and that the query's terms arrive as BOUND PARAMETERS.
 *
 * ⚠️ **The fold, the tokenizer and the plural rule are NOT asserted here, because they are no longer in the
 * statement.** They are two STORED generated columns from `0008_food_rank_terms.sql`, and the only honest
 * place to assert that PostgreSQL computes them the way `@kitchensink/recipe-core` does is against a real
 * database — `tests/rankingTerms.integration.test.ts` compares every column value with the TypeScript
 * reference, row by row. That is a strictly stronger guard than the statement-text assertions it replaces.
 *
 * ⚠️ **This is the test KTD-1 says had to be written.** `foodSearch.dao.test.ts` asserts branch substrings
 * and `ORDER BY score DESC, name ASC` and never the scoring expression, so a tiered sort key passes it
 * unchanged — "worse than a failing test: nothing forces the rewrite, and a stale suite stays green while
 * counting as coverage for behaviour it no longer describes."
 *
 * ## Mutation lens
 *
 * Every case fails if the ladder is dropped or loses a rung, if the rungs are reordered, if the base metric
 * is swapped for `word_similarity`, if the normalization divisor is removed, if the policy stops reading the
 * materialized columns (which would silently reintroduce the 253–357ms per-row form), or if a query term is
 * interpolated instead of bound.
 */
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';
import { RANK_TIERS, SCORE_CEILING, TIER_GAP } from '@kitchensink/recipe-core/resolution/ranking-tiers';

import { CATALOG_RANK_TERM_COLUMNS, catalogTieredSortKey } from '../foodRelevance.js';

const dialect = new PgDialect();

/** Render a fragment exactly as the pg driver receives it, with whitespace runs collapsed. */
function render(fragment: SQL): { readonly text: string; readonly params: readonly unknown[] } {
    const query = dialect.sqlToQuery(sql`SELECT ${fragment}`);

    return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
}

const BASE_METRIC = sql`similarity(name, ${'brown sugar'})`;
const SCORE = render(catalogTieredSortKey('brown sugar', BASE_METRIC));

describe('catalogTieredSortKey — the tier expression itself', () => {
    it('renders one rung per tier, highest first, so the CASE IS the ladder', () => {
        // The `base` rung is the `ELSE`, which is what makes the ladder TOTAL: every row lands somewhere.
        for (let ordinal = RANK_TIERS.length - 1; ordinal >= 1; ordinal -= 1) {
            expect(SCORE.text).toContain(`THEN ${ordinal}`);
        }

        expect(SCORE.text).toContain('ELSE 0');
    });

    it('orders the rungs so the first matching branch is the HIGHEST tier that holds', () => {
        const rungs = [...SCORE.text.matchAll(/THEN (\d)/g)].map((match) => Number(match[1]));

        expect(rungs).toEqual([...rungs].sort((a, b) => b - a));
    });

    it('keeps the CATALOG base metric — `similarity`, length penalty and all (KTD-1)', () => {
        expect(SCORE.text).toContain('similarity(');
        expect(SCORE.text).not.toContain('word_similarity(');
    });

    it('normalizes by the shared ceiling, so a lexical hit can never outrank a crosswalk hit', () => {
        // food-service unshifts a barcode / external-key crosswalk hit at score exactly 1, and the recipe
        // gateway re-sorts by score. An un-normalized tiered score would reach 9 and silently demote it.
        expect(SCORE.params).toContain(SCORE_CEILING);
        expect(SCORE.params).toContain(TIER_GAP);
        expect(SCORE.text).toMatch(/\/ \$\d+::float8\)::float8$/);
    });

    it('binds every query term as a parameter rather than deriving it in SQL', () => {
        const terms = describeRankingQuery('brown sugar');

        expect(SCORE.params).toContain(terms.folded);
        expect(SCORE.params).toContain(terms.head);
        expect(SCORE.params).toContainEqual([...terms.tokens]);
    });

    it('⛔ binds the token array as ONE value, never as a row constructor', () => {
        // Drizzle flattens a bare `${array}` into one placeholder per element, so `${tokens}::text[]`
        // renders `($1, $2)::text[]` — a ROW constructor cast to an array. It parses, it even runs, and it
        // is not the containment test the rung means. `sql.param` is what makes it one value.
        expect(SCORE.text).not.toMatch(/\(\$\d+, \$\d+\)::text\[\]/);
        expect(SCORE.text).toMatch(/\$\d+::text\[\]/);
    });
});

describe('catalogTieredSortKey — it reads the MATERIALIZED terms, and that is load-bearing', () => {
    it('names both generated columns rather than folding the name per row', () => {
        // ⛔ The regression this guards is a performance cliff, not a wrong answer: computing the fold and
        // the token array inside the statement measured 253ms (`broad`) and 357ms (`brand`) at 50,000 rows
        // against SC-007's 200ms budget, where reading these columns costs +0.8ms and +5.2ms. A rewrite that
        // "inlines" them to avoid a migration would pass every ordering test in the repository.
        for (const column of CATALOG_RANK_TERM_COLUMNS) {
            expect(SCORE.text).toContain(column);
        }
    });

    it('does no per-row text processing at all — no fold, no tokenizer, no lateral', () => {
        for (const banned of ['normalize(', 'regexp_split_to_table', 'regexp_replace', 'CROSS JOIN LATERAL']) {
            expect(SCORE.text).not.toContain(banned);
        }
    });

    it('reads the head from the materialized rank_head column (U1, migration 0011)', () => {
        // Rewritten 2026-08-30: was `rank_tokens[1]`, which crowned the MODIFIER of natural-order names
        // (`Cinnamon buns, frosted` won the query `cinnamon` at the head rung — the measured false catch).
        // `rank_head` mirrors describeRankingName().head, comma-segment rule included.
        expect(SCORE.text).toContain('food.rank_head');
        expect(SCORE.text).not.toContain('rank_tokens[1]');
    });
});

describe('catalogTieredSortKey — a query with nothing searchable', () => {
    it('still renders a valid key rather than throwing, so the DAO has one code path', () => {
        // Nothing can be promoted by a query with no tokens: `[].every()` is vacuously true and
        // `'{}' <@ anything` is true, so both `covered` and `tokenSet` would fire on garbage input. The
        // policy resolves that at BUILD time — the rendered key carries no rung above `base` at all.
        const empty = catalogTieredSortKey('   ', BASE_METRIC);

        expect(() => render(empty)).not.toThrow();
        expect(render(empty).text).not.toContain('THEN');
    });
});

/**
 * Unit tests for the LOCAL Scoring Policy (plan U5/U6) — the sort key `IngredientsDal.search` orders by.
 *
 * ## The defect on THIS surface is a TIE, not a penalty
 *
 * Measured on `postgres:16` with `pg_trgm`, 2026-08-22:
 *
 * | expression                                | value |
 * | ----------------------------------------- | ----- |
 * | `word_similarity('flour', 'Flour')`       | 1.00  |
 * | `word_similarity('flour', 'Carob flour')` | 1.00  |
 *
 * Both score 1.00 — `word_similarity` measures the best matching word EXTENT and does not penalise extra
 * words — so `name ASC` decides, and `'Carob flour' < 'Flour'`. The attractor wins by the alphabet. That is
 * a different failure from the catalog's, on the surface that decided **92.8%** of the import's lines.
 *
 * ⛔ The base metric still has to be `word_similarity`: KTD-1's `flor` → `All-purpose flour` case scores
 * 0.600 by word similarity and only **0.15** by `similarity`, below the `%` operator's 0.3 threshold. So the
 * fix is a rung above it, not a different metric.
 *
 * ⚠️ **The fold, the tokenizer and the plural rule are NOT asserted here**, because they are no longer in
 * the statement — they are two STORED generated columns from `0025_ingredient_rank_terms.sql`. The only
 * honest place to assert that PostgreSQL computes them the way `@kitchensink/recipe-core` does is against a
 * real database: `__tests__/integration/ingredients/rankingTerms.integration.test.ts` compares every column
 * value with the TypeScript reference, row by row.
 *
 * ## Mutation lens
 *
 * Every case fails if the ladder is dropped, if the base metric is swapped for `similarity`, if the raw
 * affinity escapes its rung, if the policy stops reading the materialized columns, or if a query term is
 * interpolated instead of bound.
 */
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';
import {
    RANK_TIERS,
    RAW_AFFINITY_BONUS,
    SCORE_CEILING,
    TIER_GAP,
} from '@kitchensink/recipe-core/resolution/ranking-tiers';

import { selectIngredientMatchStrategy } from '../../selectIngredientMatchStrategy.js';
import { LOCAL_RANK_TERM_COLUMNS, localTieredSortKey } from '../ingredientRelevance.js';

const dialect = new PgDialect();

/** Render a fragment exactly as the pg driver receives it, with whitespace runs collapsed. */
function render(fragment: SQL): { readonly text: string; readonly params: readonly unknown[] } {
    const query = dialect.sqlToQuery(sql`SELECT ${fragment}`);

    return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
}

/** Build and render the sort key the DAL would build for a query. */
function keyFor(query: string): { readonly text: string; readonly params: readonly unknown[] } {
    const strategy = selectIngredientMatchStrategy(query);

    if (strategy.kind === 'none') {
        throw new Error(`"${query}" has no searchable token`);
    }

    return render(localTieredSortKey(strategy, sql`word_similarity(${query}, ingredients.name)`));
}

describe('localTieredSortKey — the tier expression itself', () => {
    const score = keyFor('brown sugar');

    it('renders one rung per tier, highest first, with `base` as the ELSE', () => {
        for (let ordinal = RANK_TIERS.length - 1; ordinal >= 1; ordinal -= 1) {
            expect(score.text).toContain(`THEN ${ordinal}`);
        }

        expect(score.text).toContain('ELSE 0');
    });

    it('keeps the LOCAL base metric — `word_similarity`, which the `flor` case needs (KTD-1)', () => {
        expect(score.text).toContain('word_similarity(');
    });

    it('normalizes by the same shared ceiling as the catalog surface', () => {
        expect(score.params).toContain(SCORE_CEILING);
        expect(score.params).toContain(TIER_GAP);
    });

    it('binds every query term as a parameter, as ONE array rather than a row constructor', () => {
        const terms = describeRankingQuery('brown sugar');

        expect(score.params).toContain(terms.folded);
        expect(score.params).toContain(terms.head);
        expect(score.params).toContainEqual([...terms.tokens]);
        expect(score.text).not.toMatch(/\(\$\d+, \$\d+\)::text\[\]/);
    });
});

describe('localTieredSortKey — it reads the MATERIALIZED terms, and that is load-bearing', () => {
    const score = keyFor('brown sugar');

    it('names both generated columns rather than folding the name per row', () => {
        // ⛔ The regression this guards is a performance cliff, not a wrong answer: computing the fold and
        // the token array inside the statement measured 253ms and 357ms at 50,000 rows against SC-007's
        // 200ms budget, where reading these columns costs +0.8ms and +5.2ms. A rewrite that "inlines" them
        // to avoid a migration would pass every ordering test in this repository.
        for (const column of LOCAL_RANK_TERM_COLUMNS) {
            expect(score.text).toContain(column);
        }
    });

    it('does no per-row text processing at all — no fold, no tokenizer, no lateral', () => {
        for (const banned of ['normalize(', 'regexp_split_to_table', 'regexp_replace', 'CROSS JOIN LATERAL']) {
            expect(score.text).not.toContain(banned);
        }
    });

    it('reads the head term as element 1 of the materialized array', () => {
        expect(score.text).toContain('ingredients.rank_tokens[1]');
    });
});

describe('localTieredSortKey — the `raw` affinity (U6)', () => {
    it('adds the bonus for a query the strategy injected `raw` into', () => {
        const score = keyFor('chives');

        expect(score.params).toContain(RAW_AFFINITY_BONUS);
        // The token itself is a BOUND PARAMETER, like every other value in the key.
        expect(score.params).toContain('raw');
        expect(score.text).toContain('= ANY(ingredients.rank_tokens)');
    });

    it('omits it entirely for a food that is never raw, rather than adding a zero', () => {
        // A `+ 0` term would still be a term: it would put a `raw` comparison into a statement that has
        // nothing to do with it, and the next reader would have to work out that it is inert.
        const score = keyFor('butter');

        expect(score.text).not.toContain('= ANY(ingredients.rank_tokens)');
        expect(score.params).not.toContain('raw');
        expect(score.params).not.toContain(RAW_AFFINITY_BONUS);
    });

    it('⛔ can never cross a rung — the bonus plus the whole base metric is under one tier gap', () => {
        expect(RAW_AFFINITY_BONUS + 1).toBeLessThan(TIER_GAP);
    });
});

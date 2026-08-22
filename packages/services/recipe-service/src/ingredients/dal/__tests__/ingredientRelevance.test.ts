/**
 * Unit tests for the LOCAL Scoring Policy (plan U5) — the SQL mirror of `@kitchensink/recipe-core`'s ranking
 * vocabulary for recipe-service's own `ingredients` table.
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
 * a different failure from the catalog's, on a surface that decided **92.8%** of the import's lines, and it
 * is the one the plan's corrected Problem frame identifies as the likely whole story.
 *
 * ⛔ The base metric still has to be `word_similarity`: KTD-1's `flor` → `All-purpose flour` case scores
 * 0.600 by word similarity and only **0.15** by `similarity`, below the `%` operator's 0.3 threshold. So the
 * fix is a rung above it, not a different metric — the same structure the catalog gets, over a different
 * base.
 *
 * ## Mutation lens
 *
 * Every case fails if the ladder is dropped, if the base metric is swapped for `similarity`, if the raw
 * affinity escapes its rung, if the fold stops mirroring `rankingTerms.ts`, or if a query term is
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
import { LOCAL_RANK_TERMS_ALIAS, localTieredSortKey } from '../ingredientRelevance.js';

const dialect = new PgDialect();

/** Render a fragment exactly as the pg driver receives it, with whitespace runs collapsed. */
function render(fragment: SQL): { readonly text: string; readonly params: readonly unknown[] } {
    const query = dialect.sqlToQuery(sql`SELECT ${fragment}`);

    return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
}

/** Build the sort key the DAL would build for a query. */
function keyFor(query: string): { readonly lateral: SQL; readonly score: SQL } {
    const strategy = selectIngredientMatchStrategy(query);

    if (strategy.kind === 'none') {
        throw new Error(`"${query}" has no searchable token`);
    }

    return localTieredSortKey(strategy, sql`word_similarity(${query}, name)`);
}

describe('localTieredSortKey — the per-row terms lateral', () => {
    const lateral = render(keyFor('brown sugar').lateral);

    it('mirrors `foldForRanking` — case, NFD, combining marks, ASCII whitespace, trim', () => {
        expect(lateral.text).toContain('lower(');
        expect(lateral.text).toContain('normalize(');
        expect(lateral.text).toContain('NFD');
        expect(lateral.text).toContain('btrim(');
        expect(lateral.params).toContain('[\\u0300-\\u036f]');
        expect(lateral.params).toContain('[ \\t\\n\\r\\f\\v]+');
        expect(lateral.params).not.toContain('[[:space:]]+');
    });

    it("folds the LOCAL table's name column, not the catalog's", () => {
        expect(lateral.text).toContain('ingredients.name');
        expect(lateral.text).not.toContain('food.name');
    });

    it('tokenizes in order and applies both arms of the plural rule', () => {
        expect(lateral.text).toContain('WITH ORDINALITY');
        expect(lateral.text).toContain('ORDER BY');
        expect(lateral.params).toContain('(s|x|z|ch|sh)es$');
        expect(lateral.params).toContain('[^s]s$');
    });

    it('computes the row terms ONCE, under a named alias the score refers to', () => {
        expect(lateral.text).toContain(LOCAL_RANK_TERMS_ALIAS);
        expect(render(keyFor('brown sugar').score).text).toContain(`${LOCAL_RANK_TERMS_ALIAS}.`);
    });
});

describe('localTieredSortKey — the tier expression itself', () => {
    const score = render(keyFor('brown sugar').score);

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

describe('localTieredSortKey — the `raw` affinity (U6)', () => {
    it('adds the bonus for a query the strategy injected `raw` into', () => {
        const score = render(keyFor('chives').score);

        expect(score.params).toContain(RAW_AFFINITY_BONUS);
        // The token itself is a BOUND PARAMETER, like every other value in the key.
        expect(score.params).toContain('raw');
        expect(score.text).toContain('= ANY(rank_terms.tokens)');
    });

    it('omits it entirely for a food that is never raw, rather than adding a zero', () => {
        // A `+ 0` term would still be a term: it would put a `raw` comparison into a statement that has
        // nothing to do with it, and the next reader would have to work out that it is inert.
        const score = render(keyFor('butter').score);

        expect(score.text).not.toContain('= ANY(rank_terms.tokens)');
        expect(score.params).not.toContain('raw');
        expect(score.params).not.toContain(RAW_AFFINITY_BONUS);
    });

    it('⛔ can never cross a rung — the bonus plus the whole base metric is under one tier gap', () => {
        expect(RAW_AFFINITY_BONUS + 1).toBeLessThan(TIER_GAP);
    });
});

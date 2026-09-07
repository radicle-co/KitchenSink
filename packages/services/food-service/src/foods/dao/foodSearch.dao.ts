/**
 * `FoodSearchDao` (T-134/T-180/T-198/U37, MOD-001) — the local-store read path for
 * `GET /api/v1/foods/search`. It NEVER calls a source: search is local-only (FR-009), one SQL read with no
 * adapter/registry seam. Only `RESOLVED` foods are surfaced; barcode / `external_key` crosswalk lookup is
 * `FoodSourcesDao`'s, not this module's.
 *
 * DESIGN PATTERN: Strategy, chosen by the pure, database-free {@link selectSearchStrategy} and dispatched
 * exhaustively by {@link FoodSearchDao.search} — the exhaustive switch over the union tag IS the Visitor, so
 * no class hierarchy is added for it. ONE statement, gated by query LENGTH:
 *
 * - **below `MIN_SEARCH_QUERY_LENGTH` → `none`**: no statement runs and no round trip is made.
 * - **at or above it → `relevance`**: ranked FTS over the stored generated `food.search_vector`
 *   (`food_search_vector_idx` GIN, `ts_rank`, word-order-independent) OR'd with the `pg_trgm` GIN indexes as
 *   the fuzzy/substring/typo fallback, and — since plan U5 — ordered by a TIERED sort key layered above that
 *   base metric. The tier ladder is {@link catalogTieredSortKey}'s; see `foodRelevance.ts` for what each rung
 *   means and for the measurements that chose it. ⛔ The ladder changed only the ORDER BY expression: which
 *   rows MATCH is untouched, and the trigram indexes are load-bearing and deliberately non-partial.
 *
 * ## ⛔ WHY THERE IS NO SHORT-QUERY PATH ANY MORE (003-FR-010a, owner ruling 2026-08-24; plan U37)
 *
 * T-198 added a `wordInitialPrefix` strategy so that a 1–2 character query was index-served rather than
 * sequentially scanned — a real and correct fix for the LATENCY of answering a short query. FR-010a removed
 * the question instead: measured against the real 8,094-row catalog a one-character query matches **51%** of
 * rows and a two-character query **23%**, against a surface that shows ten to twenty. At that selectivity
 * the ranking is noise, so an arbitrary slice of the match set is worse than returning nothing — and the
 * cheapest query is the one never issued. The minimum lives in
 * `@kitchensink/recipe-core/resolution/search-minimum` because both clients gate their typeahead on the same
 * number and render the FR-010a empty state instead of firing.
 *
 * ⚠️ Three is the FLOOR, not four: no two-character food name exists in the catalog, but fifteen genuine
 * three-character foods do (`egg`, `ham`, `rye`, `cod`, `soy`, `oat`, `fig`, `yam`, `nut`, `tea`, `pie`,
 * `elk`, `gin`, `rum`, `poi`).
 *
 * ⛔ **Three things went with that strategy, and none of them should come back.** (1) `to_tsquery`, which
 * PARSES its argument — a raw `&`, `|`, `!`, `:`, `(` or `'` raises `syntax error in tsquery`, i.e. a 500 on
 * a keystroke. (2) The hand-rolled character WHITELIST that was the only defence against it; a
 * tsquery-parsing library (`pg-tsquery` and friends) was and remains the WRONG tool, because those exist to
 * give users boolean query SYNTAX, which is exactly the capability that must not reach `to_tsquery` from a
 * search box. (3) The `'simple'`-vs-`'english'` config subtlety, which existed ONLY so a short prefix query
 * would not lose stopwords. The one statement left calls `plainto_tsquery`, which SANITISES rather than
 * parses, so nothing in this module can be handed query syntax. The unit suite asserts that directly.
 *
 * Two branches are deliberately NOT removed (measurements and full reasoning in
 * `specs/003-usda-food-data/tasks.md` T-198/T-202, where the 0004 migration's GIN → GiST trigram index cut
 * the 3+ path roughly 3× without changing any SQL here — an index cannot change which rows match or their
 * order):
 *
 *  - **`name % query` stays.** T-198's "contributes nothing at ANY length" was measured with single-WORD
 *    needles; a multi-word needle clears the 0.3 threshold easily and this branch carries 335 of 364 matched
 *    rows on its own for the `narrow` shape. Dropping it is a product call, not an optimisation.
 *  - **`description ILIKE` stays** despite matching 0 rows that `name ILIKE` did not, because that
 *    redundancy holds only while both ingestion paths set `description := name` — an invariant of the
 *    WRITERS, not of the schema. The `IS DISTINCT FROM` rewrite is provably equivalent but measured no
 *    faster.
 *
 * @implements FR-008 FR-009 FR-010 FR-010a
 */
import { sql, type SQL } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';
import { describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';
import { meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';

import { catalogTieredSortKey } from './foodRelevance.js';

/** Max search rows returned (FR-010). */
const SEARCH_LIMIT = 20;

/**
 * Every character that is SYNTAX to `ILIKE` rather than data: the two wildcards (`%` any run, `_` any single
 * character) and the escape character itself.
 */
const LIKE_METACHARACTERS = /[\\%_]/gu;

/**
 * Wrap a user query as a substring `ILIKE` pattern, escaping every LIKE metacharacter in it.
 *
 * Needed because the pattern is `%<query>%`, so a `%` or `_` the caller typed lands inside it as pattern
 * SYNTAX, and a bound parameter does not help — the metacharacter sits in the parameter's VALUE, which is
 * where `ILIKE` looks for wildcards. `?query=%` bound `'%%%'` and turned one bounded search into a full scan
 * of `food`; `___` matched every 3+ character name. The class is bounded-work / availability, NOT SQL
 * injection — nothing here can leave the string literal.
 *
 * ⛔ It escapes HERE rather than at validation because the validated query feeds three branches and only
 * `ILIKE` takes a pattern: `plainto_tsquery` parses its input into lexemes, and `name % $n` compares a VALUE
 * as text. Escaping at validation would corrupt both — a search for `50% cream` would hunt the literal
 * `50\% cream` in the full-text and trigram branches and find nothing.
 *
 * ⚠️ ONE regex pass, not three sequential replaces: escaping `%` before `\` re-escapes the backslashes just
 * inserted, doubling them. A single left-to-right pass cannot revisit its own output, so the hazard is
 * unrepresentable rather than merely avoided. The statements declare `ESCAPE '\'` explicitly so a pattern's
 * meaning does not depend on server configuration.
 *
 * @param query - The trimmed user query.
 * @returns The substring pattern to bind, for use with `ILIKE … ESCAPE '\'`. Pure.
 */
export function toIlikePattern(query: string): string {
    return `%${query.replace(LIKE_METACHARACTERS, '\\$&')}%`;
}

/** A ranked search row. */
export interface SearchHit {
    /** Internal food id. */
    id: string;
    /** Golden display name. */
    name: string | null;
    /** Relevance score — see {@link SearchStrategy} for the per-strategy definition. */
    score: number;
    /**
     * U11 (R20): the 0013 visibility, carried so the service can flag the CALLER's own authored hits on
     * the wire. Always 'public' for a catalog row; a stranger's private row never leaves the predicate.
     */
    visibility: string;
    /** The authored row's owner, or null for a catalog row — the "is this MY food" comparison key. */
    userId: string | null;
}

/**
 * Which SQL statement a query resolves to (a discriminated union, so the dispatch is exhaustive and the
 * routing decision is testable without a database).
 *
 * - `none` — the query is below `MIN_SEARCH_QUERY_LENGTH`; the caller returns no hits WITHOUT a round
 *   trip (003-FR-010a).
 * - `relevance` — the ranked FTS + `pg_trgm` + curated-alias + head-term statement.
 *
 * ⚠️ A two-member union rather than a boolean on purpose: the tag is what makes {@link FoodSearchDao.search}
 * an exhaustive switch, so a third statement can only be added by visiting every dispatch site.
 */
export type SearchStrategy = { readonly kind: 'none' } | { readonly kind: 'relevance' };

/**
 * Choose the search statement for a query. Pure.
 *
 * ⛔ It does NOT sanitise: every branch of the relevance statement takes its needle as a bound VALUE that
 * Postgres never parses as query syntax (`plainto_tsquery` sanitises, `name % $n` compares text, and the
 * `ILIKE` patterns are escaped where they are BUILT — see {@link toIlikePattern}). The whitelist this
 * function used to apply existed for `to_tsquery`, which is gone; see the module doc.
 *
 * @param query - The trimmed user query.
 * @returns `none` below the FR-010a minimum, otherwise `relevance`.
 */
export function selectSearchStrategy(query: string): SearchStrategy {
    return meetsSearchMinimum(query) ? { kind: 'relevance' } : { kind: 'none' };
}

export class FoodSearchDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Ranked search over `RESOLVED` foods (FR-008/FR-010), gated by query length (FR-010a) — see the class
     * doc for why, what changed, and the measurements. Never calls a source.
     *
     * @param query - The trimmed user query.
     * @param limit - Max rows (default 20).
     * @returns Ranked hits; an empty array when nothing matches, and an empty array with NO round trip when
     *   the query is below `MIN_SEARCH_QUERY_LENGTH`.
     * @sideEffect Reads `food` — only at or above the minimum.
     */
    public async search(query: string, callerId: string, limit: number = SEARCH_LIMIT): Promise<SearchHit[]> {
        const strategy = selectSearchStrategy(query);

        switch (strategy.kind) {
            case 'none':
                return [];

            case 'relevance':
                return this.run(this.relevanceQuery(query, callerId, limit));

            default: {
                const unreachable: never = strategy;

                throw new Error(`unhandled search strategy '${String(unreachable)}'`);
            }
        }
    }

    /**
     * The one search statement. T-202 left it untouched — its fix was the ACCESS PATH the `name %` branch
     * gets (`food_name_trgm_gist_idx`, 0004) and not one character of this SQL — and plan U5 changed only
     * the SORT KEY.
     * See the class doc for the per-branch cost table and for why neither `name %` nor `description ILIKE`
     * may be removed here. A row matches when EITHER the ranked FTS path
     * hits (`search_vector @@ plainto_tsquery('english', query)` — word-order-independent lexeme match
     * over name + description) OR the pg_trgm fuzzy fallback hits (trigram-similar name `%`, or a
     * name/description substring `ILIKE`), **or the curated-alias vector hits** (U2). The score is
     * `GREATEST(ts_rank(search_vector), ts_rank(aliases_search_vector), similarity(name))` so a strong
     * full-text relevance, a curated synonym, OR a strong fuzzy/typo match all rank a row up; ties break
     * on name. Pure.
     *
     * ⛔ The alias branch must appear in BOTH the predicate and the score. In the predicate alone, an
     * alias-only hit matches at score 0 and is truncated out of the 20-row page by the `ORDER BY` — a
     * silent failure a "does it match?" test cannot see. One `GREATEST`, which is also the sort key, so
     * the ranking keeps exactly one authority.
     *
     * ⛔ Aliases get a tsvector and NOTHING else: no `%`, no `ILIKE`. The `name %` branch alone was 30.5ms
     * of a 45.8ms statement before 0004 gave it a GiST index; a fourth substring branch over a second
     * free-text column is per-row cost SC-007's 250ms budget has no room for.
     *
     * ⚠️ **U5 wraps that `GREATEST` rather than replacing it.** It becomes the BASE METRIC of a tiered sort
     * key (`foodRelevance.ts`): `score = (TIER_GAP x tier + clamp(base)) / SCORE_CEILING`. Two consequences
     * worth knowing before editing this statement. First, the tier reads `food.rank_folded` and
     * `food.rank_tokens` — two STORED generated columns migration 0008 adds — so it adds a handful of array
     * comparisons per matched row and NOT a fold; the per-row form measured 253–357ms at 50,000 rows against
     * SC-007's 200ms budget and was rejected on that measurement. The `WHERE` and every index it uses are
     * untouched (asserted at 100,000 rows by `tests/foodSearchAccessPath.integration.test.ts`, which
     * captures this very statement). Second, the score is NORMALIZED into `[0, 1)` on purpose:
     * `FoodsService.search` unshifts a barcode / external-key crosswalk hit at score exactly `1`, and
     * recipe-service's `FoodCatalogGateway` re-sorts the page by score — an un-normalized tiered score would
     * reach 9 and silently demote an exact identifier match below a lexical one.
     *
     * @param query - The trimmed user query.
     * @param limit - Max rows.
     * @returns The composable statement.
     */
    private relevanceQuery(query: string, callerId: string, limit: number): SQL {
        // Escaped HERE, at the one place a PATTERN is built — see `toIlikePattern` for why not at validation
        // (the same `query` is bound raw below, where it is a value rather than a pattern).
        const pattern = toIlikePattern(query);

        // The BASE metric, unchanged by U5: the strongest of full-text relevance, curated-alias relevance
        // and trigram similarity. The tier ladder is layered ABOVE it, never in place of it (KTD-1).
        const baseMetric = sql`GREATEST(
                       ts_rank(search_vector, plainto_tsquery('english', ${query})),
                       ts_rank(aliases_search_vector, plainto_tsquery('english', ${query})),
                       similarity(name, ${query})
                   )`;
        // U5: the consumption prior rides a LEFT JOIN — an absent row IS a prior of zero, so foods
        // without measured consumption rank exactly as before.
        const score = catalogTieredSortKey(query, baseMetric, sql`COALESCE(fp.prior_fraction, 0::float8)`);

        // ⛔ HEAD-TERM RETRIEVAL. U6 widened retrieval with a head-term branch and put it on the recipe-LOCAL
        // table (`IngredientsDal.search`); its plan entry names two files, both in recipe-service. The
        // catalog kept the five clauses below, and on 2026-08-22 that set was measured against 8,094 real
        // USDA foods: `jalapeño` returned NOTHING (trigram 0.250 against the 0.3 threshold — 0.429 folded),
        // `Kerrygold butter` returned NOTHING (the tsquery conjunction needs `kerrygold`; trigram 0.292,
        // short by 0.008), and `Fresh oregano` returned `Basil, fresh` because `fresh & oregano` matched no
        // row and both hits were earned on the modifier rather than the food.
        //
        // `rank_tokens` is already the name's FOLDED, SINGULARIZED token array (migration 0008), so one
        // containment test is head-term retrieval and diacritic folding at once — and it reuses the same
        // `describeRankingQuery` the ranking above already calls, so retrieval and ranking cannot disagree
        // about what the head term is. ⛔ Deliberately NOT `unaccent`: 0008 rejected it because its rules
        // file is not NFD and could not be mirrored in TypeScript.
        //
        // ⚠️ It widens the CANDIDATE set only. The tier ladder still decides the order, so a head-term hit
        // that is a poor match lands on a low rung rather than jumping the queue.
        const head = describeRankingQuery(query).head;
        const headTerm = head === undefined ? sql`` : sql` OR rank_tokens @> ARRAY[${head}]::text[]`;

        return sql`
            SELECT food.id, food.name, food.user_id, food.visibility, ${score} AS score
            FROM food
            LEFT JOIN food_popularity fp ON fp.food_id = food.id
            WHERE status = 'RESOLVED'
              -- R20 (plan U11): catalog rows for everyone, the CALLER's own authored rows for the caller,
              -- promoted rows for everyone (U12's outcome, admitted here already). A stranger's search can
              -- never receive another user's private row — the predicate is the privacy boundary.
              AND (user_id IS NULL OR user_id = ${callerId} OR visibility = 'promoted')
              AND name IS NOT NULL
              AND (
                  search_vector @@ plainto_tsquery('english', ${query})
                  OR aliases_search_vector @@ plainto_tsquery('english', ${query})
                  OR name % ${query}
                  OR name ILIKE ${pattern} ESCAPE '\\'
                  OR description ILIKE ${pattern} ESCAPE '\\'
                  ${headTerm}
              )
            ORDER BY score DESC, name ASC
            LIMIT ${limit}
        `;
    }

    /**
     * Execute a search statement and narrow its rows to {@link SearchHit}s.
     *
     * @param statement - The statement to run.
     * @returns The ranked hits.
     * @sideEffect Reads `food`.
     */
    private async run(statement: SQL): Promise<SearchHit[]> {
        const result = await this.db.execute<{
            id: string;
            name: string | null;
            score: number;
            visibility: string;
            user_id: string | null;
        }>(statement);

        return result.rows.map((row) => ({
            id: row.id,
            name: row.name,
            score: Number(row.score),
            visibility: row.visibility,
            userId: row.user_id,
        }));
    }
}

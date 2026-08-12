/**
 * `FoodSearchDao` (T-134/T-180/T-198, MOD-001) — the local-store search read path for
 * `GET /api/v1/foods/search`. It NEVER calls a source — search is local-only (FR-009), a single SQL read
 * with no adapter/registry seam. Only `RESOLVED` foods are surfaced (a served golden record has a golden
 * `name`); in-flight/terminal rows are excluded. Barcode / `external_key` crosswalk lookup is handled by
 * {@link FoodSourcesDao} in the service, not here.
 *
 * ## Two statements, selected by query LENGTH (T-198) — and one of them changed the semantics
 *
 * Search is a **Strategy** chosen by {@link selectSearchStrategy}: a pure, database-free routing decision
 * returning a discriminated union that {@link FoodSearchDao.search} dispatches on exhaustively (the
 * exhaustive switch over the tag IS the Visitor — no polymorphic class hierarchy is added for it).
 *
 * - **3+ characters → `relevance` (UNCHANGED).** Ranked full-text search (the STORED generated
 *   `food.search_vector` + `food_search_vector_idx` GIN index, `ts_rank` relevance, word-order-independent
 *   lexeme matching) OR'd with the `pg_trgm` GIN indexes (`food_name_trgm_idx` /
 *   `food_description_trgm_idx`) as the fuzzy/substring/typo fallback.
 * - **1–2 characters → `wordInitialPrefix` (NEW, and a DELIBERATE SEMANTIC CHANGE).** Word-initial prefix
 *   matching over the SAME `food_search_vector_idx`, via `to_tsquery('simple', '<token>:*')`.
 *
 * ### Why the short path exists at all (measured, T-195 → T-198)
 *
 * Below 3 characters the `relevance` statement is a **guaranteed sequential scan**, because every one of
 * its four branches is dead or unservable at that length:
 *
 *  1. `name ILIKE '%ch%'` / `description ILIKE '%ch%'` cannot use a trigram index — a pattern with fewer
 *     than 3 characters between the wildcards yields no complete trigram, so `pg_trgm` has nothing to
 *     look up and the planner falls back to a full scan.
 *  2. `search_vector @@ plainto_tsquery('english', 'ch')` matches NOTHING: the stored vector holds
 *     stemmed lexemes and `plainto_tsquery` is exact-lexeme-after-stemming, so `ch` never matches
 *     `chicken`. Measured: 0 rows for every 1–2 character query.
 *  3. `name % 'ch'` (trigram similarity) also matches nothing — a 2-character needle against a golden
 *     name scores ~0.06 against the 0.3 `pg_trgm` threshold. (Measured at 0.25 even for `chicken`
 *     against a 45-character name, i.e. this branch contributes nothing at ANY length on realistic
 *     names; that is a separate finding, deliberately NOT changed here.)
 *  4. Worse, a 1–2 character query that is an English **stopword** (`a`, `be`, `it`, `on`, `is`) stems to
 *     an EMPTY tsquery under the `english` config, so branch 2 is not merely unhelpful but void.
 *
 * Measured on a 50,000-`RESOLVED`-food store shaped like the deployed one (see the numbers table in
 * `specs/003-usda-food-data/tasks.md` T-198): `b` → **156.5ms** sequential scan, `ch` → **134.2ms**,
 * against SC-007's 200ms p95 budget. After: **13.6ms** and **6.2ms**, on an index the schema already had.
 *
 * ### Why `'simple'` and not `'english'` (do not "fix" this to match the stored vector's config)
 *
 * The stored `search_vector` is built with `english`, but the QUERY side here MUST use `simple`. Prefix
 * matching compares stored lexeme TEXT, so `'ch':*` still matches the english-stemmed lexeme `chicken`;
 * what `simple` buys is that it does **not** discard stopwords, so `to_tsquery('simple', 'be:*')` is a
 * real query that finds `Beef, ground` while `to_tsquery('english', 'be:*')` is EMPTY and finds nothing.
 * Swapping the config back re-introduces failure mode 4 above for every short stopword query.
 *
 * ### Why the token is whitelisted in application code (never interpolated)
 *
 * `to_tsquery` PARSES its argument, so a raw `&`, `|`, `!`, `:`, `(` or `'` raises
 * `syntax error in tsquery` — a 500 on a keystroke. {@link selectSearchStrategy} therefore reduces the
 * query to letters and digits before appending the `:*` prefix marker, and the value still travels as a
 * bound parameter. A tsquery-parsing library (`pg-tsquery` and friends) is the wrong tool here: those
 * exist to give users boolean query SYNTAX, which is precisely the capability that must NOT reach
 * `to_tsquery` from a search box.
 *
 * ### What the 3+ character statement COSTS, and where that cost lives (T-202, measured)
 *
 * The statement's price is not the ranking and not the number of rows returned — it is the ACCESS PATH the
 * `name % query` branch gets. Measured on the 50,000-food store CI seeds (`EXPLAIN (ANALYZE, BUFFERS)`,
 * warm, best of seven):
 *
 * | part of the statement                                  | cost of a `raw chicken breast` search |
 * | ------------------------------------------------------ | ------------------------------------- |
 * | `name % query` — index scan + rechecking 9,754 rows    | **30.5ms**                            |
 * | `description ILIKE` — index scan + recheck             | 6.1ms                                 |
 * | FTS + `name ILIKE` — index scans + recheck             | 2.4ms                                 |
 * | `ORDER BY score DESC, name ASC` over all 364 matches   | **0.14ms**                            |
 *
 * So "stop ranking rows that cannot reach the `LIMIT 20`" — T-202's recorded candidate — would have bought
 * 0.3% of the statement. What actually cost 66% of it: `food_name_trgm_idx` (GIN) answers `%` by admitting
 * every row sharing `ceil(0.3 x n_query_trigrams)` trigrams, which returned **9,758 candidates for 368 true
 * matches**, and the bitmap heap scan then re-evaluated the predicate — a fresh `similarity()` call, 2.19µs
 * each — on the 9,754 it discarded, touching all 4,250 heap blocks of the table. The 0004 migration adds a
 * **GiST** trigram index on the same column, which answers the same operator with 368 candidates: the
 * `narrow` shape 45.8ms → 14.6ms, `phrase` 44.4ms → 11.1ms (CI's build order; 12.4/9.9ms when the index is
 * created after the rows instead of by them). **No SQL here changed**, because an index
 * cannot change which rows match or their order (`%` is rechecked from the heap) — which is exactly why
 * this was the fix available: per T-198, anything that moves rows or ranks is a product decision.
 *
 * Two things NOT done, deliberately, and both are recorded in `specs/003-usda-food-data/tasks.md` T-202:
 *
 *  - **`name % query` is NOT removed.** T-198's finding 4 said it "contributes nothing at ANY length"; that
 *    was measured with single-WORD needles against long names. A multi-word needle is a large fraction of
 *    the name, so it clears the 0.3 threshold easily — for `narrow` this branch carries **335 of the 364
 *    matched rows on its own**. Dropping it is a product call, not an optimisation.
 *  - **`description ILIKE` is NOT removed** even though it matched **0 rows** that `name ILIKE` did not, on
 *    both fixture shapes. That redundancy holds only because both ingestion paths set `description := name`
 *    — an invariant of the writers, not of the schema — so removing the branch would change results for any
 *    row where the two differ. `name ILIKE p OR (description IS DISTINCT FROM name AND description ILIKE p)`
 *    IS provably equivalent, but measured no faster: it does not let the planner skip the index scan.
 *
 * ### The semantic change, stated plainly (FR-008/FR-010)
 *
 * A 1–2 character query used to match **mid-word** (`ch` matched `ranch`, `spinach`, and `Salmon` for
 * `on`) ranked by trigram-similarity noise. It now matches **word-initially** (`ch` → `Chicken`,
 * `Cheddar cheese`, `ground chuck`) and no longer matches `ranch`. Word-initial matching is the intended
 * autocomplete behaviour; the accepted consequence is that a short query which only occurred mid-word now
 * returns nothing. 3+ character queries keep mid-word matching, unchanged.
 *
 * @implements FR-008 FR-009 FR-010
 */
import { sql, type SQL } from 'drizzle-orm';

import type { FoodDrizzle } from '../../database/database.module.js';

/** Max search rows returned (FR-010). */
const SEARCH_LIMIT = 20;

/**
 * Longest query, in characters, routed to the word-initial prefix statement.
 *
 * The boundary IS the trigram: `pg_trgm` extracts no complete trigram from a pattern with fewer than 3
 * characters between wildcards, so at 1–2 characters the `ILIKE` branches cannot be index-served at all
 * (they scan), while at 3 they can. Raising this would needlessly narrow working substring search;
 * lowering it re-opens the sequential scan for 2-character queries.
 */
const SHORT_QUERY_MAX_CHARACTERS = 2;

/** Everything that is not a letter or a digit — i.e. every `to_tsquery` metacharacter, and whitespace. */
const NON_SEARCHABLE = /[^\p{L}\p{N}]/gu;

/**
 * Weight of the name-initial bonus in the short-query score. A name-initial hit therefore always
 * outranks a merely word-initial one (the length term below can never reach it).
 */
const NAME_INITIAL_WEIGHT = 0.5;

/**
 * Every character that is SYNTAX to `ILIKE` rather than data: the two wildcards (`%` any run, `_` any single
 * character) and the escape character itself.
 */
const LIKE_METACHARACTERS = /[\\%_]/gu;

/**
 * Wrap a user query as a substring `ILIKE` pattern, with every LIKE metacharacter in it escaped.
 *
 * ## Why this exists
 *
 * The pattern is `%<query>%`, so a `%` or `_` the caller typed lands inside it as PATTERN SYNTAX. Bound
 * parameters do not help — the metacharacter sits in the parameter's VALUE, which is exactly where `ILIKE`
 * looks for wildcards. `?query=%` therefore bound `'%%%'`, a pattern matching every row that has a name, so
 * one request turned a bounded search into a full scan of `food`; `___` matched every 3+ character name; and
 * alternating `%_` multiplies the per-row recheck the GIN bitmap heap scan performs. The class is
 * bounded-work / availability, not SQL injection — nothing here can leave the string literal.
 *
 * ## Why it escapes HERE, and not at validation
 *
 * The validated query feeds three branches of one statement, and only one of them is a pattern:
 *
 *  - `name ILIKE $n` / `description ILIKE $n` — a PATTERN. Needs escaping.
 *  - `plainto_tsquery('english', $n)` — already safe by construction: it parses its input into lexemes and
 *    discards operator syntax rather than honouring it.
 *  - `name % $n` (pg_trgm similarity) — a VALUE, compared as text. Not a pattern at all.
 *
 * Escaping at validation time would corrupt the latter two: a search for `50% cream` would look for the
 * literal characters `50\% cream` in the full-text and trigram branches and find nothing. So the query stays
 * raw everywhere it is a value, and the escape belongs to the one place a pattern is constructed.
 *
 * ## Why ONE pass and not three replaces
 *
 * The obvious implementation is `\`, then `%`, then `_` — and that order is load-bearing only BECAUSE it is
 * sequential: escaping `%` before `\` re-escapes the backslashes just inserted, doubling them. A single
 * left-to-right regex pass cannot revisit its own output, so the hazard is not merely avoided, it is
 * unrepresentable. `$&` re-emits whichever metacharacter matched.
 *
 * The statements declare `ESCAPE '\'` explicitly rather than relying on Postgres' default, so a pattern's
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
}

/**
 * Which SQL statement a query resolves to (a discriminated union, so the dispatch is exhaustive and the
 * routing decision is testable without a database).
 *
 * - `none` — nothing searchable survived sanitisation; the caller returns no hits WITHOUT a round trip.
 * - `wordInitialPrefix` — the 1–2 character path; `tsquery` is `<token>:*` and `token` is the sanitised
 *   needle used to rank name-initial hits first.
 * - `relevance` — the pre-existing 3+ character ranked FTS + `pg_trgm` fallback statement.
 */
export type SearchStrategy =
    | { readonly kind: 'none' }
    | { readonly kind: 'wordInitialPrefix'; readonly tsquery: string; readonly token: string }
    | { readonly kind: 'relevance' };

/**
 * Choose the search statement for a query. Pure.
 *
 * @param query - The trimmed user query.
 * @returns The strategy to execute; `none` when a short query holds no letter or digit.
 */
export function selectSearchStrategy(query: string): SearchStrategy {
    // Characters, not UTF-16 code units: a single astral character must not read as a 2-character query.
    if ([...query].length > SHORT_QUERY_MAX_CHARACTERS) {
        return { kind: 'relevance' };
    }

    const token = query.replace(NON_SEARCHABLE, '');

    if (token.length === 0) {
        return { kind: 'none' };
    }

    return { kind: 'wordInitialPrefix', tsquery: `${token}:*`, token };
}

export class FoodSearchDao {
    public constructor(private readonly db: FoodDrizzle) {}

    /**
     * Ranked search over `RESOLVED` foods (FR-008/FR-010), routed by query length — see the class doc for
     * why, what changed, and the measurements. Never calls a source.
     *
     * @param query - The trimmed user query.
     * @param limit - Max rows (default 20).
     * @returns Ranked hits, or an empty array when nothing matches.
     * @sideEffect Reads `food`.
     */
    public async search(query: string, limit: number = SEARCH_LIMIT): Promise<SearchHit[]> {
        const strategy = selectSearchStrategy(query);

        switch (strategy.kind) {
            case 'none':
                return [];

            case 'wordInitialPrefix':
                return this.run(this.wordInitialPrefixQuery(strategy, limit));

            case 'relevance':
                return this.run(this.relevanceQuery(query, limit));

            default: {
                const unreachable: never = strategy;

                throw new Error(`unhandled search strategy '${String(unreachable)}'`);
            }
        }
    }

    /**
     * The 1–2 character word-initial prefix statement (T-198). Pure.
     *
     * The score expression is ALSO the sort key (referenced by its output alias), so the ranking has ONE
     * authoritative definition and cannot drift from the order rows come back in. That matters beyond
     * tidiness: `FoodCatalogGateway` in the recipe service re-sorts hits by `score DESC, name ASC`, so a
     * constant or non-monotone score would silently discard this ranking downstream. The score is
     * {@link NAME_INITIAL_WEIGHT} for a name-initial hit plus a strictly-decreasing function of name
     * length, which keeps it inside `(0, 1)` — below the `1` the service assigns a barcode/external-key
     * crosswalk hit, so a crosswalk match still sorts first.
     *
     * Ranking, in order: a hit whose NAME starts with the needle (what a user typing two letters means),
     * then the shortest name (in a USDA catalogue the short names are the generic staples — `Egg, whole,
     * raw` before `Barbecue marinated grilled boneless chicken thigh pieces`), then `name` for a
     * deterministic tie break. `length(...)` and `lower(...)` are Postgres', so case folding and character
     * counting have one authority and cannot diverge from a JS approximation of them.
     *
     * @param strategy - The selected prefix strategy.
     * @param limit - Max rows.
     * @returns The composable statement.
     */
    private wordInitialPrefixQuery(
        strategy: Extract<SearchStrategy, { kind: 'wordInitialPrefix' }>,
        limit: number,
    ): SQL {
        return sql`
            SELECT id, name,
                   (CASE WHEN lower(left(name, length(${strategy.token}::text))) = lower(${strategy.token}::text)
                         THEN ${NAME_INITIAL_WEIGHT}::float8 ELSE 0::float8 END
                    + ${NAME_INITIAL_WEIGHT}::float8 / (1 + length(name)))::float8 AS score
            FROM food
            WHERE status = 'RESOLVED'
              AND name IS NOT NULL
              AND search_vector @@ to_tsquery('simple', ${strategy.tsquery}::text)
            ORDER BY score DESC, name ASC
            LIMIT ${limit}
        `;
    }

    /**
     * The pre-existing 3+ character statement, unchanged — including by T-202, whose fix was the ACCESS
     * PATH the `name %` branch gets (`food_name_trgm_gist_idx`, 0004) and not one character of this SQL.
     * See the class doc for the per-branch cost table and for why neither `name %` nor `description ILIKE`
     * may be removed here. A row matches when EITHER the ranked FTS path
     * hits (`search_vector @@ plainto_tsquery('english', query)` — word-order-independent lexeme match
     * over name + description) OR the pg_trgm fuzzy fallback hits (trigram-similar name `%`, or a
     * name/description substring `ILIKE`). The score is `GREATEST(ts_rank, similarity(name))` so a strong
     * full-text relevance OR a strong fuzzy/typo match both rank a row up; ties break on name. Pure.
     *
     * @param query - The trimmed user query.
     * @param limit - Max rows.
     * @returns The composable statement.
     */
    private relevanceQuery(query: string, limit: number): SQL {
        // Escaped HERE, at the one place a PATTERN is built — see `toIlikePattern` for why not at validation
        // (the same `query` is bound raw below, where it is a value rather than a pattern).
        const pattern = toIlikePattern(query);

        return sql`
            SELECT id, name,
                   GREATEST(
                       ts_rank(search_vector, plainto_tsquery('english', ${query})),
                       similarity(name, ${query})
                   )::float8 AS score
            FROM food
            WHERE status = 'RESOLVED'
              AND name IS NOT NULL
              AND (
                  search_vector @@ plainto_tsquery('english', ${query})
                  OR name % ${query}
                  OR name ILIKE ${pattern} ESCAPE '\\'
                  OR description ILIKE ${pattern} ESCAPE '\\'
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
        const result = await this.db.execute<{ id: string; name: string | null; score: number }>(statement);

        return result.rows.map((row) => ({ id: row.id, name: row.name, score: Number(row.score) }));
    }
}

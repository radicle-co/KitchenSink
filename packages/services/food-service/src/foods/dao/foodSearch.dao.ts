/**
 * `FoodSearchDao` (T-134/T-180/T-198, MOD-001) — the local-store read path for
 * `GET /api/v1/foods/search`. It NEVER calls a source: search is local-only (FR-009), one SQL read with no
 * adapter/registry seam. Only `RESOLVED` foods are surfaced; barcode / `external_key` crosswalk lookup is
 * `FoodSourcesDao`'s, not this module's.
 *
 * DESIGN PATTERN: Strategy, chosen by the pure, database-free {@link selectSearchStrategy} and dispatched
 * exhaustively by {@link FoodSearchDao.search} — the exhaustive switch over the union tag IS the Visitor, so
 * no class hierarchy is added for it. Two statements, selected by query LENGTH (T-198):
 *
 * - **3+ characters → `relevance`** (unchanged): ranked FTS over the stored generated `food.search_vector`
 *   (`food_search_vector_idx` GIN, `ts_rank`, word-order-independent) OR'd with the `pg_trgm` GIN indexes as
 *   the fuzzy/substring/typo fallback.
 * - **1–2 characters → `wordInitialPrefix`** — NEW, and a DELIBERATE SEMANTIC CHANGE: word-initial prefix
 *   matching over the same vector via `to_tsquery('simple', '<token>:*')`.
 *
 * ⚠️ The short path exists because below 3 characters `relevance` is a GUARANTEED sequential scan — every
 * branch is dead at that length: `ILIKE '%ch%'` yields no complete trigram so `pg_trgm` has nothing to look
 * up; `plainto_tsquery('english', 'ch')` is exact-lexeme-after-stemming so it matches nothing; `name % 'ch'`
 * scores ~0.06 against the 0.3 threshold; and a 1–2 character English STOPWORD stems to an EMPTY tsquery,
 * making that branch void rather than merely unhelpful. Measured at 50,000 foods: `b` 156.5ms → 13.6ms,
 * `ch` 134.2ms → 6.2ms against SC-007's 200ms budget, on an index the schema already had.
 *
 * ⛔ `'simple'` on the QUERY side is deliberate — do not "fix" it to match the stored vector's `english`
 * config. Prefix matching compares stored lexeme TEXT, so `'ch':*` still matches the english-stemmed
 * `chicken`; what `simple` buys is that it does not discard stopwords, so `to_tsquery('simple', 'be:*')`
 * finds `Beef, ground` where the `english` form is EMPTY. Swapping it back re-introduces the stopword hole.
 *
 * ⛔ The token is whitelisted to letters and digits in application code before the `:*` marker is appended,
 * and still travels as a bound parameter, because `to_tsquery` PARSES its argument: a raw `&`, `|`, `!`, `:`,
 * `(` or `'` raises `syntax error in tsquery` — a 500 on a keystroke. A tsquery-parsing library
 * (`pg-tsquery` and friends) is the WRONG tool: those exist to give users boolean query SYNTAX, which is
 * exactly the capability that must not reach `to_tsquery` from a search box.
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
 * The semantic change, stated plainly (FR-008/FR-010): a 1–2 character query used to match MID-word (`ch`
 * matched `ranch`; `on` matched `Salmon`) ranked by trigram noise, and now matches WORD-INITIALLY (`ch` →
 * `Chicken`, `Cheddar cheese`, `ground chuck`). Accepted consequence: a short query that only occurred
 * mid-word now returns nothing. 3+ character queries keep mid-word matching.
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
 * ⚠️ The boundary IS the trigram: `pg_trgm` extracts no complete trigram from a pattern with fewer than 3
 * characters between wildcards, so at 1–2 characters the `ILIKE` branches can only scan. Raising this
 * narrows working substring search; lowering it re-opens the sequential scan for 2-character queries.
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
                       ts_rank(aliases_search_vector, plainto_tsquery('english', ${query})),
                       similarity(name, ${query})
                   )::float8 AS score
            FROM food
            WHERE status = 'RESOLVED'
              AND name IS NOT NULL
              AND (
                  search_vector @@ plainto_tsquery('english', ${query})
                  OR aliases_search_vector @@ plainto_tsquery('english', ${query})
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

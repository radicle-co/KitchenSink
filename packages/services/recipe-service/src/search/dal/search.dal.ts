/**
 * T042 — `SearchDal`: full-text ranked search + facet aggregation over the golden `recipes` table.
 *
 * A single logical search resolves to three raw reads over the injected Drizzle client (mirroring the
 * ingredients vertical's `db.execute` + `sql` style, over the `recipes` GIN indexes from
 * `migrations/0001_initial.sql`):
 *
 *   1. **Page** — the ranked, paginated hits. Relevance is `ts_rank(search_vector, plainto_tsquery(…))`
 *      when a `query` is present (word-order-independent FTS over the trigger-maintained weighted
 *      `search_vector`); with no query the read degrades to a plain visibility-scoped browse.
 *   2. **Count** — the unpaged total matching the SAME predicate, for the `hasMore` envelope upstream.
 *   3. **Facets** — a **rank-sampling CTE** (the top `FACET_SAMPLE_SIZE` matches by rank) whose
 *      `dietary_flags` / `tags` arrays are `unnest`-ed into grouped counts, so the UI can render facet
 *      chips without scanning the entire match set.
 *
 * Every read is scoped to rows the caller may see — `public` OR owned by `ownerId` — and always excludes
 * tombstones (`deleted_at IS NULL`), matching the recipes vertical's read rules. Rows are returned
 * already mapped to the canonical `@kitchensink/recipe-core` `Recipe` shape; `search_vector` is never
 * projected.
 *
 * @sideEffect Every `search` call reads `recipes` (and `recipe_ingredients` when filtering by ingredient).
 */
import { sql, type SQL } from 'drizzle-orm';
import { RecipeSearchSortBy } from '@kitchensink/recipe-core';
import type { Recipe, RecipeFacetCount, RecipeSearchResult } from '@kitchensink/recipe-core';

// The CONTRACT owns this shape (it is a public response-body field); the DAL merely computes a value of
// it. It used to be declared and exported here, which made a data-access internal define the public API.
import type { RecipeSearchFacets } from '../search.schema.js';

import type { RecipeDrizzle } from '../../database/client.js';
import { clampPage, clampPageSize, DEFAULT_PAGE_SIZE } from '../../common/pagination.js';
import { activeRecipe, publishedOrOwnedBy, viewableBy } from '../../recipes/dal/recipePredicates.js';
import { recipeRowToDomain, type RecipeRowInput } from '../../recipes/mappers/recipeRowToDomain.js';
import { resolveCdnUrl } from '../../photos/photoView.js';

/** Default page size when the caller does not specify one — the shared S-R8 default (20). */
export const DEFAULT_SEARCH_PAGE_SIZE = DEFAULT_PAGE_SIZE;

// ⛔ `MAX_SEARCH_PAGE_SIZE` IS NOT DECLARED HERE ANY MORE. It is a WIRE bound — `recipeSearchQuerySchema`
// publishes it and rejects above it — and it lived here as `export const MAX_SEARCH_PAGE_SIZE = MAX_PAGE_SIZE`
// with the query DTO importing it, which made a data-access module the source of a published constraint. That is
// the same backwards dependency `../search.schema.ts`'s header records for `RecipeSearchFacets`, and the fix is
// the same one: the bound lives in `@kitchensink/recipe-core` and this module consumes it like any other reader.
// `MAX_PAGE_SIZE` below remains the INTERNAL clamp shared with the collections and recipes lists; the two are
// asserted equal in `../__tests__/pageSizeBound.test.ts`.

// Re-exported so existing importers (this module's own `search()` and this module's tests) keep resolving
// `clampPage`/`clampPageSize` from `search.dal.js` unchanged — the S-R8 clamps themselves now live once, in
// `../../common/pagination.js`.
export { clampPage, clampPageSize };

/**
 * How many top-ranked matches the facet CTE samples before aggregating. Facet counts are computed over
 * this rank-ordered sample (not the whole match set) so a broad query stays cheap; the chips still
 * reflect the most relevant slice of results.
 */
export const FACET_SAMPLE_SIZE = 200;

/**
 * The largest facet sample the {@link SearchDal} constructor will accept.
 *
 * A ceiling rather than an exact equality check, because the size is deliberately injectable (tests drive the
 * sampling boundary with a handful of rows). What it rules out is the value that would make every search scan
 * the table — the facet CTE runs on EVERY search request, so an absurd sample here is a whole-service
 * performance fault, not a slow query in one place. Set well above {@link FACET_SAMPLE_SIZE} so tuning the
 * default upward stays possible without touching this bound.
 */
export const MAX_FACET_SAMPLE_SIZE = 10_000;

/**
 * The explicit `recipes` projection returned by the page read — deliberately excludes `search_vector`.
 * Every name is qualified `recipes.` because the page read joins a cover-photo LATERAL (see below), so a
 * bare column list would be ambiguous once another relation is in scope.
 */
const RECIPE_COLUMNS = sql`
    recipes.id, recipes.owner_id, recipes.title, recipes.description, recipes.prep_time_minutes,
    recipes.cook_time_minutes, recipes.total_time_minutes, recipes.servings, recipes.difficulty,
    recipes.average_rating, recipes.rating_count, recipes.visibility, recipes.status, recipes.source_type,
    recipes.source_url, recipes.source_attribution, recipes.cloned_from_id, recipes.has_substantive_edit,
    recipes.cuisine, recipes.dietary_flags, recipes.tags, recipes.has_partial_nutrition,
    recipes.lead_calories_per_serving, recipes.author_handle, recipes.current_version, recipes.ingredient_names_text,
    recipes.deleted_at, recipes.created_at, recipes.updated_at`;

/** Everything the DAL needs to build one ranked, filtered, paginated search. */
export interface RecipeSearchFilters {
    /** The caller's app-user ULID — the owner key that widens visibility beyond `public`. */
    readonly ownerId: string;
    /** Free-text query (FTS). Absent/blank → browse mode (no `search_vector` predicate). */
    readonly query?: string;
    /** Exact cuisine filter. */
    readonly cuisine?: string;
    /** Require ALL of these dietary flags (array containment). */
    readonly dietaryFlags?: readonly string[];
    /** Require ALL of these tags (array containment). */
    readonly tags?: readonly string[];
    /** Upper bound on `prep_time_minutes` (rows with unknown prep time are excluded). */
    readonly maxPrepTime?: number;
    /** Upper bound on `cook_time_minutes` (rows with unknown cook time are excluded). */
    readonly maxCookTime?: number;
    /** Upper bound on `total_time_minutes` (rows with unknown total time are excluded). */
    readonly maxTotalTime?: number;
    /** Require the recipe to contain ANY of these ingredient ids (via `recipe_ingredients`). */
    readonly ingredientIds?: readonly string[];
    /** 1-based page number. */
    readonly page: number;
    /** Page size (clamped to `[1, MAX_PAGE_SIZE]`). */
    readonly pageSize: number;
    /** Result ordering. */
    readonly sortBy: RecipeSearchSortBy;
}

/** What {@link SearchDal.search} returns: the ranked page, its facets, and the unpaged total. */
export interface RecipeSearchDalResult {
    readonly results: RecipeSearchResult[];
    readonly facets: RecipeSearchFacets;
    readonly total: number;
}

/**
 * The raw (snake_case) `recipes` row shape returned by the page `db.execute`. The index signature
 * satisfies Drizzle's `execute<T extends Record<string, unknown>>` constraint while the named fields
 * keep {@link rowToRecipe} fully typed.
 */
interface RawRecipeSearchRow {
    [column: string]: unknown;
    id: string;
    owner_id: string;
    title: string;
    description: string | null;
    prep_time_minutes: number | null;
    cook_time_minutes: number | null;
    total_time_minutes: number | null;
    servings: number;
    difficulty: string | null;
    average_rating: string | null;
    rating_count: number;
    visibility: string;
    status: string;
    source_type: string;
    source_url: string | null;
    source_attribution: string | null;
    cloned_from_id: string | null;
    has_substantive_edit: boolean;
    cuisine: string | null;
    dietary_flags: string[];
    tags: string[];
    has_partial_nutrition: boolean;
    lead_calories_per_serving: string | null;
    author_handle: string | null;
    current_version: number;
    ingredient_names_text: string;
    deleted_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
    cover_photo_key: string | null;
    rank: number | string | null;
}

/** The raw row shape returned by the facet CTE. */
interface RawFacetRow {
    [column: string]: unknown;
    facet: string;
    value: string;
    count: number | string;
}

/** Coerce a nullable ranking value (pg may return `real` as number or string) to a number/undefined. Pure. */
function rankToNumber(value: number | string | null): number | undefined {
    return value === null ? undefined : Number(value);
}

/**
 * Adapt the raw snake_case CTE row into the canonical mapper's normalized {@link RecipeRowInput} shape —
 * a cheap field-rename, NOT a re-encode of any field RULE (no coercion/omission happens here; that is
 * entirely {@link recipeRowToDomain}'s job). The CTE itself stays raw SQL (FTS/rank need it); only this
 * adapter bridges it to the ONE shared row→domain mapper. Pure.
 */
function toRecipeRowInput(row: RawRecipeSearchRow): RecipeRowInput {
    return {
        id: row.id,
        ownerId: row.owner_id,
        title: row.title,
        description: row.description,
        prepTimeMinutes: row.prep_time_minutes,
        cookTimeMinutes: row.cook_time_minutes,
        totalTimeMinutes: row.total_time_minutes,
        servings: row.servings,
        difficulty: row.difficulty,
        visibility: row.visibility,
        status: row.status,
        sourceType: row.source_type,
        sourceUrl: row.source_url,
        sourceAttribution: row.source_attribution,
        clonedFromId: row.cloned_from_id,
        hasSubstantiveEdit: row.has_substantive_edit,
        cuisine: row.cuisine,
        dietaryFlags: row.dietary_flags,
        tags: row.tags,
        hasPartialNutrition: row.has_partial_nutrition,
        leadCaloriesPerServing: row.lead_calories_per_serving,
        authorHandle: row.author_handle,
        currentVersion: row.current_version,
        averageRating: row.average_rating,
        ratingCount: row.rating_count,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/**
 * Map a raw `recipes` row to the canonical `Recipe` domain shape (nulls → `undefined`). Pure.
 *
 * Delegates every field rule (S-R4) — `difficulty` omitted when unstated, the trigger-maintained
 * `averageRating`/`ratingCount` (average omitted when unrated — never `0`), and the derived
 * `usesPremiumCapability` (via the ONE authoritative `recipe-core` rule) — to the canonical
 * {@link recipeRowToDomain} Data Mapper, via {@link toRecipeRowInput}'s cheap snake_case→camelCase
 * adapter. Only `coverPhotoUrl` (resolved from the cover LATERAL's key against `cloudfrontUrl`) is
 * search-specific and layered on top here: emitted only when both a key and a CDN base are present, so a
 * caller without the CDN base simply omits it rather than emitting a malformed URL.
 *
 * @param row - The raw snake_case page row.
 * @param cloudfrontUrl - CDN base used to resolve the cover-photo key to an absolute URL. When absent,
 *   `coverPhotoUrl` is omitted.
 */
export function rowToRecipe(row: RawRecipeSearchRow, cloudfrontUrl?: string): Recipe {
    const recipe = recipeRowToDomain(toRecipeRowInput(row));

    return {
        ...recipe,
        ...(row.cover_photo_key !== null && cloudfrontUrl !== undefined
            ? { coverPhotoUrl: resolveCdnUrl(cloudfrontUrl, row.cover_photo_key) }
            : {}),
    };
}

/** Build a `text[]` array literal from JS strings, each bound as its own param. Pure. */
function textArray(values: readonly string[]): SQL {
    return sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
    )}]::text[]`;
}

/** Build a comma-separated bound-param list (for an `IN (...)` clause). Pure. */
function paramList(values: readonly string[]): SQL {
    return sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
    );
}

/** The relevance-ranking expression: `ts_rank` when a query is present, else a constant `0`. Pure. */
function rankExpr(query: string | undefined): SQL {
    return query === undefined ? sql`0` : sql`ts_rank(search_vector, plainto_tsquery('english', ${query}))`;
}

/**
 * The page-ordering SQL for each supported sort key, as a key → order-expression map (each builder gets
 * the text query, which relevance needs to reference the `rank` alias). Adding a new sort — `newest`,
 * `prepTimeAsc`, `totalTimeAsc`, `updatedAt` — is a one-line addition here plus the `RecipeSearchSortBy`
 * enum, with no branching to touch. Every order includes a total-order tiebreak so paging is stable.
 */
const SORT_ORDER_BUILDERS: Record<RecipeSearchSortBy, (query: string | undefined) => SQL> = {
    [RecipeSearchSortBy.TITLE]: () => sql`title ASC, created_at DESC`,
    [RecipeSearchSortBy.RECENT]: () => sql`created_at DESC`,
    // Relevance (default): rank-first when a query is present, otherwise newest-first.
    [RecipeSearchSortBy.RELEVANCE]: (query) =>
        query === undefined ? sql`created_at DESC` : sql`rank DESC, created_at DESC`,
    // Quickest (W8-a.9): ascending total time; NULLS never occur (total_time is NOT NULL), created_at tiebreak.
    [RecipeSearchSortBy.QUICKEST]: () => sql`total_time_minutes ASC, created_at DESC`,
    // Most-cloned (W8-a.9): order by the number of recipes cloned FROM this one — a correlated COUNT over
    // `cloned_from_id` (already indexed by idx_recipes_cloned_from). created_at is the tiebreak so the common
    // all-zero case (nothing cloned yet) still pages deterministically newest-first.
    [RecipeSearchSortBy.MOST_CLONED]: () =>
        sql`(SELECT count(*) FROM recipes clones WHERE clones.cloned_from_id = recipes.id) DESC, created_at DESC`,
};

/**
 * The page-ordering expression for a given sort key (references the `rank` alias for relevance). Pure.
 *
 * `Object.hasOwn` rather than `??`: an inherited key like `toString` resolves to a TRUTHY function, so the
 * fallback would never fire and the caller would splice `Object.prototype.toString`'s return — a string, not a
 * `SQL` — straight into an ORDER BY. The wire schema does validate `sortBy` as a zod enum, but a DAL that
 * builds SQL should not inherit its safety from a caller's validation.
 */
function orderByExpr(sortBy: RecipeSearchSortBy, query: string | undefined): SQL {
    const builder = Object.hasOwn(SORT_ORDER_BUILDERS, sortBy)
        ? SORT_ORDER_BUILDERS[sortBy]
        : SORT_ORDER_BUILDERS[RecipeSearchSortBy.RELEVANCE];

    return builder(query);
}

/** Stable total-time facet bucket ids (W8-a.9), ascending. The client maps each id to display copy. */
export const TOTAL_TIME_BUCKETS = ['0-15', '16-30', '31-60', '61+'] as const;

/**
 * The SQL `CASE` mapping `total_time_minutes` → a {@link TOTAL_TIME_BUCKETS} id — the SINGLE source for the
 * bucket boundaries, embedded in both the facet SELECT and its GROUP BY so they cannot drift. Mutually
 * exclusive (each row lands in exactly one bucket), so the bucket counts sum to the sample size.
 */
const totalTimeBucketExpr = sql`CASE
    WHEN total_time_minutes <= 15 THEN '0-15'
    WHEN total_time_minutes <= 30 THEN '16-30'
    WHEN total_time_minutes <= 60 THEN '31-60'
    ELSE '61+'
END`;

/** Fold raw facet rows into the grouped buckets (dietary flag, tag, cuisine, total-time). Pure. */
function groupFacets(rows: RawFacetRow[]): RecipeSearchFacets {
    const dietaryFlags: RecipeFacetCount[] = [];
    const tags: RecipeFacetCount[] = [];
    const cuisine: RecipeFacetCount[] = [];
    const totalTime: RecipeFacetCount[] = [];

    for (const row of rows) {
        const bucket: RecipeFacetCount = { value: row.value, count: Number(row.count) };

        if (row.facet === 'dietary_flags') {
            dietaryFlags.push(bucket);
        } else if (row.facet === 'tags') {
            tags.push(bucket);
        } else if (row.facet === 'cuisine') {
            cuisine.push(bucket);
        } else if (row.facet === 'total_time') {
            totalTime.push(bucket);
        }
    }

    return { dietaryFlags, tags, cuisine, totalTime };
}

export class SearchDal {
    /**
     * @param db The Drizzle client.
     * @param facetSampleSize How many top-ordered matches the facet CTE samples (default
     *   {@link FACET_SAMPLE_SIZE}). Injectable so a test can drive the sampling boundary with a handful
     *   of rows instead of hundreds, and so it stays a single tunable knob.
     */
    public constructor(
        private readonly db: RecipeDrizzle,
        private readonly facetSampleSize: number = FACET_SAMPLE_SIZE,
        // CDN base for resolving the cover-photo key to an absolute `coverPhotoUrl` (CR-001 / FR-001c).
        // Optional so existing test constructions (`new SearchDal(db)` / `new SearchDal(db, 2)`) keep
        // compiling; `SearchModule` always supplies it in production, so cover URLs are always resolved
        // there. When absent, `coverPhotoUrl` is simply omitted (never a malformed URL).
        private readonly cloudfrontUrl?: string,
    ) {
        // FAIL CLOSED ON THE FACET SAMPLE SIZE. This value is the one number in this DAL that reaches a
        // statement without passing through the request schema, so it is bounded HERE rather than trusted.
        // It used to be interpolated via `sql.raw(String(...))`, where a non-integer would have produced
        // `LIMIT 1e21` / `LIMIT NaN` — a syntax error at best — and a request-derived value would have been
        // raw SQL. It is now a bound parameter, so the remaining risk is not injection but an absurd sample
        // (`LIMIT 2000000000` scans the table on every search); refusing it at construction turns a silent
        // production pathology into an immediate, un-missable boot failure.
        if (!Number.isSafeInteger(facetSampleSize) || facetSampleSize < 1 || facetSampleSize > MAX_FACET_SAMPLE_SIZE) {
            throw new RangeError(
                `facetSampleSize must be an integer in 1..${MAX_FACET_SAMPLE_SIZE}, received ${String(facetSampleSize)}`,
            );
        }
    }

    /**
     * Run one ranked, filtered, paginated search and aggregate its facets.
     *
     * @param filters - Query text, structured filters, visibility owner key, pagination, and sort.
     * @returns The ranked page, the grouped facet counts, and the unpaged total.
     * @sideEffect Reads `recipes` (and `recipe_ingredients` when `ingredientIds` is set).
     */
    public async search(filters: RecipeSearchFilters): Promise<RecipeSearchDalResult> {
        const query = filters.query !== undefined && filters.query.trim().length > 0 ? filters.query.trim() : undefined;
        const page = clampPage(filters.page);
        const pageSize = clampPageSize(filters.pageSize);
        const offset = (page - 1) * pageSize;
        const where = this.buildWhere({ ...filters, query });
        const rank = rankExpr(query);
        const orderBy = orderByExpr(filters.sortBy, query);

        const pageResult = await this.db.execute<RawRecipeSearchRow>(sql`
            SELECT ${RECIPE_COLUMNS}, cp.cover_photo_key, ${rank} AS rank
            FROM recipes
            LEFT JOIN LATERAL (
                -- Serve the small thumbnail rendition when present, else the full-size original
                -- (FOLLOW-UP-CR-001-A). Pre-thumbnail rows have thumbnail_key NULL → fall back to s3_key.
                SELECT COALESCE(p.thumbnail_key, p.s3_key) AS cover_photo_key
                FROM recipe_photos p
                WHERE p.recipe_id = recipes.id
                ORDER BY p.sort_order, p.created_at, p.id
                LIMIT 1
            ) cp ON true
            WHERE ${where}
            ORDER BY ${orderBy}
            LIMIT ${pageSize} OFFSET ${offset}
        `);

        const countResult = await this.db.execute<{ total: number }>(sql`
            SELECT count(*)::int AS total
            FROM recipes
            WHERE ${where}
        `);
        const total = Number(countResult.rows[0]?.total ?? 0);

        const facetResult = await this.db.execute<RawFacetRow>(sql`
            WITH matched AS (
                SELECT dietary_flags, tags, cuisine, total_time_minutes, ${rank} AS rank
                FROM recipes
                WHERE ${where}
                -- Total-order tiebreak (created_at DESC, then the id PK): without it the sample is an
                -- ARBITRARY set of rows whenever rank ties — and in browse mode rank is a constant 0, so
                -- EVERY row ties and the facet counts flicker between identical requests. Ordering by
                -- created_at (newest-first, matching the page) then the unique id makes the sample
                -- deterministic and stable.
                ORDER BY rank DESC, created_at DESC, id
                -- A BOUND PARAMETER, not a spliced sql.raw(String(...)). The raw form put this value into the
                -- statement TEXT, which is unnecessary here (the page query two statements up passes its own
                -- LIMIT as a parameter) and it made the DAL's injection-safety a property of whoever happened
                -- to construct it. Parameterised, a bad value can only ever be a rejected parameter, never
                -- new SQL. The constructor additionally rejects a non-integer/out-of-range size, so the two
                -- together make this safe by construction rather than by convention.
                -- NB: no backticks and no dollar-brace in this comment — it lives inside a JS template
                -- literal, so a backtick would END the statement and a dollar-brace would INTERPOLATE.
                LIMIT ${this.facetSampleSize}
            )
            SELECT 'dietary_flags' AS facet, flag AS value, count(*)::int AS count
            FROM matched, unnest(matched.dietary_flags) AS flag
            GROUP BY flag
            UNION ALL
            SELECT 'tags' AS facet, tag AS value, count(*)::int AS count
            FROM matched, unnest(matched.tags) AS tag
            GROUP BY tag
            UNION ALL
            -- Cuisine (W8-a.9): distinct non-null cuisines in the sample.
            SELECT 'cuisine' AS facet, cuisine AS value, count(*)::int AS count
            FROM matched
            WHERE cuisine IS NOT NULL
            GROUP BY cuisine
            UNION ALL
            -- Total-time buckets (W8-a.9): the SAME CASE in SELECT + GROUP BY (single source, no drift).
            SELECT 'total_time' AS facet, ${totalTimeBucketExpr} AS value, count(*)::int AS count
            FROM matched
            GROUP BY ${totalTimeBucketExpr}
            ORDER BY facet ASC, count DESC, value ASC
        `);

        return {
            results: pageResult.rows.map((row) => this.toSearchResult(row, query)),
            facets: groupFacets(facetResult.rows),
            total,
        };
    }

    /** Map a raw row + query into a ranked {@link RecipeSearchResult} (rank omitted in browse mode). */
    private toSearchResult(row: RawRecipeSearchRow, query: string | undefined): RecipeSearchResult {
        const recipe = rowToRecipe(row, this.cloudfrontUrl);

        if (query === undefined) {
            return { recipe };
        }

        const rank = rankToNumber(row.rank);

        return rank === undefined ? { recipe } : { recipe, rank };
    }

    /** Build the AND-joined visibility + filter predicate shared by all three reads. */
    private buildWhere(filters: RecipeSearchFilters): SQL {
        // W8-a.3 draft boundary: a public DRAFT must not surface in search to anyone but its owner.
        const conditions: SQL[] = [activeRecipe(), viewableBy(filters.ownerId), publishedOrOwnedBy(filters.ownerId)];

        if (filters.query !== undefined) {
            conditions.push(sql`search_vector @@ plainto_tsquery('english', ${filters.query})`);
        }

        if (filters.cuisine !== undefined) {
            conditions.push(sql`cuisine = ${filters.cuisine}`);
        }

        if (filters.dietaryFlags !== undefined && filters.dietaryFlags.length > 0) {
            conditions.push(sql`dietary_flags @> ${textArray(filters.dietaryFlags)}`);
        }

        if (filters.tags !== undefined && filters.tags.length > 0) {
            conditions.push(sql`tags @> ${textArray(filters.tags)}`);
        }

        if (filters.maxPrepTime !== undefined) {
            conditions.push(sql`prep_time_minutes <= ${filters.maxPrepTime}`);
        }

        if (filters.maxCookTime !== undefined) {
            conditions.push(sql`cook_time_minutes <= ${filters.maxCookTime}`);
        }

        if (filters.maxTotalTime !== undefined) {
            conditions.push(sql`total_time_minutes <= ${filters.maxTotalTime}`);
        }

        if (filters.ingredientIds !== undefined && filters.ingredientIds.length > 0) {
            conditions.push(
                sql`EXISTS (SELECT 1 FROM recipe_ingredients ri
                    WHERE ri.recipe_id = recipes.id AND ri.ingredient_id IN (${paramList(filters.ingredientIds)}))`,
            );
        }

        return sql.join(conditions, sql` AND `);
    }
}

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
import type { Recipe, RecipeSearchResult, RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../database/client.js';

/** Default page size when the caller does not specify one (mirrors the list endpoint's default). */
export const DEFAULT_SEARCH_PAGE_SIZE = 20;

/** Hard ceiling on page size (mirrors the OpenAPI `pageSize` maximum for search). */
export const MAX_SEARCH_PAGE_SIZE = 50;

/**
 * How many top-ranked matches the facet CTE samples before aggregating. Facet counts are computed over
 * this rank-ordered sample (not the whole match set) so a broad query stays cheap; the chips still
 * reflect the most relevant slice of results.
 */
export const FACET_SAMPLE_SIZE = 200;

/** The explicit `recipes` projection returned by the page read — deliberately excludes `search_vector`. */
const RECIPE_COLUMNS = sql`
    id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
    total_time_minutes, servings, visibility, source_type, source_url,
    source_attribution, cloned_from_id, has_substantive_edit, cuisine,
    dietary_flags, tags, has_partial_nutrition, current_version,
    ingredient_names_text, deleted_at, created_at, updated_at`;

/** Everything the DAL needs to build one ranked, filtered, paginated search. */
export interface RecipeSearchFilters {
    /** The caller's app-user ULID — the owner key that widens visibility beyond `public`. */
    readonly ownerId: string;
    /** Free-text query (FTS). Absent/blank → browse mode (no `search_vector` predicate). */
    readonly query?: string;
    /** Exact cuisine filter. */
    readonly cuisine?: string;
    /** Require ALL of these dietary flags (array containment). */
    readonly dietaryFlags?: string[];
    /** Require ALL of these tags (array containment). */
    readonly tags?: string[];
    /** Upper bound on `prep_time_minutes` (rows with unknown prep time are excluded). */
    readonly maxPrepTime?: number;
    /** Upper bound on `total_time_minutes` (rows with unknown total time are excluded). */
    readonly maxTotalTime?: number;
    /** Require the recipe to contain ANY of these ingredient ids (via `recipe_ingredients`). */
    readonly ingredientIds?: string[];
    /** 1-based page number. */
    readonly page: number;
    /** Page size (clamped to `[1, MAX_SEARCH_PAGE_SIZE]`). */
    readonly pageSize: number;
    /** Result ordering. */
    readonly sortBy: RecipeSearchSortBy;
}

/** A single facet bucket: a value and how many sampled matches carry it. */
export interface FacetCount {
    readonly value: string;
    readonly count: number;
}

/** Facet aggregations returned alongside a page of results. */
export interface RecipeSearchFacets {
    readonly dietaryFlags: FacetCount[];
    readonly tags: FacetCount[];
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
    servings: number | null;
    visibility: string;
    source_type: string;
    source_url: string | null;
    source_attribution: string | null;
    cloned_from_id: string | null;
    has_substantive_edit: boolean;
    cuisine: string | null;
    dietary_flags: string[];
    tags: string[];
    has_partial_nutrition: boolean;
    current_version: number;
    ingredient_names_text: string;
    deleted_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
    rank: number | string | null;
}

/** The raw row shape returned by the facet CTE. */
interface RawFacetRow {
    [column: string]: unknown;
    facet: string;
    value: string;
    count: number | string;
}

/** Normalize a `timestamptz` (a `Date` from pg, or an ISO string in tests) to an ISO-8601 string. Pure. */
function toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Coerce a nullable ranking value (pg may return `real` as number or string) to a number/undefined. Pure. */
function rankToNumber(value: number | string | null): number | undefined {
    return value === null ? undefined : Number(value);
}

/** Map a raw `recipes` row to the canonical `Recipe` domain shape (nulls → `undefined`). Pure. */
export function rowToRecipe(row: RawRecipeSearchRow): Recipe {
    return {
        id: row.id,
        ownerId: row.owner_id,
        title: row.title,
        description: row.description ?? '',
        prepTimeMinutes: row.prep_time_minutes ?? 0,
        cookTimeMinutes: row.cook_time_minutes ?? 0,
        totalTimeMinutes: row.total_time_minutes ?? 0,
        servings: row.servings ?? 0,
        visibility: row.visibility as RecipeVisibility,
        sourceType: row.source_type as RecipeSourceType,
        ...(row.source_url !== null ? { sourceUrl: row.source_url } : {}),
        ...(row.source_attribution !== null ? { sourceAttribution: row.source_attribution } : {}),
        ...(row.cloned_from_id !== null ? { clonedFromId: row.cloned_from_id } : {}),
        hasSubstantiveEdit: row.has_substantive_edit,
        ...(row.cuisine !== null ? { cuisine: row.cuisine } : {}),
        dietaryFlags: row.dietary_flags,
        tags: row.tags,
        hasPartialNutrition: row.has_partial_nutrition,
        currentVersion: row.current_version,
        ...(row.deleted_at !== null ? { deletedAt: toIsoString(row.deleted_at) } : {}),
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
    };
}

/** Clamp a requested page size into `[1, MAX_SEARCH_PAGE_SIZE]`, defaulting when absent/invalid. Pure. */
export function clampPageSize(pageSize: number | undefined): number {
    if (pageSize === undefined || !Number.isFinite(pageSize)) {
        return DEFAULT_SEARCH_PAGE_SIZE;
    }

    return Math.min(Math.max(Math.trunc(pageSize), 1), MAX_SEARCH_PAGE_SIZE);
}

/** Clamp a requested page number to a minimum of 1, defaulting when absent/invalid. Pure. */
export function clampPage(page: number | undefined): number {
    if (page === undefined || !Number.isFinite(page)) {
        return 1;
    }

    return Math.max(Math.trunc(page), 1);
}

/** Build a `text[]` array literal from JS strings, each bound as its own param. Pure. */
function textArray(values: string[]): SQL {
    return sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
    )}]::text[]`;
}

/** Build a comma-separated bound-param list (for an `IN (...)` clause). Pure. */
function paramList(values: string[]): SQL {
    return sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
    );
}

/** The relevance-ranking expression: `ts_rank` when a query is present, else a constant `0`. Pure. */
function rankExpr(query: string | undefined): SQL {
    return query === undefined ? sql`0` : sql`ts_rank(search_vector, plainto_tsquery('english', ${query}))`;
}

/** The page-ordering expression for a given sort key (references the `rank` alias for relevance). Pure. */
function orderByExpr(sortBy: RecipeSearchSortBy, query: string | undefined): SQL {
    if (sortBy === RecipeSearchSortBy.TITLE) {
        return sql`title ASC, created_at DESC`;
    }

    if (sortBy === RecipeSearchSortBy.RECENT) {
        return sql`created_at DESC`;
    }

    // Relevance (default): rank-first when a query is present, otherwise newest-first.
    return query === undefined ? sql`created_at DESC` : sql`rank DESC, created_at DESC`;
}

/** Fold raw facet rows into the two grouped buckets. Pure. */
function groupFacets(rows: RawFacetRow[]): RecipeSearchFacets {
    const dietaryFlags: FacetCount[] = [];
    const tags: FacetCount[] = [];

    for (const row of rows) {
        const bucket: FacetCount = { value: row.value, count: Number(row.count) };

        if (row.facet === 'dietary_flags') {
            dietaryFlags.push(bucket);
        } else if (row.facet === 'tags') {
            tags.push(bucket);
        }
    }

    return { dietaryFlags, tags };
}

export class SearchDal {
    public constructor(private readonly db: RecipeDrizzle) {}

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
            SELECT ${RECIPE_COLUMNS}, ${rank} AS rank
            FROM recipes
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
                SELECT dietary_flags, tags, ${rank} AS rank
                FROM recipes
                WHERE ${where}
                ORDER BY rank DESC
                LIMIT ${sql.raw(String(FACET_SAMPLE_SIZE))}
            )
            SELECT 'dietary_flags' AS facet, flag AS value, count(*)::int AS count
            FROM matched, unnest(matched.dietary_flags) AS flag
            GROUP BY flag
            UNION ALL
            SELECT 'tags' AS facet, tag AS value, count(*)::int AS count
            FROM matched, unnest(matched.tags) AS tag
            GROUP BY tag
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
        const recipe = rowToRecipe(row);

        if (query === undefined) {
            return { recipe };
        }

        const rank = rankToNumber(row.rank);

        return rank === undefined ? { recipe } : { recipe, rank };
    }

    /** Build the AND-joined visibility + filter predicate shared by all three reads. */
    private buildWhere(filters: RecipeSearchFilters): SQL {
        const conditions: SQL[] = [
            sql`deleted_at IS NULL`,
            sql`(visibility = 'public' OR owner_id = ${filters.ownerId})`,
        ];

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

/**
 * AUTHORED WIRE CONTRACT for recipe search (`GET /api/v1/search/recipes`).
 *
 * SOURCE OF TRUTH for the search response body. Copied verbatim into `@kitchensink/schema-recipe`, so it may
 * import ONLY `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — enforced by
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/generate.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, composed from `recipe-core` Value Objects.
 *
 * ── WHY THIS FILE EXISTS: THE DEPENDENCY WAS POINTING BACKWARDS ──
 *
 * `RecipeSearchFacets` is a field of a PUBLIC RESPONSE BODY, so the contract owns it. It used to be declared
 * — and exported — by `dal/search.dal.ts`, which meant a data-access internal defined the public API, and the
 * response type imported *up* from the DAL. That is the inversion this file corrects: the DAL now IMPORTS the
 * shape it must produce, and computing a value no longer confers ownership of its type.
 *
 * It also collapses FOUR independent declarations of the same knowledge into one. Before this file, the shape
 * was declared in the DAL, in the response DTO (which additionally typed `results` as MUTABLE while the client
 * typed it `readonly`), in the typed client's `types.ts`, and again in the facet-bar UI package. The four had
 * already drifted: the server declared all four facet dimensions REQUIRED while the client declared all four
 * OPTIONAL, so the two sides disagreed about whether a facet block could be absent.
 *
 * ── RESOLUTION OF THE `readonly` MISMATCH ──
 *
 * Everything here is `readonly`, including the arrays. A parsed response body is a snapshot of what the server
 * said; a consumer that mutates it in place corrupts a value other consumers (and the query cache) share.
 * Verified safe rather than assumed: no consumer mutates a facet block — every read site is a `map`/`filter`
 * or a property read. `readonly` also matches what the typed client already promised its callers.
 *
 * ── REQUIRED, NOT OPTIONAL ──
 *
 * All four dimensions are REQUIRED, resolving the drift in the server's favour, because the server genuinely
 * always aggregates all four over the match sample: an empty dimension is `[]`, never an absent key. Declaring
 * them optional invited a consumer to render "no cuisine filter available" when the honest state is "no
 * cuisines in this sample". A narrower UI view-model that accepts a subset is a separate, derived concern —
 * see `RecipeFacets` in `@commise/features-recipes`.
 */
import { z } from 'zod';

import {
    INT4_CEILING,
    MAX_SEARCH_PAGE_SIZE,
    RecipeSearchSortBy,
    recipeFacetCountSchema,
    recipeSearchResultSchema,
} from '@kitchensink/recipe-core';

// ── The REQUEST half of the contract ──────────────────────────────────────────────────────────────
//
// ⚠️ THIS HALF DID NOT EXIST, and its absence had three consequences beyond the missing document text.
//
// `GET /api/v1/search/recipes` was served by a `class-validator` DTO — the LAST `class-validator` importer in
// `packages/services/**`, i.e. a second DTO framework inside a service ADR-0015 §1 requires to have exactly
// one. Because `class-validator` reports its constraints on `message[]` rather than on the `errors` key
// `nestjs-zod` uses, this route's `400` missed `ApiExceptionFilter`'s validation branch and published
// `BAD_REQUEST` — a code deliberately absent from `recipeErrorCodeSchema` (see `../common/api-error.ts`), so the
// typed client's union rejected it and fell back to status-mapping, while the published document promised
// `VALIDATION_FAILED` "from the boundary parser". One endpoint out of forty-one spoke a different dialect.
//
// It also inverted two dependencies: the page-size ceiling was imported from `dal/search.dal.js` (a data-access
// module owning a published constraint — the same inversion the response half of this file was written to
// correct for `RecipeSearchFacets`), and `INT4_CEILING` was re-declared locally while `recipe-core` exports it.

/**
 * Normalize a repeated-or-CSV query parameter into a trimmed, non-empty `string[]`, or `undefined` when nothing
 * usable remains.
 *
 * A list filter arrives in two forms and both are supported on purpose: `?tags=a&tags=b` (which Express parses
 * to an array) and `?tags=a,b` (one value). Pure.
 *
 * @param value - The raw query-bag entry.
 * @returns The normalized list, or `undefined` for an absent/blank/entry-less parameter.
 */
function toStringArray(value: unknown): readonly string[] | undefined {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    const normalized = raw
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    return normalized.length > 0 ? normalized : undefined;
}

/**
 * Read a BLANK query parameter as an ABSENT one.
 *
 * `?maxPrepTime=` is what a UI serializes for a cleared numeric input and `?query=` for an empty search box.
 * Under the previous DTO the first coerced to `Number('') === 0` and passed `@Min(0)`, so the request meant
 * "recipes taking zero minutes or less" and returned NOTHING — a wrong answer served as a `200`, from a
 * parameter the caller believed they had left blank. The second reached the DAL as `''`, where
 * `filters.query.trim().length > 0` re-derived the same decision three layers below the parser, for one of the
 * eleven fields.
 *
 * Making it a property of the PARSER means it holds for every field and is stated once. Pure.
 *
 * @param value - The raw query-bag entry.
 * @returns `undefined` for the empty string, the value unchanged otherwise.
 */
function blankAsAbsent(value: unknown): unknown {
    return value === '' ? undefined : value;
}

/** An optional free-text filter: blank means absent, and a supplied value must be non-empty. */
const textFilterSchema = z.preprocess(blankAsAbsent, z.string().min(1).optional());

/** An optional repeated-or-CSV list filter, normalized to a trimmed non-empty `readonly string[]`. */
const listFilterSchema = z.preprocess(toStringArray, z.array(z.string().min(1)).readonly().optional());

/**
 * An optional "at most N minutes" filter.
 *
 * `INT4_CEILING` is carried even though a filter WRITES nothing, because each becomes
 * `WHERE <int4 column> <= $1` and an out-of-range parameter fails that comparison with the identical
 * `22003 value "…" is out of range for type integer` an INSERT would — which `ApiExceptionFilter` collapses to a
 * generic `500` for what is plainly a bad request. Verified against a live PostgreSQL 16.
 */
const minutesFilterSchema = z.preprocess(
    blankAsAbsent,
    z.coerce.number().int().nonnegative().max(INT4_CEILING).optional(),
);

/**
 * The `sortBy` values accepted on the wire — derived from the shared {@link RecipeSearchSortBy} value object
 * (single source), so a new search sort is admitted by adding it to that enum with no second list here.
 */
export const RECIPE_SEARCH_SORT_BY = Object.values(RecipeSearchSortBy);

/**
 * The `GET /api/v1/search/recipes` query — SOURCE OF TRUTH for what the endpoint accepts.
 *
 * Coerced, because a query bag is strings on the wire. `.int()` REJECTS `2.5` rather than truncating it: a
 * silently-truncated page size is a contract that lies about what it did.
 *
 * `page`, `pageSize` and `sortBy` are left OPTIONAL rather than `.default()`-ed — unlike
 * `listRecipesQuerySchema`, which defaults in the schema. The difference is deliberate and preserves existing
 * behaviour: `SearchService` already owns these three defaults, and moving them here would change the parsed
 * value the service sees mid-convergence. The published document describes them as optional, which is honest.
 *
 * ⚠️ FORWARD-COMPATIBILITY EXEMPTION from GR-017 §17-c's `z.strictObject()` default — the FOURTH, documented at
 * the schema as that rule requires, and pinned by name in `contract/__tests__/contract.test.ts`. The reasoning
 * is `listRecipesQuerySchema`'s, unchanged: Nest hands the pipe the WHOLE query string, so a strict object would
 * `400` on a cache-buster, an analytics parameter or a pasted tracking tag — none of which changes what the
 * endpoint returns — and a READ has no silent-partial-write for strictness to make visible.
 */
export const recipeSearchQuerySchema = z.object({
    /** Free-text query over the weighted `search_vector`. Absent (or blank) degrades to a browse. */
    query: textFilterSchema,
    /** Exact cuisine filter. */
    cuisine: textFilterSchema,
    /** Dietary-flag filter (OR-narrowed). */
    dietaryFlags: listFilterSchema,
    /** Tag filter (OR-narrowed). */
    tags: listFilterSchema,
    /** Maximum prep minutes. */
    maxPrepTime: minutesFilterSchema,
    /** Maximum cook minutes. */
    maxCookTime: minutesFilterSchema,
    /** Maximum total minutes. */
    maxTotalTime: minutesFilterSchema,
    /** Ingredient filter, by opaque catalog id (ADR: recipes reference ingredients one-directionally). */
    ingredientIds: listFilterSchema,
    /** 1-based page number. Defaulted by `SearchService`, not here. */
    page: z.preprocess(blankAsAbsent, z.coerce.number().int().positive().optional()),
    /**
     * Page size, capped at the published ceiling.
     *
     * The cap is load-bearing for ENVELOPE HONESTY rather than only for load: `SearchService` echoes the
     * REQUESTED `pageSize` into the response envelope while `SearchDal` independently clamps the `LIMIT` it
     * issues, so an accepted `pageSize=999` would report `pageSize: 999` beside 50 rows. The published document
     * omitted this maximum entirely until the query contract was authored here.
     */
    pageSize: z.preprocess(blankAsAbsent, z.coerce.number().int().positive().max(MAX_SEARCH_PAGE_SIZE).optional()),
    /** Sort key. Defaulted to `relevance` by `SearchService`, not here. */
    sortBy: z.preprocess(blankAsAbsent, z.enum(RECIPE_SEARCH_SORT_BY).optional()),
});

/** The parsed `GET /api/v1/search/recipes` query. */
export type RecipeSearchQuery = z.infer<typeof recipeSearchQuerySchema>;

// ── The RESPONSE half of the contract ─────────────────────────────────────────────────────────────

/**
 * Facet aggregations returned alongside a page of search hits.
 *
 * Each dimension is an ORDERED array of buckets, not a `{ value: count }` map, so a bucket can grow a display
 * label or an explicit order without a breaking reshape. Bucket ordering is the server's and is significant —
 * the facet bar renders it as given.
 */
export const recipeSearchFacetsSchema = z
    .object({
        /** Dietary-flag buckets over the match sample. */
        dietaryFlags: z.array(recipeFacetCountSchema).readonly(),
        /** Tag buckets over the match sample. */
        tags: z.array(recipeFacetCountSchema).readonly(),
        /** Distinct cuisines in the match sample (W8-a.9), most-common first. NULL cuisines are excluded. */
        cuisine: z.array(recipeFacetCountSchema).readonly(),
        /**
         * Total-time buckets over the match sample (W8-a.9), keyed by the stable bucket ids
         * (`0-15` | `16-30` | `31-60` | `61+`) — mutually exclusive, so the counts sum to the sample size.
         * The same dimension the `quickest` sort and the `maxTotalTime` filter key on; the client maps each id
         * to display copy ("Under 15 min", …).
         */
        totalTime: z.array(recipeFacetCountSchema).readonly(),
    })
    .readonly();

/** Facet aggregations returned alongside a page of search hits. */
export type RecipeSearchFacets = z.infer<typeof recipeSearchFacetsSchema>;

/**
 * The `GET /api/v1/search/recipes` response body.
 *
 * `results` is an object-per-hit envelope (`{ recipe, rank? }`, from `recipe-core`) rather than a bare
 * `Recipe[]`, so per-result metadata stays an ADDITIVE change.
 */
export const recipeSearchResponseSchema = z
    .object({
        /** The ranked page of hits. */
        results: z.array(recipeSearchResultSchema).readonly(),
        /** Facet counts over the ranked match sample. */
        facets: recipeSearchFacetsSchema,
        /** Total number of matching recipes, unpaged. */
        total: z.number().int().nonnegative(),
        /** 1-based page number, echoed back. */
        page: z.number().int().positive(),
        /** Page size, echoed back. */
        pageSize: z.number().int().positive(),
        /** Whether more pages remain after this one. */
        hasMore: z.boolean(),
    })
    .readonly();

/** The recipe-search response body. */
export type RecipeSearchResponse = z.infer<typeof recipeSearchResponseSchema>;

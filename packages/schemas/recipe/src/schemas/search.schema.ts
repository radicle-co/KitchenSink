/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the source and
 * regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/recipe-service/src/search/search.schema.ts

/**
 * AUTHORED WIRE CONTRACT for recipe search (`GET /api/v1/search/recipes`).
 *
 * SOURCE OF TRUTH for the search response body. Copied verbatim into `@kitchensink/schema-recipe`, so it may
 * import ONLY `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — see
 * `contract/schema-imports.ts`.
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

import { recipeFacetCountSchema, recipeSearchResultSchema } from '@kitchensink/recipe-core';

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

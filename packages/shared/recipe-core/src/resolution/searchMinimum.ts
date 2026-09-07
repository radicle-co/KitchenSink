/**
 * THE FOOD-SEARCH MINIMUM QUERY LENGTH (003-FR-010a, owner ruling 2026-08-24; plan U37).
 *
 * DESIGN PATTERN: **Specification / Policy module** — the sibling of `verificationGatePolicy.ts` and of
 * `recipes/domain/provenancePolicy.ts`. One pure predicate over its argument alone: no database, no clock,
 * no request. It is the ONE authoritative representation of a rule that has to hold in three places at once.
 *
 * ## ⛔ WHY THREE, AND WHY NOT FOUR
 *
 * Measured against the real 8,094-row USDA catalog: a ONE-character query matches **51%** of rows and a
 * TWO-character query **23%**, against a surface that displays ten to twenty. A query that selective cannot
 * discriminate, so returning an arbitrary slice of the match set is worse than returning nothing — the cook
 * reads a ranked list as an answer, and at that length the ranking is noise.
 *
 * ⚠️ Three is the FLOOR, not four. No food name of two characters exists in the catalog, but fifteen genuine
 * three-character foods do — `egg`, `ham`, `rye`, `cod`, `soy`, `oat`, `fig`, `yam`, `nut`, `tea`, `pie`,
 * `elk`, `gin`, `rum`, `poi` — so a four-character floor would silently break real searches while passing
 * every "short queries are refused" test. Raising this constant is a product decision with a named cost.
 *
 * ## ⛔ WHY IT LIVES IN `recipe-core`
 *
 * ⚠️ The enumeration below said "three ends" and named two servers' worth of them; it has grown since, which
 * is the drift a count invites. Every reader of {@link meetsSearchMinimum} is an end, and they do not all
 * answer the same way — see the section below on `200` versus `400`:
 *
 *  - **food-service, LOCAL catalog search** short-circuits below it, so no statement and no crosswalk lookup
 *    reaches Postgres (`FoodsService.search`, `selectSearchStrategy`);
 *  - **food-service, ON-DEMAND live search** REFUSES below it (`LiveSearchService.search` →
 *    `SearchQueryTooShortError`);
 *  - **recipe-service** refuses on its live-search passthrough (`IngredientsService.searchLive`);
 *  - **the web app** and **the mobile app** gate the typeahead on it — through the shared
 *    `@commise/features-recipes` models — and render the FR-010a empty state instead of firing a request
 *    that can only come back empty.
 *
 * A client that disagreed with the server about the boundary would either render "keep typing" over a result
 * set the server was willing to return, or fire a per-keystroke request the server always answers empty.
 *
 * ⛔ Reachable ONLY as `@kitchensink/recipe-core/resolution/search-minimum`, never from the barrel:
 * `contract-gen` hashes `src/index.ts`, so one added line there moves the recipe service's `CONTRACT_HASH`
 * for a module with no wire projection.
 *
 * ## ⚠️ THE LOCAL CATALOG SEARCH ANSWERS `200`, NOT `400` — THE LIVE SEARCH DELIBERATELY DOES NOT
 *
 * On `GET /api/v1/foods/search`, FR-010a says the system "returns no results and says so" — an empty result
 * set the client explains, not an error. `searchFoodQuerySchema` therefore keeps its `min(1)`: a
 * below-minimum query is a well-formed request with an empty answer, which is what lets a client debounce
 * without having to model a `400` as a non-error.
 *
 * ⛔ CORRECTED — this used to claim the rule "still answers `200`, not `400`" everywhere. The ON-DEMAND live
 * search (plan U29) refuses instead, `400 VALIDATION_FAILED`, on both services: it spends against a shared
 * 1,000/hr external quota, and an empty page there is indistinguishable from "the source has nothing", which
 * is the one outcome that surface exists to report. `SearchQueryTooShortError`'s own docstring carries the
 * full argument.
 *
 * @implements 003-FR-010a
 */

/**
 * Fewest characters a food-search query must carry before it is worth executing.
 *
 * @see The module doc for the measurement that chose it and for why four would be wrong.
 */
export const MIN_SEARCH_QUERY_LENGTH = 3;

/**
 * Whether a query is long enough to discriminate, and therefore worth searching for.
 *
 * ⚠️ It TRIMS before counting, so `' eg '` cannot buy its way over the floor on whitespace, and it counts
 * CHARACTERS rather than UTF-16 code units, so a single astral character cannot read as two.
 *
 * @param query - The raw user query, trimmed or not.
 * @returns `true` when the query meets {@link MIN_SEARCH_QUERY_LENGTH}. Pure.
 */
export function meetsSearchMinimum(query: string): boolean {
    return [...query.trim()].length >= MIN_SEARCH_QUERY_LENGTH;
}

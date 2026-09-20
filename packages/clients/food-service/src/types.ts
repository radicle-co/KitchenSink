/**
 * The wire types `@kitchensink/food-service-client` speaks, RE-EXPORTED from the contract the food (ingredient)
 * service owns — never re-declared here (`docs/CODING_STANDARDS.md` §15, rules 1 and 4).
 *
 * WHAT THIS FILE USED TO BE. 144 lines of hand-written interfaces with zero zod, importing nothing from the
 * service it speaks to. That is the duplication §15.1 measures: two independent representations of ONE piece of
 * knowledge — the wire contract — on either side of a boundary that could not typecheck across. A backend change
 * to a response shape did not break this package's `typecheck`; it simply went on asserting its own beliefs
 * about the server, and the only place the mismatch could surface was an end-to-end run against a live
 * deployment, or production.
 *
 * WHAT IT IS NOW. A rename layer over `@kitchensink/schema-food`, which is generated from the service's authored
 * `*.schema.ts` files. Every shape below is an ALIAS — a second NAME for one definition, not a second
 * definition — so a backend change now fails `typecheck` here (~1.6 min) instead of in e2e or in production.
 *
 * THE HISTORICAL NAMES ARE GONE. A contract-extraction change is not free to churn this package's public
 * surface, so the wire shapes were first re-exported under BOTH the service's names and the historical
 * `*Result`/`FoodView` ones, the latter `@deprecated`. The dedicated retirement pass those aliases were kept
 * for has now run: `AddResult`, `BatchResult`, `StatusResult`, `SearchResult`, `ResolveResult`,
 * `CandidatesResult` and `FoodView` are deleted, and for those shapes the service's own names are the only
 * vocabulary. The `*Result`/`*Input` names that remain below were never part of that deprecated set and were
 * not retired with it.
 *
 * ACCEPTED CONSEQUENCE, recorded rather than worked around: the old hand-written interfaces marked their fields
 * `readonly` and their arrays `readonly T[]`; the generated types (via `z.infer`) do not. That is a WIDENING of a
 * response type — a caller can still do everything it could before, since `T[]` is assignable to
 * `readonly T[]` — and restoring it would require a deep-readonly wrapper per type, i.e. exactly the second
 * representation this file was rewritten to delete.
 *
 * The runtime zod for every shape below is available from the same package, so a caller that wants to validate a
 * boundary at runtime can do so against the SAME definition rather than a second one.
 */
export type {
    AddResponse,
    ApiErrorBody,
    BatchItemView,
    BatchResponse,
    CandidateView,
    CandidatesResponse,
    FoodError,
    FoodErrorCode,
    FoodResponse,
    FoodStatus,
    GetFoodResult,
    LiveSearchResponse,
    LiveSearchResultView,
    NutrientView,
    PendingFoodStatus,
    PendingResponse,
    PortionView,
    ResolveResponse,
    SearchResponse,
    SearchResultView,
    StatusResponse,
    TerminalFoodStatus,
} from '@kitchensink/schema-food';

import type {
    CorroboratedResponse,
    CreateAuthoredFoodRequest,
    FoodNutritionBatchResponse,
    FoodResponse,
} from '@kitchensink/schema-food';

/** `GET /api/v1/foods/nutrition` — batch per-100g nutrition + normalized portions (plan U8). */
export type FoodNutritionBatchResult = FoodNutritionBatchResponse;

/** Input to `createAuthoredFood` — the service-published request type, re-exported under the client's name. */
export type CreateAuthoredFoodInput = CreateAuthoredFoodRequest;

/**
 * Outcome of `createAuthoredFood`: created, or the caller's per-author dedup collision carrying the
 * EXISTING food's id (the U16 reuse affordance's whole input).
 */
export type CreateAuthoredFoodResult =
    | { readonly kind: 'created'; readonly food: FoodResponse }
    | { readonly kind: 'duplicate'; readonly existingId: string };

/** Outcome of `corroborateFood` (plan U19) — the food's (possibly unchanged) status after the trigger. */
export type CorroboratedResult = CorroboratedResponse;

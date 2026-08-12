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
 * WHY THE ALIASES EXIST AT ALL. This package has real importers (the recipe service's ingredient path, its
 * integration and e2e tiers), and its public export surface is not free to churn inside a contract-extraction
 * change. So the service's own names are re-exported as the CANONICAL vocabulary and the historical
 * `*Result`/`FoodView` names are kept pointing at them. New code should use the canonical names; the legacy ones
 * are marked `@deprecated` so an editor says so at the call site, and they can be retired in a dedicated pass.
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
    AddResponse,
    BatchResponse,
    CandidatesResponse,
    FoodResponse,
    ResolveResponse,
    SearchResponse,
    StatusResponse,
} from '@kitchensink/schema-food';

/**
 * The full golden record returned for a `RESOLVED` food.
 *
 * @deprecated Use `FoodResponse`, the name the service publishes. Identical type.
 */
export type FoodView = FoodResponse;

/**
 * The result of `addByName` (`202 Accepted`).
 *
 * @deprecated Use `AddResponse`, the name the service publishes. Identical type.
 */
export type AddResult = AddResponse;

/**
 * The result of `batch`.
 *
 * @deprecated Use `BatchResponse`, the name the service publishes. Identical type.
 */
export type BatchResult = BatchResponse;

/**
 * The result of `getStatus`.
 *
 * @deprecated Use `StatusResponse`, the name the service publishes. Identical type.
 */
export type StatusResult = StatusResponse;

/**
 * The result of `getCandidates`.
 *
 * @deprecated Use `CandidatesResponse`, the name the service publishes. Identical type.
 */
export type CandidatesResult = CandidatesResponse;

/**
 * The result of `search`.
 *
 * @deprecated Use `SearchResponse`, the name the service publishes. Identical type.
 */
export type SearchResult = SearchResponse;

/**
 * The result of `resolve` (PATCH from a candidate pick).
 *
 * @deprecated Use `ResolveResponse`, the name the service publishes. Identical type.
 */
export type ResolveResult = ResolveResponse;

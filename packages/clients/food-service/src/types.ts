/**
 * Public request/response shapes for `@kitchensink/food-service-client` (T-057). These mirror the
 * food service's `/v1/foods/*` contract but are intentionally standalone (no dependency on the NestJS
 * service package) and source-agnostic: every food is keyed by its internal `id` and NO source-native
 * key (`fdcId`) ever appears in a public shape (SC-013). Dates are ISO-8601 strings (CODING_STANDARDS).
 */

/** Food lifecycle status (the service's canonical set). */
export type FoodStatus = 'PENDING' | 'RESOLVED' | 'UNRESOLVED' | 'NOT_FOUND' | 'FAILED';

/** A golden nutrient value (source-tagged). */
export interface NutrientView {
    /** Nutrient display name (e.g. `Protein`). */
    readonly nutrient: string;
    /** Amount (numeric). */
    readonly amount: number;
    /** Unit the amount is expressed in (e.g. `g`, `kcal`). */
    readonly unit: string;
    /** The basis the amount is on (`per_100g` | `per_serving`). */
    readonly basis: string;
    /** The source that supplied the winning value (e.g. `usda`). */
    readonly source: string;
}

/** A household-measure portion (source-tagged). */
export interface PortionView {
    /** Human label (e.g. `1 cup chopped`). */
    readonly label: string;
    /** Gram weight (numeric, strictly positive). */
    readonly gramWeight: number;
    /** The source that supplied the portion. */
    readonly source: string;
}

/** The full golden record returned for a `RESOLVED` food. */
export interface FoodView {
    /** Internal food id (ULID). */
    readonly id: string;
    /** Golden display name. */
    readonly name: string | null;
    /** Golden free-text description. */
    readonly description: string | null;
    /** Generic/branded classification. */
    readonly kind: string;
    /** Lifecycle status (always `RESOLVED` for this shape). */
    readonly status: FoodStatus;
    /** Per-100g (or per-serving) golden nutrients. */
    readonly nutrients: readonly NutrientView[];
    /** Household-measure portions. */
    readonly portions: readonly PortionView[];
    /** Scalar-field provenance — `{ field: source }`. */
    readonly provenance: Readonly<Record<string, string>>;
}

/** The result of `getById`: either the golden record (`RESOLVED`) or a non-terminal pending state. */
export type GetFoodResult =
    | { readonly status: 'RESOLVED'; readonly food: FoodView }
    | { readonly status: 'PENDING' | 'UNRESOLVED'; readonly id: string; readonly estimatedWaitSeconds?: number };

/** The result of `addByName` (`202 Accepted`). */
export interface AddResult {
    /** Internal food id. */
    readonly id: string;
    /** Lifecycle status after the add (`PENDING` on a fresh add / reactivation). */
    readonly status: FoodStatus;
    /** Best-effort seconds until availability, when enqueued. */
    readonly estimatedWaitSeconds?: number;
}

/** A single item in a batch add response. */
export interface BatchItemView {
    /** Internal food id. */
    readonly id: string;
    /** The item's lifecycle status (`RESOLVED` inline hit, else `PENDING`). */
    readonly status: FoodStatus;
    /** Golden display name (present for an inline `RESOLVED` hit). */
    readonly name?: string | null;
    /** Estimated seconds until availability (present for a `PENDING` miss). */
    readonly estimatedWaitSeconds?: number;
}

/** The result of `batch`. */
export interface BatchResult {
    /** Per-item partial results (inline hits + pending misses). */
    readonly items: readonly BatchItemView[];
}

/** The result of `getStatus`. */
export interface StatusResult {
    /** Internal food id. */
    readonly id: string;
    /** Current lifecycle status. */
    readonly status: FoodStatus;
    /** Present for `PENDING`: estimated seconds until availability. */
    readonly estimatedWaitSeconds?: number;
    /** Present only when `RESOLVED`: the full golden record. */
    readonly food?: FoodView;
}

/** A single cross-source candidate in the disambiguation list. */
export interface CandidateView {
    /** The candidate row id (the resolve pick handle). */
    readonly candidateId: string;
    /** The source the candidate came from. */
    readonly source: string;
    /** That source's opaque key for the item. */
    readonly externalKey: string;
    /** Candidate display name. */
    readonly name: string;
    /** One-line disambiguation hint, when present. */
    readonly summary: string | null;
}

/** The result of `getCandidates`. */
export interface CandidatesResult {
    /** Internal food id. */
    readonly id: string;
    /** The (non-expired) candidate set; empty for a non-`UNRESOLVED` food. */
    readonly candidates: readonly CandidateView[];
}

/** A single search hit. */
export interface SearchResultView {
    /** Internal food id. */
    readonly id: string;
    /** Golden display name. */
    readonly name: string | null;
    /** Relevance score. */
    readonly score: number;
}

/** The result of `search`. */
export interface SearchResult {
    /** Ranked results, or an empty array on no local match. */
    readonly results: readonly SearchResultView[];
}

/** The result of `resolve` (PATCH from a candidate pick). */
export interface ResolveResult {
    /** Internal food id. */
    readonly id: string;
    /** The resulting status (`RESOLVED`). */
    readonly status: FoodStatus;
}

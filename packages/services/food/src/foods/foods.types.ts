/**
 * Response shapes for the source-agnostic `/v1/foods/*` API (plan §3).
 *
 * Every path param and `id` is the internal food ULID — NEVER a source-native key (`fdcId`), which
 * exists only inside the USDA adapter (SC-013). Dates are ISO-8601 strings (CODING_STANDARDS).
 */
import type { FoodStatus } from './dao/index.js';

export type { FoodStatus };

/** A golden nutrient value in the read shape (the dictionary join, source-tagged). */
export interface NutrientView {
    /** Nutrient display name (e.g. `Protein`). */
    nutrient: string;
    /** Amount (numeric, full source fidelity). */
    amount: number;
    /** Unit the amount is expressed in (e.g. `g`, `kcal`). */
    unit: string;
    /** The basis the amount is on (`per_100g` | `per_serving`). */
    basis: string;
    /** The source that supplied the winning value (e.g. `usda`). */
    source: string;
}

/** A household-measure portion in the read shape. */
export interface PortionView {
    /** Human label (e.g. `1 cup chopped`). */
    label: string;
    /** Gram weight (numeric, strictly positive). */
    gramWeight: number;
    /** The source that supplied the portion. */
    source: string;
}

/** The full golden record returned for a `RESOLVED` food (FR-002). */
export interface FoodResponse {
    /** Internal food id (ULID). */
    id: string;
    /** Golden display name. */
    name: string | null;
    /** Golden free-text description. */
    description: string | null;
    /** Generic/branded classification. */
    kind: string;
    /** Lifecycle status (always `RESOLVED` for this shape). */
    status: FoodStatus;
    /** Per-100g (or per-serving) golden nutrients. */
    nutrients: NutrientView[];
    /** Household-measure portions. */
    portions: PortionView[];
    /** Scalar-field provenance — `{ field: source }` (FR-029). */
    provenance: Record<string, string>;
}

/** Body for a `PENDING`/`UNRESOLVED` food (`202 Accepted`, FR-003). */
export interface PendingResponse {
    /** Internal food id. */
    id: string;
    /** The lifecycle status (`PENDING` or `UNRESOLVED`). */
    status: FoodStatus;
    /** Best-effort seconds until availability (omitted for `UNRESOLVED`). */
    estimatedWaitSeconds?: number;
}

/** Body for `GET /v1/foods/{id}/status` (FR-007). */
export interface StatusResponse {
    /** Internal food id. */
    id: string;
    /** Current lifecycle status. */
    status: FoodStatus;
    /** Present for `PENDING`: estimated seconds until availability. */
    estimatedWaitSeconds?: number;
    /** Present only when `RESOLVED`: the full golden record. */
    food?: FoodResponse;
}

/** A single cross-source candidate in the disambiguation list (FR-RES-1). */
export interface CandidateView {
    /** The candidate row id (the PATCH-resolve pick handle). */
    candidateId: string;
    /** The source the candidate came from. */
    source: string;
    /** That source's opaque key for the item. */
    externalKey: string;
    /** Candidate display name. */
    name: string;
    /** One-line disambiguation hint, when present. */
    summary: string | null;
}

/** Body for `GET /v1/foods/{id}/candidates` (FR-RES-1). */
export interface CandidatesResponse {
    /** Internal food id. */
    id: string;
    /** The (non-expired) candidate set; empty for a non-`UNRESOLVED` food. */
    candidates: CandidateView[];
}

/** A single search hit (FR-008). */
export interface SearchResultView {
    /** Internal food id. */
    id: string;
    /** Golden display name. */
    name: string | null;
    /** Relevance score (trigram similarity; `1` for a barcode/external-key crosswalk hit). */
    score: number;
}

/** Body for `GET /v1/foods/search` (FR-008). */
export interface SearchResponse {
    /** Ranked results, or an empty array on no local match (never a source call). */
    results: SearchResultView[];
}

/** Body for `POST /v1/foods` (`202 Accepted`, FR-005). */
export interface AddResponse {
    /** Internal food id. */
    id: string;
    /** The lifecycle status after the add (`PENDING` on a fresh add / reactivation). */
    status: FoodStatus;
    /** Best-effort seconds until availability, when enqueued. */
    estimatedWaitSeconds?: number;
}

/** A single item in a batch add response (FR-045). */
export interface BatchItemView {
    /** Internal food id. */
    id: string;
    /** The item's lifecycle status (`RESOLVED` inline hit, else `PENDING`). */
    status: FoodStatus;
    /** Golden display name (present for an inline `RESOLVED` hit). */
    name?: string | null;
    /** Estimated seconds until availability (present for a `PENDING` miss). */
    estimatedWaitSeconds?: number;
}

/** Body for `POST /v1/foods/batch` (FR-045). */
export interface BatchResponse {
    /** Per-item partial results (inline hits + pending misses). */
    items: BatchItemView[];
}

/** Body for `PATCH /v1/foods/{id}` (FR-RES-2). */
export interface ResolveResponse {
    /** Internal food id. */
    id: string;
    /** The resulting status (`RESOLVED`). */
    status: FoodStatus;
}

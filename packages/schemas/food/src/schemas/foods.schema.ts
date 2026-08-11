/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the food (ingredient) service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/food-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/food-service/src/foods/foods.schema.ts

/**
 * THE FOOD (INGREDIENT) API WIRE CONTRACT — authored here, in the service, and copied verbatim into
 * `@kitchensink/schema-food` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * ⚠️ READ THIS FIRST: despite every `food_*` name, this is the **INGREDIENT** service. Its data comes from the
 * USDA and it holds ingredients, not dishes. A recipe is NEVER written back into it — a recipe is a method, not
 * a substance (feature 001, T150). Read every identifier below as `ingredient_*`; do not rename them.
 *
 * WHAT THIS FILE IS. The single authoritative representation of every request and response body on
 * `/api/v1/foods/*`. Before this seam existed the same shapes were written twice — `src/foods/foods.types.ts`
 * (13 interfaces) and `packages/clients/food-service/src/types.ts` (12 more, hand-written, zero zod) — and
 * NEITHER side imported the other, so a backend change to a response shape did not break the client's
 * `typecheck`. The client simply went on asserting its own beliefs about the server (§15.1).
 *
 * WHY EVERY FIELD IS SOURCE-AGNOSTIC. Every food is keyed by its internal ULID; NO source-native key (`fdcId`)
 * ever appears in a public shape (SC-013). `CandidateView.externalKey` is the sole exception and is deliberate:
 * disambiguation cannot be presented without telling the user which source's item they are picking.
 *
 * IMPORT RESTRICTION (enforced by `@kitchensink/contract-gen`, not by convention): this file may import ONLY
 * `zod` and flat sibling `*.schema.js` modules. It notably may NOT import `./dao/index.js` — which is where
 * `FoodStatus` used to come from, i.e. the wire contract used to be defined by a drizzle `pgEnum`. That is why
 * {@link foodStatusSchema} restates the lifecycle values here and
 * `src/foods/__tests__/foods.schema.test.ts` pins them to the database enum: the WIRE owns its own truth, and a
 * divergence between the two is a test failure rather than a silent contract change.
 *
 * Dates are ISO-8601 strings, never `Date` (CODING_STANDARDS).
 */
import { z } from 'zod';

/**
 * Food lifecycle status — the service's canonical set (FR-002/FR-003/FR-004).
 *
 * `PENDING` a fetch is enqueued · `UNRESOLVED` awaiting a human disambiguation pick · `RESOLVED` a golden
 * record exists · `NOT_FOUND` no wired source has it (tombstoned until TTL) · `FAILED` every source errored
 * past the retry budget.
 */
export const foodStatusSchema = z.enum(['PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED']);

/** Food lifecycle status (the service's canonical set). */
export type FoodStatus = z.infer<typeof foodStatusSchema>;

/** The non-terminal statuses a `202` body can carry — `RESOLVED` would be a `200`, and the rest are `404`. */
export const pendingFoodStatusSchema = z.enum(['PENDING', 'UNRESOLVED']);

/** The lifecycle statuses that answer `202 Accepted`. */
export type PendingFoodStatus = z.infer<typeof pendingFoodStatusSchema>;

/** A golden nutrient value in the read shape (the dictionary join, source-tagged). */
export const nutrientViewSchema = z.object({
    /** Nutrient display name (e.g. `Protein`). */
    nutrient: z.string(),
    /** Amount (numeric, full source fidelity). */
    amount: z.number(),
    /** Unit the amount is expressed in (e.g. `g`, `kcal`). */
    unit: z.string(),
    /** The basis the amount is on (`per_100g` | `per_serving`). */
    basis: z.string(),
    /** The source that supplied the winning value (e.g. `usda`). */
    source: z.string(),
});

/** A golden nutrient value (source-tagged). */
export type NutrientView = z.infer<typeof nutrientViewSchema>;

/** A household-measure portion in the read shape. */
export const portionViewSchema = z.object({
    /** Human label (e.g. `1 cup chopped`). */
    label: z.string(),
    /** Gram weight (numeric, strictly positive). */
    gramWeight: z.number(),
    /** The source that supplied the portion. */
    source: z.string(),
});

/** A household-measure portion (source-tagged). */
export type PortionView = z.infer<typeof portionViewSchema>;

/** The full golden record returned for a `RESOLVED` food (FR-002). */
export const foodResponseSchema = z.object({
    /** Internal food id (ULID). */
    id: z.string(),
    /** Golden display name. */
    name: z.string().nullable(),
    /** Golden free-text description. */
    description: z.string().nullable(),
    /** Generic/branded classification. */
    kind: z.string(),
    /** Lifecycle status (always `RESOLVED` for this shape). */
    status: foodStatusSchema,
    /** Per-100g (or per-serving) golden nutrients. */
    nutrients: z.array(nutrientViewSchema),
    /** Household-measure portions. */
    portions: z.array(portionViewSchema),
    /** Scalar-field provenance — `{ field: source }` (FR-029). */
    provenance: z.record(z.string(), z.string()),
});

/** The full golden record returned for a `RESOLVED` food. */
export type FoodResponse = z.infer<typeof foodResponseSchema>;

/** Body for a `PENDING`/`UNRESOLVED` food (`202 Accepted`, FR-003). */
export const pendingResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The lifecycle status (`PENDING` or `UNRESOLVED`). */
    status: foodStatusSchema,
    /** Best-effort seconds until availability (omitted for `UNRESOLVED`). */
    estimatedWaitSeconds: z.number().optional(),
});

/** Body for a `PENDING`/`UNRESOLVED` food (`202 Accepted`). */
export type PendingResponse = z.infer<typeof pendingResponseSchema>;

/** Body for `GET /api/v1/foods/{id}/status` (FR-007). */
export const statusResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** Current lifecycle status. */
    status: foodStatusSchema,
    /** Present for `PENDING`: estimated seconds until availability. */
    estimatedWaitSeconds: z.number().optional(),
    /** Present only when `RESOLVED`: the full golden record. */
    food: foodResponseSchema.optional(),
});

/** Body for `GET /api/v1/foods/{id}/status`. */
export type StatusResponse = z.infer<typeof statusResponseSchema>;

/** A single cross-source candidate in the disambiguation list (FR-RES-1). */
export const candidateViewSchema = z.object({
    /** The candidate row id (the PATCH-resolve pick handle). */
    candidateId: z.string(),
    /** The source the candidate came from. */
    source: z.string(),
    /** That source's opaque key for the item — the ONE place a source-native key surfaces (SC-013). */
    externalKey: z.string(),
    /** Candidate display name. */
    name: z.string(),
    /** One-line disambiguation hint, when present. */
    summary: z.string().nullable(),
});

/** A single cross-source candidate in the disambiguation list. */
export type CandidateView = z.infer<typeof candidateViewSchema>;

/** Body for `GET /api/v1/foods/{id}/candidates` (FR-RES-1). */
export const candidatesResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The (non-expired) candidate set; empty for a non-`UNRESOLVED` food. */
    candidates: z.array(candidateViewSchema),
});

/** Body for `GET /api/v1/foods/{id}/candidates`. */
export type CandidatesResponse = z.infer<typeof candidatesResponseSchema>;

/** A single search hit (FR-008). */
export const searchResultViewSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** Golden display name. */
    name: z.string().nullable(),
    /** Relevance score (trigram similarity; `1` for a barcode/external-key crosswalk hit). */
    score: z.number(),
});

/** A single search hit. */
export type SearchResultView = z.infer<typeof searchResultViewSchema>;

/** Body for `GET /api/v1/foods/search` (FR-008). */
export const searchResponseSchema = z.object({
    /** Ranked results, or an empty array on no local match (never a source call). */
    results: z.array(searchResultViewSchema),
});

/** Body for `GET /api/v1/foods/search`. */
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** Body for `POST /api/v1/foods` and `POST /api/v1/foods/{id}/refetch` (`202 Accepted`, FR-005/FR-039). */
export const addResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The lifecycle status after the add (`PENDING` on a fresh add / reactivation). */
    status: foodStatusSchema,
    /** Best-effort seconds until availability, when enqueued. */
    estimatedWaitSeconds: z.number().optional(),
});

/** Body for `POST /api/v1/foods` (`202 Accepted`). */
export type AddResponse = z.infer<typeof addResponseSchema>;

/** A single item in a batch add response (FR-045). */
export const batchItemViewSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The item's lifecycle status (`RESOLVED` inline hit, else `PENDING`). */
    status: foodStatusSchema,
    /** Golden display name (present for an inline `RESOLVED` hit). */
    name: z.string().nullable().optional(),
    /** Estimated seconds until availability (present for a `PENDING` miss). */
    estimatedWaitSeconds: z.number().optional(),
});

/** A single item in a batch add response. */
export type BatchItemView = z.infer<typeof batchItemViewSchema>;

/** Body for `POST /api/v1/foods/batch` (FR-045). */
export const batchResponseSchema = z.object({
    /** Per-item partial results (inline hits + pending misses). */
    items: z.array(batchItemViewSchema),
});

/** Body for `POST /api/v1/foods/batch`. */
export type BatchResponse = z.infer<typeof batchResponseSchema>;

/** Body for `PATCH /api/v1/foods/{id}` (FR-RES-2). */
export const resolveResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The resulting status (`RESOLVED`). */
    status: foodStatusSchema,
});

/** Body for `PATCH /api/v1/foods/{id}`. */
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;

/**
 * The union `GET /api/v1/foods/{id}` actually returns: the golden record on `200`, or a non-terminal pending
 * state on `202`. Discriminated on `status`, so a consumer narrows by branching instead of testing for the
 * presence of a field.
 *
 * This exists because the client USED to model the same fork as its own hand-written `GetFoodResult` union —
 * a second representation of one endpoint's contract, on the far side of a boundary that could not typecheck
 * against the service.
 */
export const getFoodResultSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('RESOLVED'), food: foodResponseSchema }),
    z.object({
        status: pendingFoodStatusSchema,
        id: z.string(),
        estimatedWaitSeconds: z.number().optional(),
    }),
]);

/** Either the golden record (`RESOLVED`) or a non-terminal pending state. */
export type GetFoodResult = z.infer<typeof getFoodResultSchema>;

/**
 * Request body for `POST /api/v1/foods` — add by name (FR-005/FR-006).
 *
 * The name is trimmed and required non-empty by the schema itself, so "what counts as an empty name" has one
 * definition that both the request validator and the published contract use.
 */
export const addFoodRequestSchema = z.object({
    /** The display name to resolve. Trimmed; must be non-empty after trimming (FR-006). */
    name: z.string().trim().min(1),
});

/** Request body for `POST /api/v1/foods`. */
export type AddFoodRequest = z.infer<typeof addFoodRequestSchema>;

/**
 * Request body for `POST /api/v1/foods/batch` — batch add by name (FR-045).
 *
 * Trims each name, matching the single-add path.
 *
 * TWO RULES ARE DELIBERATELY *NOT* HERE, and both belong to the controller rather than the contract:
 *  - **The batch cap** is `FOOD_MAX_BATCH_NAMES`, a runtime configuration value. A static `.max(100)` in the
 *    published contract would be a second representation of it that silently disagrees the moment the
 *    environment variable is tuned, so the controller enforces the configured bound and reports it in the `400`.
 *  - **Dropping blank entries** is server-side normalization, not a shape a client must satisfy — and a
 *    `.transform()` here cannot be represented in JSON Schema at all, so it would make the published document
 *    ungenerable while describing nothing a caller needs to know.
 */
export const batchAddFoodRequestSchema = z.object({
    /** The names to add. Each trimmed. Blank entries are dropped and the rest capped, server-side. */
    names: z.array(z.string().trim()),
});

/** Request body for `POST /api/v1/foods/batch`. */
export type BatchAddFoodRequest = z.infer<typeof batchAddFoodRequestSchema>;

/** Request body for `PATCH /api/v1/foods/{id}` — resolve from the user's candidate pick (FR-RES-2, DSN-14). */
export const resolveFoodRequestSchema = z.object({
    /** The picked candidate row ids. At least one; validated against the food's own set server-side. */
    candidateIds: z.array(z.string()).min(1),
});

/** Request body for `PATCH /api/v1/foods/{id}`. */
export type ResolveFoodRequest = z.infer<typeof resolveFoodRequestSchema>;

/** Query for `GET /api/v1/foods/search` (FR-008). An absent `query` searches for the empty string. */
export const searchFoodQuerySchema = z.object({
    /** The search query. Absent is treated as empty, which yields an empty result set. */
    query: z.string().optional(),
});

/** Query for `GET /api/v1/foods/search`. */
export type SearchFoodQuery = z.infer<typeof searchFoodQuerySchema>;
